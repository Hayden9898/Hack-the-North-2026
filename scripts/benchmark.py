"""Measured performance figures (never estimates): detector stage timings on a completed run's tail, the events-page
query before/after the limit-first rewrite, and raw GROUP BY vs Tiger aggregate. Writes reports/performance_data.json."""
from __future__ import annotations

import argparse
import json
import statistics
import time
from datetime import UTC, datetime
from pathlib import Path

from app.config import get_config
from app.db.engine import connect_direct
from app.features import history
from app.features.events import Event
from app.features.history import StatsStore, window_counts
from app.features.reference import Reference
from app.features.vector import compute_features
from app.incidents import analytics
from app.settings import get_settings

OLD_EVENTS_SQL = """SELECT d.run_seq, p.username FROM detections d
JOIN processed_events p ON p.run_id = d.run_id AND p.run_seq = d.run_seq AND p.event_time = d.event_time
LEFT JOIN event_registry e ON e.event_id = d.event_id
WHERE d.run_id = %(run)s AND d.run_seq <= %(cut)s ORDER BY d.run_seq DESC LIMIT 100"""
NEW_EVENTS_SQL = """WITH page AS (SELECT d.* FROM detections d WHERE d.run_id = %(run)s AND d.run_seq <= %(cut)s ORDER BY d.run_seq DESC LIMIT 100)
SELECT d.run_seq, p.username FROM page d
JOIN processed_events p ON p.run_id = d.run_id AND p.run_seq = d.run_seq AND p.event_time = d.event_time
LEFT JOIN event_registry e ON e.event_id = d.event_id ORDER BY d.run_seq DESC"""


def timed(cur, sql, params, repeats):
    out = []
    for _ in range(repeats):
        t = time.perf_counter()
        cur.execute(sql, params)
        cur.fetchall()
        out.append((time.perf_counter() - t) * 1000)
    return {"median_ms": round(statistics.median(out), 2), "min_ms": round(min(out), 2), "max_ms": round(max(out), 2), "repeats": repeats}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", default=None, help="completed run (default: newest completed)")
    ap.add_argument("--sample", type=int, default=300, help="events for per-stage timing")
    ap.add_argument("--repeats", type=int, default=7)
    ap.add_argument("--out", default="reports/performance_data.json")
    args = ap.parse_args()
    s = get_settings()
    cfg = get_config()
    history.configure(tuple(sorted(cfg.routes.categories["login_families"])))
    conn = connect_direct(s.database_url)
    with conn.cursor() as cur:
        if args.run_id:
            cur.execute("SELECT * FROM runs WHERE run_id=%s", (args.run_id,))
        else:
            cur.execute("SELECT * FROM runs WHERE state='completed' AND dataset_id IS NOT NULL ORDER BY created_at DESC LIMIT 1")
        run = cur.fetchone()
        if run is None:
            print("no completed run")
            return 1
        run = dict(run)
        rid = run["run_id"]
        cut = int(run["processed_seq"])
        report: dict = {"run_id": rid, "run_name": run["name"], "processed": cut, "measured_at": datetime.now(UTC).isoformat(), "machine": "developer laptop, Docker Desktop TimescaleDB (see PROGRESS.md)"}

        # 1. Events page query: old join-then-limit vs new limit-then-join.
        report["events_page_query"] = {
            "join_then_limit": timed(cur, OLD_EVENTS_SQL, {"run": rid, "cut": cut}, args.repeats),
            "limit_then_join": timed(cur, NEW_EVENTS_SQL, {"run": rid, "cut": cut}, args.repeats),
        }

        # 2. Per-stage detector timings replayed read-only over the last N processed events (same code paths).
        cur.execute(
            """SELECT re.run_seq, re.event_id, re.event_time, re.phase, r.username, r.ip_raw, r.method, r.path, r.raw_target, r.query_keys,
                      r.route_family, r.object_id, r.status, r.response_bytes, r.offset_minutes, r.raw_line, e.line_number
               FROM run_events re JOIN raw_events r ON r.event_id=re.event_id AND r.event_time=re.event_time
               LEFT JOIN event_registry e ON e.event_id=re.event_id
               WHERE re.run_id=%s AND re.run_seq > %s ORDER BY re.run_seq""",
            (rid, cut - args.sample),
        )
        rows = [dict(r) for r in cur.fetchall()]
    ref = Reference.from_dict((run["config"] or {}).get("reference") or {})
    windows = cfg.policy["features"]["windows_seconds"]
    win_t, stats_t, feat_t = [], [], []
    stats = StatsStore(conn, rid)
    for row in rows:
        ev = Event.from_row(row)
        t = time.perf_counter()
        win = window_counts(conn, rid, ev, windows, 60)
        win_t.append((time.perf_counter() - t) * 1000)
        t = time.perf_counter()
        acct = stats.get("account", ev.username)
        pair = stats.get("pair", ev.pair_key)
        ap_ = stats.get("account_path", ev.account_path_key)
        stats_t.append((time.perf_counter() - t) * 1000)
        t = time.perf_counter()
        compute_features(ev, win, acct, pair, ap_, ref, cfg)
        feat_t.append((time.perf_counter() - t) * 1000)
    conn.rollback()

    def pct(xs, p):
        xs = sorted(xs)
        return round(xs[min(len(xs) - 1, int(p / 100 * len(xs)))], 3)

    report["detector_stages_ms"] = {
        "sample_events": len(rows),
        "window_query": {"p50": pct(win_t, 50), "p95": pct(win_t, 95), "max": round(max(win_t), 3)},
        "entity_stats_read_uncached": {"p50": pct(stats_t, 50), "p95": pct(stats_t, 95)},
        "feature_vector_pure": {"p50": pct(feat_t, 50), "p95": pct(feat_t, 95)},
    }

    # 3. Raw GROUP BY vs Tiger aggregate (identical results required).
    try:
        analytics.refresh_run(s.database_url, rid)
        with connect_direct(s.database_url) as c2:
            report["tiger_aggregate"] = analytics.compare_raw_vs_aggregate(c2, rid, repeats=args.repeats)
    except Exception as exc:  # noqa: BLE001
        report["tiger_aggregate"] = {"error": f"{type(exc).__name__}: {exc}"[:200]}

    # 4. Throughput figures recorded by the replay CLI live in PROGRESS.md; include the run's own timestamps.
    with connect_direct(s.database_url) as c3, c3.cursor() as cur:
        cur.execute("SELECT min(processed_at) a, max(processed_at) b, count(*) n FROM run_events WHERE run_id=%s AND processed_at IS NOT NULL", (rid,))
        r = cur.fetchone()
        if r and r["a"] and r["b"] and r["b"] > r["a"]:
            secs = (r["b"] - r["a"]).total_seconds()
            report["replay_throughput"] = {"events": r["n"], "wall_seconds": round(secs, 1), "events_per_second": round(r["n"] / secs, 1)}
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
