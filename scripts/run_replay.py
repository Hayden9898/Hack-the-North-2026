"""Create a run over an imported dataset and drive it synchronously in-process (no worker needed).

Used for evaluation/training passes and for `make replay-demo` preparation. Prints measured throughput.
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime

from app.config import get_config
from app.db.engine import connect_direct
from app.observability import sentry
from app.settings import get_settings
from app.workers import runs as runs_mod
from app.workers.detector import Detector


def parse_dt(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s) if s else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset-id", default=None, help="default: the single ready dataset")
    ap.add_argument("--name", default="cli-replay")
    ap.add_argument("--visible-start", default=None, help="ISO timestamp; default: evaluation partition start")
    ap.add_argument("--range-start", default=None)
    ap.add_argument("--range-end", default=None)
    ap.add_argument("--model-id", default=None, help="default: the newest active model")
    ap.add_argument("--rules-only", action="store_true", help="attach no model (e.g. the causal snapshot pass that feeds training)")
    ap.add_argument("--speed", type=float, default=0.0, help="0 = unbounded")
    ap.add_argument("--pause-at-visible-start", action="store_true")
    ap.add_argument("--no-drive", action="store_true", help="create+start only; leave processing to the detector worker")
    ap.add_argument("--database-url", default=None)
    args = ap.parse_args()
    settings = get_settings()
    url = args.database_url or settings.database_url
    sentry.init("replay-cli", settings)
    cfg = get_config()
    conn = connect_direct(url)
    with conn.cursor() as cur:
        if args.dataset_id:
            cur.execute("SELECT id FROM datasets WHERE id=%s AND import_state='ready'", (args.dataset_id,))
        else:
            cur.execute("SELECT id FROM datasets WHERE import_state='ready' ORDER BY created_at LIMIT 1")
        row = cur.fetchone()
    if row is None:
        print("no ready dataset; run the import first", file=sys.stderr)
        return 1
    run = runs_mod.create_run(
        conn, cfg, dataset_id=row["id"], name=args.name, visible_start=parse_dt(args.visible_start),
        range_start=parse_dt(args.range_start), range_end=parse_dt(args.range_end), model_id=args.model_id,
        speed=args.speed, pause_at_visible_start=args.pause_at_visible_start, use_active_model=not args.rules_only,
    )
    runs_mod.control(conn, run["run_id"], "start")
    conn.commit()
    print(f"run {run['run_id']} created (dataset {row['id']}, model={run['model_id']} [{run['model_health']}], visible_start={run['visible_start']})")
    if args.no_drive:
        return 0
    det = Detector(url, cfg)
    t0 = time.perf_counter()
    last_report = t0
    processed = 0
    while True:
        res = det.step(conn, run["run_id"])
        processed += res.processed
        state = runs_mod.get_run(conn, run["run_id"])
        conn.commit()
        assert state is not None
        now = time.perf_counter()
        if now - last_report > 10:
            rate = processed / (now - t0)
            print(f"  {state['state']}/{state['phase']} processed={state['processed_seq']:,} admitted={state['admitted_seq']:,} "
                  f"last={state['last_processed_time']} rate={rate:.0f} ev/s", file=sys.stderr, flush=True)
            last_report = now
        if state["state"] in ("completed", "blocked"):
            break
        if state["state"] == "paused" and state["admitted_seq"] == state["processed_seq"]:
            break
        if res.processed == 0:
            time.sleep(0.05)
    dt = time.perf_counter() - t0
    with conn.cursor() as cur:
        cur.execute("SELECT threat_class, phase, count(*) n FROM detections WHERE run_id=%s GROUP BY 1,2 ORDER BY 2,1", (run["run_id"],))
        classes = cur.fetchall()
        cur.execute("SELECT primary_rule_id, current_class, account, ip_raw, key_value, first_event_time, last_event_time, current_version FROM incidents WHERE run_id=%s ORDER BY first_seq", (run["run_id"],))
        incidents = cur.fetchall()
    conn.commit()
    print(f"run {run['run_id']} state={state['state']} processed={state['processed_seq']:,} in {dt:.1f}s ({processed / dt:.0f} ev/s)")
    for c in classes:
        print(f"  {c['phase']:8s} {str(c['threat_class']):10s} {c['n']:,}")
    print(f"incidents: {len(incidents)}")
    for i in incidents:
        print(f"  {i['primary_rule_id']} {i['current_class']:10s} v{i['current_version']} {i['key_value']} {i['first_event_time']} .. {i['last_event_time']}")
    conn.close()
    sentry.flush()
    return 0 if state["state"] == "completed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
