"""`make replay-demo`: create an isolated demo run over the imported dataset, using the active evaluated model,
Slack preview, and pause at the visible boundary (March 1) after warming August–February through the real detector.

No pre-loaded incidents: the warmup is a genuine causal pass (about 12–15 minutes on the documented laptop). The
detector worker (`python -m app.workers.detector`) may process it instead when --no-drive is given.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from app.db.engine import connect_direct
from app.settings import get_settings

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="demo")
    ap.add_argument("--no-drive", action="store_true", help="leave processing to the running detector worker")
    ap.add_argument("--model-id", default=None, help="default: the active model")
    args = ap.parse_args()
    s = get_settings()
    with connect_direct(s.database_url) as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM datasets WHERE import_state='ready' ORDER BY created_at LIMIT 1")
        ds = cur.fetchone()
        if ds is None:
            print("no imported dataset; run `python tasks.py import` first", file=sys.stderr)
            return 1
        if args.model_id:
            cur.execute("SELECT model_id FROM models WHERE model_id=%s", (args.model_id,))
        else:
            cur.execute("SELECT model_id FROM models WHERE status='active' ORDER BY created_at DESC LIMIT 1")
        m = cur.fetchone()
        conn.rollback()
    if m is None:
        print("no active model; run `python tasks.py train` then `python tasks.py calibrate MODEL_ID=... --activate`, or continue rules-only", file=sys.stderr)
        model_args: list[str] = []
    else:
        model_args = ["--model-id", m["model_id"]]
    if s.slack_mode != "preview":
        print(f"note: SLACK_MODE={s.slack_mode}; replay runs never deliver live unless explicitly opted in", file=sys.stderr)
    cmd = [sys.executable, "-m", "scripts.run_replay", "--name", args.name, "--pause-at-visible-start", "--speed", "0", *model_args]
    if args.no_drive:
        cmd.append("--no-drive")
    print("+", " ".join(cmd), flush=True)
    rc = subprocess.call(cmd, cwd=str(ROOT))
    if rc in (0, 2):
        print("\nDemo run is warmed and paused at the visible boundary. Open the UI, pick the run, set speed (e.g. 600) and press Resume.")
        print("Slack is in preview mode; deliveries appear on each incident's Delivery panel. Nothing leaves the application.")
        return 0
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
