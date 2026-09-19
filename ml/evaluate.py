"""Chronological evaluation on the reserved partition: rules-only vs model-only vs hybrid vs naive rarity baseline.

Uses the causal feature snapshots and rule detections of a completed run (no refitting, no future data). March is a
chronological evaluation set that already informed the design; it is NOT a blind holdout, and there are no organizer
labels — the "known sequence" is a provisional analyst inventory kept in tests/fixtures/known_sequence.json."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import timedelta
from pathlib import Path

import joblib
import numpy as np

from app.config import get_config
from app.db.engine import connect_direct
from app.features.vector import FEATURE_NAMES
from app.settings import REPO_ROOT, get_settings
from ml.common import anomaly_scores, load_manifest, load_matrix, rarity_baseline


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-id", required=True)
    ap.add_argument("--source-run", default=None, help="completed run whose detections/snapshots to evaluate (default: manifest source run)")
    ap.add_argument("--partition", default="evaluation")
    ap.add_argument("--known", default=str(REPO_ROOT / "tests" / "fixtures" / "known_sequence.json"))
    ap.add_argument("--out", default="reports/evaluation_data.json")
    ap.add_argument("--database-url", default=None)
    ap.add_argument("--top", type=int, default=15)
    args = ap.parse_args()
    settings = get_settings()
    cfg = get_config()
    model_dir = Path(settings.model_dir)
    manifest = load_manifest(model_dir, args.model_id)
    est = joblib.load(model_dir / args.model_id / manifest["artifact_file"])
    run_id = args.source_run or manifest["source_run_id"]
    conn = connect_direct(args.database_url or settings.database_url)
    m = load_matrix(conn, run_id, cfg, args.partition)
    scores = anomaly_scores(est, m.X)
    base = rarity_baseline(m.X)
    part = cfg.partitions[args.partition]
    days = max(1, (part.end_exclusive - part.start).days)
    tz = cfg.partitions.local_tz()
    seq_index = {int(s): i for i, s in enumerate(m.run_seqs.tolist())}

    with conn.cursor() as cur:
        cur.execute(
            """SELECT d.run_seq, d.threat_class, d.rule_ids, p.username, p.ip_raw, p.method, p.path, p.status, p.response_bytes, p.event_time, e.line_number
               FROM detections d JOIN processed_events p ON p.run_id=d.run_id AND p.run_seq=d.run_seq AND p.event_time=d.event_time
               LEFT JOIN event_registry e ON e.event_id=d.event_id
               WHERE d.run_id=%s AND d.event_time >= %s AND d.event_time < %s ORDER BY d.run_seq""",
            (run_id, part.start, part.end_exclusive),
        )
        det = {int(r["run_seq"]): dict(r) for r in cur.fetchall()}
        cur.execute("SELECT incident_id, primary_rule_id, current_class, key_value, first_event_time, last_event_time, current_version FROM incidents WHERE run_id=%s AND first_event_time >= %s ORDER BY first_seq", (run_id, part.start))
        incidents = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT count(*) n FROM incident_versions v JOIN incidents i USING (run_id, incident_id) WHERE v.run_id=%s AND i.first_event_time >= %s", (run_id, part.start))
        n_versions = int(cur.fetchone()["n"])
        cur.execute("SELECT notification_kind, count(*) n FROM notification_outbox WHERE run_id=%s GROUP BY 1", (run_id,))
        notif = {r["notification_kind"]: r["n"] for r in cur.fetchall()}
    conn.close()

    rule_seqs = {s for s, d in det.items() if d["rule_ids"]}
    rule_high = {s for s, d in det.items() if d["threat_class"] == "high_risk"}
    out: dict = {
        "model_id": args.model_id,
        "source_run_id": run_id,
        "partition": {"name": args.partition, "start": part.start.isoformat(), "end_exclusive": part.end_exclusive.isoformat(), "days": days, "events": int(len(scores))},
        "not_blind": "The evaluation partition informed rule design; results are chronological, not a blind holdout. No organizer labels exist.",
        "rules_only": {
            "event_alerts": len(rule_seqs),
            "high_risk_events": len(rule_high),
            "incidents_after_grouping": len(incidents),
            "incident_versions": n_versions,
            "incidents": [{**i, "first_event_time": i["first_event_time"].isoformat(), "last_event_time": i["last_event_time"].isoformat()} for i in incidents],
            "notifications_by_kind": notif,
            "alerts_per_day": round(len(rule_seqs) / days, 3),
        },
        "model_only": {},
        "hybrid": {},
        "baseline_rarity": {},
    }
    cand = manifest["candidate_thresholds"]
    for p, t in cand.items():
        flagged = scores > float(t)
        fl_seqs = {int(m.run_seqs[i]) for i in np.where(flagged)[0]}
        grouped = {(det[s]["username"], det[s]["event_time"].astimezone(tz).date().isoformat()) for s in fl_seqs if s in det}
        overlap = fl_seqs & rule_seqs
        out["model_only"][p] = {
            "threshold": float(t),
            "event_alerts": int(flagged.sum()),
            "alerts_per_day": round(float(flagged.sum()) / days, 2),
            "grouped_account_day": len(grouped),
            "overlap_with_rule_events": len(overlap),
            "rule_events_missed_by_model": len(rule_seqs - fl_seqs),
            "high_risk_events_flagged_by_model": len(rule_high & fl_seqs),
        }
        hyb = fl_seqs | rule_seqs
        out["hybrid"][p] = {"event_alerts": len(hyb), "alerts_per_day": round(len(hyb) / days, 2), "added_by_model": len(fl_seqs - rule_seqs)}
        bt = float(np.percentile(base, float(p)))  # matched burden on the SAME partition for a fair naive comparison
        bf = {int(m.run_seqs[i]) for i in np.where(base > bt)[0]}
        out["baseline_rarity"][p] = {"event_alerts": len(bf), "overlap_with_rule_events": len(bf & rule_seqs), "overlap_with_model": len(bf & fl_seqs)}

    # Known provisional sequence: which detector says what, and how fast.
    known = json.loads(Path(args.known).read_text(encoding="utf-8"))
    by_line = {d["line_number"]: (s, d) for s, d in det.items() if d.get("line_number")}
    chosen_t = float(manifest["threshold"])
    rows = []
    first_time = None
    for k in known["events"]:
        hit = by_line.get(k["line"])
        if not hit:
            rows.append({**k, "found": False})
            continue
        s, d = hit
        i = seq_index.get(s)
        sc = float(scores[i]) if i is not None else None
        first_time = first_time or d["event_time"]
        rows.append({
            **k,
            "found": True,
            "event_time": d["event_time"].isoformat(),
            "rule_ids": d["rule_ids"],
            "rules_class": d["threat_class"],
            "model_score": sc,
            "model_flagged_at_chosen": (sc > chosen_t) if sc is not None else None,
            "model_flagged_at": [p for p, t in cand.items() if sc is not None and sc > float(t)],
            "rule_matches_expectation": (k["expect_rule"] in (d["rule_ids"] or [])) if k["expect_rule"] else (not d["rule_ids"]),
        })
    firsts = {}
    for r in rows:
        if not r.get("found"):
            continue
        t = r["event_time"]
        if r["rule_ids"] and "rules_first_warning" not in firsts:
            firsts["rules_first_warning"] = t
        if r["rules_class"] == "high_risk" and "rules_first_high_risk" not in firsts:
            firsts["rules_first_high_risk"] = t
        if r["model_flagged_at_chosen"] and "model_first_flag" not in firsts:
            firsts["model_first_flag"] = t
    from datetime import datetime

    def delay(key):
        if key not in firsts or first_time is None:
            return None
        return (datetime.fromisoformat(firsts[key]) - first_time).total_seconds()

    out["known_sequence"] = {
        "provisional": True,
        "rows": rows,
        "first_event_time": first_time.isoformat() if first_time else None,
        "firsts": firsts,
        "event_time_delay_seconds": {"rules_first_warning": delay("rules_first_warning"), "rules_first_high_risk": delay("rules_first_high_risk"), "model_first_flag": delay("model_first_flag")},
        "expectations_met": all(r.get("rule_matches_expectation", False) for r in rows if r.get("found")),
    }

    # ML-only examples worth investigating (top scores not covered by rules), with measured deviations.
    order = np.argsort(-scores)
    idx = {n: i for i, n in enumerate(FEATURE_NAMES)}
    examples = []
    for i in order:
        s = int(m.run_seqs[i])
        if s in rule_seqs or scores[i] <= chosen_t:
            continue
        d = det.get(s)
        if not d:
            continue
        vec = m.X[i]
        top = sorted(((n, float(vec[idx[n]])) for n in ("pair_rarity", "acct_family_rarity", "acct_hour_rarity", "bytes_delta_vs_bootstrap", "pair_unfamiliar", "unusual_query_key_count", "first_200_after_denials", "acct_req_5m_log1p")), key=lambda kv: -abs(kv[1]))[:4]
        examples.append({"line_number": d["line_number"], "event_time": d["event_time"].isoformat(), "account": d["username"], "ip": d["ip_raw"],
                         "request": f"{d['method']} {d['path']} -> {d['status']} ({d['response_bytes']})", "score": float(scores[i]), "top_measured_deviations": top})
        if len(examples) >= args.top:
            break
    out["ml_only_examples"] = examples
    hours = Counter()
    for i in np.where(scores > chosen_t)[0]:
        d = det.get(int(m.run_seqs[i]))
        if d:
            hours[d["event_time"].astimezone(tz).hour] += 1
    out["model_flags_by_local_hour_chosen"] = dict(sorted(hours.items()))
    out["score_distribution"] = {"min": float(scores.min()), "p50": float(np.percentile(scores, 50)), "p99": float(np.percentile(scores, 99)), "p99_5": float(np.percentile(scores, 99.5)), "p99_9": float(np.percentile(scores, 99.9)), "max": float(scores.max()), "chosen_threshold": chosen_t}
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, indent=2, default=str), encoding="utf-8")
    summary = {k: out[k] for k in ("partition", "rules_only", "model_only", "hybrid", "baseline_rarity")}
    summary["rules_only"] = {k: v for k, v in summary["rules_only"].items() if k != "incidents"}
    summary["known_sequence_expectations_met"] = out["known_sequence"]["expectations_met"]
    summary["known_sequence_delays"] = out["known_sequence"]["event_time_delay_seconds"]
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
