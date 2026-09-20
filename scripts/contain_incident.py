"""Drive the containment loop for one incident from the command line: bind → dry run → execute → verify.

Same service layer the console calls, so what this prints is what an operator would approve in the UI. It refuses
exactly where the API refuses, and it never contacts an external system unless ACTION_MODE=live is configured with
an endpoint — the adapter in use is printed before anything is approved.

Usage:
  python -m scripts.contain_incident --run-id <run>                       # list bound actions and stop
  python -m scripts.contain_incident --run-id <run> --action restore_acl  # dry run only
  python -m scripts.contain_incident --run-id <run> --action restore_acl --execute
  python -m scripts.contain_incident --run-id <run> --packet              # render the response packet
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from app.actions import adapters as adapters_mod
from app.actions import packet as packet_mod
from app.actions import service
from app.db.engine import connect_direct
from app.settings import get_settings


def _load_run(conn: Any, run_id: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM runs WHERE run_id=%s", (run_id,))
        row = cur.fetchone()
    if row is None:
        raise SystemExit(f"run {run_id!r} not found")
    return dict(row)


def _pick_incident(conn: Any, run_id: str, incident_id: str | None) -> str:
    if incident_id:
        return incident_id
    with conn.cursor() as cur:
        cur.execute(
            """SELECT incident_id FROM incidents WHERE run_id=%s
               ORDER BY (current_class='high_risk') DESC, last_seq DESC LIMIT 1""",
            (run_id,),
        )
        row = cur.fetchone()
    if row is None:
        raise SystemExit(f"run {run_id!r} has no incidents")
    return str(row["incident_id"])


def _print_actions(ctx: dict[str, Any], config_dir: str) -> None:
    for b in service.applicable_actions(ctx, config_dir):
        mark = "  " if b.available else "x "
        params = " ".join(f"{k}={v}" for k, v in b.params.items()) or "(no parameters)"
        print(f"{mark}{b.action_id:<26} {b.action['severity']:<12} {params}")
        for name, src in b.bound_from.items():
            print(f"      {name} bound from {src}")
        for reason in b.unmet:
            print(f"      unmet: {reason}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--incident-id", default=None, help="defaults to the newest high-risk incident in the run")
    ap.add_argument("--action", default=None, help="action id to dry run")
    ap.add_argument("--execute", action="store_true", help="approve and execute after the dry run")
    ap.add_argument("--verify", action="store_true", help="recompute the verification criterion")
    ap.add_argument("--packet", action="store_true", help="render the response packet to stdout")
    ap.add_argument("--operator", default="cli-operator")
    ap.add_argument("--database-url", default=None)
    args = ap.parse_args()

    s = get_settings()
    adapter = adapters_mod.build_adapter(s)
    conn = connect_direct(args.database_url or s.database_url)
    try:
        run = _load_run(conn, args.run_id)
        incident_id = _pick_incident(conn, args.run_id, args.incident_id)
        ctx = service.load_context(conn, run, incident_id, None)
        print(f"run {args.run_id} · incident {incident_id} v{ctx['version_number']} · cutoff #{ctx['cutoff_seq']}")
        print(f"execution adapter: {getattr(adapter, 'name', 'preview')} "
              f"({'LIVE — requests will be sent' if s.action_live else 'preview — nothing leaves this process'})")
        print()

        if args.packet:
            md = packet_mod.render(
                conn, ctx, service.applicable_actions(ctx, s.config_dir),
                app_base_url=s.app_base_url, execution_mode="live" if s.action_live else "preview", config_dir=s.config_dir,
            )
            conn.rollback()
            print(md)
            return 0

        if not args.action:
            _print_actions(ctx, s.config_dir)
            conn.rollback()
            return 0

        try:
            dry = service.dry_run(conn, ctx, args.action, operator=args.operator, adapter=adapter, config_dir=s.config_dir)
        except service.ActionError as exc:
            conn.rollback()
            print(f"refused ({exc.code}): {exc.message}", file=sys.stderr)
            return 2
        conn.commit()
        print("dry run — the exact request this approval would issue:")
        print(json.dumps(dry["result"]["would_issue"], indent=2, default=str))
        print()

        if args.execute:
            try:
                res = service.execute(conn, ctx, args.action, operator=args.operator, adapter=adapter, config_dir=s.config_dir)
            except service.ActionError as exc:
                conn.rollback()
                print(f"refused ({exc.code}): {exc.message}", file=sys.stderr)
                return 2
            conn.commit()
            print(f"executed: outcome={res['outcome']} contained_at={res['contained_at']}")
            v = res["result"].get("verification") or {}
            print(f"verification: {v.get('status')} — {v.get('detail')}")

        if args.verify:
            try:
                out = service.verify(conn, ctx, args.action, operator=args.operator, config_dir=s.config_dir)
            except service.ActionError as exc:
                conn.rollback()
                print(f"refused ({exc.code}): {exc.message}", file=sys.stderr)
                return 2
            conn.commit()
            print(json.dumps(out["verification"], indent=2, default=str))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
