"""Review calibration alerts for a candidate model: burden per candidate percentile, sampled alerts with their
observed context, comparison to the naive rarity baseline, and the decision to activate or shadow the model.

The choice is made on January–February only; March stays untouched until `ml.evaluate`."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np

from app.config import get_config
from app.db.engine import connect_direct, jsonb
from app.features.vector import FEATURE_NAMES
from app.settings import get_settings
from ml.common import (
    anomaly_scores,
    check_config_drift,
    load_manifest,
    load_matrix,
    rarity_baseline,
    write_manifest,
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-id", required=True)
    ap.add_argument("--activate", action="store_true", help="mark the model active (default leaves it candidate)")
    ap.add_argument("--shadow", action="store_true", help="mark the model shadow (scored, never classifies)")
    ap.add_argument("--percentile", type=float, default=None, help="override the frozen threshold percentile")
    ap.add_argument("--sample", type=int, default=12)
    ap.add_argument("--database-url", default=None)
    ap.add_argument("--out", default="reports/calibration.json")
    ap.add_argument("--allow-config-drift", action="store_true", help="proceed even if the current config differs from the training config")
    args = ap.parse_args()
    settings = get_settings()
    cfg = get_config()
    model_dir = Path(settings.model_dir)
    manifest = load_manifest(model_dir, args.model_id)
    check_config_drift(manifest, cfg, args.allow_config_drift)
    est = joblib.load(model_dir / args.model_id / manifest["artifact_file"])
    conn = connect_direct(args.database_url or settings.database_url)
    cal = load_matrix(conn, manifest["source_run_id"], cfg, "calibration")
    scores = anomaly_scores(est, cal.X)
    base = rarity_baseline(cal.X)
    cal_days = max(1, (cfg.partitions["calibration"].end_exclusive - cfg.partitions["calibration"].start).days)
    report: dict = {"model_id": args.model_id, "calibration_rows": int(len(scores)), "calibration_days": cal_days, "percentiles": {}}
    for p in cfg.policy["model"]["candidate_percentiles"]:
        t = float(np.percentile(scores, p))
        tb = float(np.percentile(base, p))
        flagged = scores > t
        report["percentiles"][str(p)] = {
            "threshold": t,
            "alerts": int(flagged.sum()),
            "alerts_per_day": round(float(flagged.sum()) / cal_days, 2),
            "baseline_threshold": tb,
            "baseline_alerts": int((base > tb).sum()),
            "overlap_with_baseline": int((flagged & (base > tb)).sum()),
        }
    pct = float(args.percentile if args.percentile is not None else manifest["threshold_percentile"])
    threshold = float(np.percentile(scores, pct))
    flagged_idx = np.where(scores > threshold)[0]
    # Sample flagged calibration events with their observed context so a human can judge them.
    rng = np.random.default_rng(int(cfg.policy["model"]["random_state"]))
    sample_idx = rng.choice(flagged_idx, size=min(args.sample, len(flagged_idx)), replace=False) if len(flagged_idx) else np.array([], dtype=int)
    samples = []
    with conn.cursor() as cur:
        for i in sorted(sample_idx.tolist()):
            cur.execute(
                """SELECT f.run_seq, f.observed_context, p.username, p.ip_raw, p.method, p.path, p.status, p.response_bytes, p.event_time, e.line_number
                   FROM feature_snapshots f JOIN processed_events p ON p.run_id=f.run_id AND p.run_seq=f.run_seq AND p.event_time=f.event_time
                   LEFT JOIN event_registry e ON e.event_id=f.event_id WHERE f.run_id=%s AND f.run_seq=%s""",
                (manifest["source_run_id"], int(cal.run_seqs[i])),
            )
            row = dict(cur.fetchone())
            vec = dict(zip(FEATURE_NAMES, cal.X[i].tolist(), strict=True))
            top = sorted(((k, v) for k, v in vec.items() if k.endswith("rarity") or k in ("pair_unfamiliar", "unusual_query_key_count", "first_200_after_denials", "bytes_delta_vs_bootstrap")), key=lambda kv: -abs(kv[1]))[:4]
            samples.append({"line_number": row["line_number"], "event_time": row["event_time"].isoformat(), "account": row["username"], "ip": row["ip_raw"],
                            "request": f"{row['method']} {row['path']} -> {row['status']} ({row['response_bytes']})", "score": float(scores[i]),
                            "top_measured_deviations": top, "familiarity": row["observed_context"].get("familiarity"), "local_hour": row["observed_context"].get("local_hour")})
        # Per-account and per-route-family distribution of flagged calibration events.
        flagged_seqs = [int(cal.run_seqs[i]) for i in flagged_idx.tolist()]
        cur.execute(
            """SELECT p.username, p.route_family, p.status, count(*) n FROM processed_events p WHERE p.run_id=%s AND p.run_seq = ANY(%s)
               GROUP BY 1,2,3 ORDER BY n DESC""",
            (manifest["source_run_id"], flagged_seqs),
        )
        report["flagged_breakdown"] = [dict(r) for r in cur.fetchall()]
        cur.execute(
            """SELECT extract(hour from p.event_time at time zone make_interval(mins => %s))::int h, count(*) n FROM processed_events p
               WHERE p.run_id=%s AND p.run_seq = ANY(%s) GROUP BY 1 ORDER BY 1""",
            (cfg.partitions.utc_offset_minutes, manifest["source_run_id"], flagged_seqs),
        )
        report["flagged_by_local_hour"] = {int(r["h"]): r["n"] for r in cur.fetchall()}
    report["chosen"] = {"percentile": pct, "threshold": threshold, "alerts": int(len(flagged_idx)), "alerts_per_day": round(len(flagged_idx) / cal_days, 2), "ties": int((scores == threshold).sum())}
    report["samples"] = samples
    status = "active" if args.activate else ("shadow" if args.shadow else "candidate")
    # The detector reads the threshold from the manifest on disk, so the manifest must be in place before the DB row
    # says the model is usable at this threshold.
    if pct != manifest["threshold_percentile"] or threshold != manifest["threshold"]:
        manifest["threshold"], manifest["threshold_percentile"] = threshold, pct
    manifest["status"] = status
    manifest["calibration_review"] = report["chosen"]
    write_manifest(model_dir, args.model_id, manifest)
    demoted: list[str] = []
    with conn.cursor() as cur:
        if status == "active":
            # Exactly one active model: demote the previous one in the same transaction so activation can roll back
            # to an older artifact instead of the newest active row always winning.
            cur.execute("UPDATE models SET status='shadow' WHERE status='active' AND model_id<>%s RETURNING model_id", (args.model_id,))
            demoted = [r["model_id"] for r in cur.fetchall()]
        cur.execute("UPDATE models SET status=%s, threshold=%s, manifest = manifest || %s WHERE model_id=%s",
                    (status, threshold, jsonb({"threshold": threshold, "threshold_percentile": pct, "calibration_review": report["chosen"], "status": status}), args.model_id))
        if cur.rowcount != 1:
            conn.rollback()
            raise SystemExit(f"model {args.model_id} is not registered in the models table (was it trained with ml.train?)")
    conn.commit()
    conn.close()
    for m in demoted:
        print(f"demoted previously active model {m} to shadow")
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("model_id", "calibration_rows", "percentiles", "chosen")}, indent=2))
    print(f"model {args.model_id} status={status}; review written to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
