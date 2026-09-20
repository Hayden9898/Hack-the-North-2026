"""Dry run → execute → verify → rollback, with an append-only action log.

Sequencing rules, all enforced here rather than in the router:
  * An execute requires a dry run of the *same* binding. If re-binding the action now produces different
    parameters, the approval no longer describes what would happen and the execute is refused.
  * Preconditions are re-evaluated at execute time, not trusted from the dry run.
  * Every phase appends to `action_log` before the proposal state moves, so a crash leaves evidence of the attempt.
  * The first successful containment stamps `incidents.contained_at` together with the mode it was reached in
    (`preview` or `applied`) — a preview is never reported as if something had been changed.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import psycopg

from app.actions import adapters as adapters_mod
from app.actions import binding as binding_mod
from app.actions import catalog as catalog_mod
from app.actions import verify as verify_mod
from app.config import canonical_hash
from app.db.engine import jsonb, one
from app.investigation import playbooks as pb_mod


class ActionError(Exception):
    """Refusal with a machine-readable code: the router maps these to 404/409 rather than 500."""

    def __init__(self, code: str, message: str, *, status: int = 409, extra: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code, self.message, self.status, self.extra = code, message, status, extra or {}


# ------------------------------------------------------------------------------------------------- binding

def load_context(conn: psycopg.Connection[Any], run: dict[str, Any], incident_id: str, version: int | None) -> dict[str, Any]:
    run_id = run["run_id"]
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM incidents WHERE run_id=%s AND incident_id=%s", (run_id, incident_id))
        inc = cur.fetchone()
        if inc is None or int(inc["last_seq"]) > int(run["processed_seq"]):
            raise ActionError("incident_not_found", "incident not found under the run cutoff", status=404)
        inc = dict(inc)
        v = int(version or inc["current_version"])
        cur.execute("SELECT * FROM incident_versions WHERE run_id=%s AND incident_id=%s AND version=%s", (run_id, incident_id, v))
        ver = cur.fetchone()
        if ver is None:
            raise ActionError("version_not_found", "version not found", status=404)
        cur.execute("SELECT facts, packet_hash FROM fact_packets WHERE run_id=%s AND incident_id=%s AND version=%s", (run_id, incident_id, v))
        packet_row = cur.fetchone()
    return {
        "run": run,
        "incident": inc,
        "version": dict(ver),
        "version_number": v,
        "packet": (packet_row or {}).get("facts"),
        "packet_hash": (packet_row or {}).get("packet_hash"),
        "cutoff_seq": int(run["processed_seq"]),
    }


def applicable_actions(ctx: dict[str, Any], config_dir: str | None = None) -> list[binding_mod.BoundAction]:
    """Actions whose playbook applies to this incident, each bound against the committed packet."""
    packet = ctx["packet"]
    kinds = {f["kind"] for f in (packet or {}).get("facts", [])}
    rule_ids = [str(r) for r in (ctx["version"].get("rule_ids") or [])]
    playbook_ids = {p["id"] for p in pb_mod.applicable(pb_mod.load_catalog(config_dir), rule_ids, kinds)}
    catalog = catalog_mod.for_playbooks(catalog_mod.load_catalog(config_dir), playbook_ids)
    return binding_mod.bind_all(catalog, incident=ctx["incident"], version=ctx["version"], packet=packet)


def proposal_id(run_id: str, incident_id: str, version: int, action_id: str) -> str:
    return "ap_" + canonical_hash({"run": run_id, "incident": incident_id, "version": version, "action": action_id})[:20]


def _require_bound(ctx: dict[str, Any], action_id: str, config_dir: str | None) -> binding_mod.BoundAction:
    found = next((b for b in applicable_actions(ctx, config_dir) if b.action_id == action_id), None)
    if found is None:
        raise ActionError("action_not_applicable", f"action {action_id!r} does not apply to this incident", status=404)
    if not found.available:
        raise ActionError("preconditions_unmet", "; ".join(found.unmet), extra={"unmet": found.unmet})
    return found


# ------------------------------------------------------------------------------------------------- reads

def list_for_incident(conn: psycopg.Connection[Any], ctx: dict[str, Any], config_dir: str | None = None, adapter_name: str = "preview") -> dict[str, Any]:
    run_id, incident_id, v = ctx["run"]["run_id"], ctx["incident"]["incident_id"], ctx["version_number"]
    bound = applicable_actions(ctx, config_dir)
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM action_proposals WHERE run_id=%s AND incident_id=%s AND version=%s", (run_id, incident_id, v))
        stored = {r["action_id"]: dict(r) for r in cur.fetchall()}
        cur.execute(
            """SELECT id, proposal_id, action_id, kind, phase, operator, adapter, outcome, error, result, params_hash, created_at
               FROM action_log WHERE run_id=%s AND incident_id=%s ORDER BY created_at, id""",
            (run_id, incident_id),
        )
        log = [dict(r) for r in cur.fetchall()]
    items = []
    for b in bound:
        row = stored.get(b.action_id)
        entry = b.as_dict()
        entry["proposal"] = {k: row[k] for k in ("proposal_id", "state", "params_hash", "created_at", "updated_at")} if row else None
        entry["dry_run_current"] = bool(row and row["state"] in ("dry_run", "executed", "rolled_back") and row["params_hash"] == b.params_hash)
        entry["stale_approval"] = bool(row and row["params_hash"] != b.params_hash)
        items.append(entry)
    return {
        "catalog_version": catalog_mod.CATALOG_VERSION,
        "adapter": adapter_name,
        "execution_mode": "live" if adapter_name != "preview" else "preview",
        "version": v,
        "cutoff_seq": ctx["cutoff_seq"],
        "contained_at": ctx["incident"].get("contained_at"),
        "containment_mode": ctx["incident"].get("containment_mode"),
        "actions": items,
        "log": log,
    }


# ------------------------------------------------------------------------------------------------- writes

def dry_run(conn: psycopg.Connection[Any], ctx: dict[str, Any], action_id: str, *, operator: str, adapter: Any, config_dir: str | None = None) -> dict[str, Any]:
    b = _require_bound(ctx, action_id, config_dir)
    entry = b.as_dict()
    request = adapters_mod.build_request(
        phase="dry_run", run_id=ctx["run"]["run_id"], incident_id=ctx["incident"]["incident_id"], version=ctx["version_number"],
        action=entry, params=b.params, params_hash=b.params_hash, operator=operator,
    )
    verification = verify_mod.run(
        conn, verification=entry["verification"], run_id=ctx["run"]["run_id"], params=b.params,
        after_seq=int(ctx["version"]["trigger_seq"]), cutoff_seq=ctx["cutoff_seq"],
    )
    result = {
        "would_issue": request,
        "targets": b.params,
        "bound_from": b.bound_from,
        "checks": entry["checks"],
        "verification_preview": verification,
        "adapter": getattr(adapter, "name", "preview"),
        "applied_to_external_system": False,
    }
    pid = _upsert_proposal(conn, ctx, b, state="dry_run")
    _append_log(conn, ctx, b, proposal=pid, phase="dry_run", operator=operator, adapter=getattr(adapter, "name", "preview"),
                request=request, result=result, outcome="ok", error=None)
    _emit(conn, ctx, {"action_id": action_id, "phase": "dry_run", "outcome": "ok"})
    return {"proposal_id": pid, "action": entry, "result": result}


def execute(conn: psycopg.Connection[Any], ctx: dict[str, Any], action_id: str, *, operator: str, adapter: Any, config_dir: str | None = None) -> dict[str, Any]:
    b = _require_bound(ctx, action_id, config_dir)  # preconditions re-checked here, not trusted from the dry run
    run_id, incident_id, v = ctx["run"]["run_id"], ctx["incident"]["incident_id"], ctx["version_number"]
    pid = proposal_id(run_id, incident_id, v, action_id)
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM action_proposals WHERE proposal_id=%s FOR UPDATE", (pid,))
        row = cur.fetchone()
    if row is None or row["state"] == "proposed":
        raise ActionError("dry_run_required", "approve a dry run for this action before executing it")
    if row["state"] == "executed":
        raise ActionError("already_executed", "this action was already executed for this incident version")
    if row["params_hash"] != b.params_hash:
        raise ActionError(
            "binding_changed",
            "the facts behind this action moved since the dry run; run the dry run again and re-approve",
            extra={"approved_params_hash": row["params_hash"], "current_params_hash": b.params_hash},
        )

    entry = b.as_dict()
    request = adapters_mod.build_request(
        phase="execute", run_id=run_id, incident_id=incident_id, version=v,
        action=entry, params=b.params, params_hash=b.params_hash, operator=operator,
    )
    res: adapters_mod.ActionResult = adapter.apply(request)
    verification = verify_mod.run(
        conn, verification=entry["verification"], run_id=run_id, params=b.params,
        after_seq=int(ctx["version"]["trigger_seq"]), cutoff_seq=ctx["cutoff_seq"],
    )
    result = {**res.detail, "outcome": res.outcome, "http_status": res.http_status, "verification": verification}
    state = "executed" if res.ok else "failed"
    _set_state(conn, pid, state)
    _append_log(conn, ctx, b, proposal=pid, phase="execute", operator=operator, adapter=res.adapter,
                request=request, result=result, outcome=res.outcome, error=res.error)
    contained = None
    if res.ok and entry["severity"] == "containment":
        contained = _stamp_containment(conn, run_id, incident_id, mode="applied" if res.outcome == "applied" else "preview")
    _emit(conn, ctx, {"action_id": action_id, "phase": "execute", "outcome": res.outcome, "contained": bool(contained)})
    return {"proposal_id": pid, "action": entry, "outcome": res.outcome, "error": res.error, "result": result, "contained_at": contained}


def rollback(conn: psycopg.Connection[Any], ctx: dict[str, Any], action_id: str, *, operator: str, adapter: Any, config_dir: str | None = None) -> dict[str, Any]:
    run_id, incident_id, v = ctx["run"]["run_id"], ctx["incident"]["incident_id"], ctx["version_number"]
    pid = proposal_id(run_id, incident_id, v, action_id)
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM action_proposals WHERE proposal_id=%s FOR UPDATE", (pid,))
        row = cur.fetchone()
    if row is None or row["state"] != "executed":
        raise ActionError("not_executed", "only an executed action can be rolled back")
    if not row["reversible"]:
        raise ActionError("not_reversible", "this action is not reversible through the console")
    action = catalog_mod.by_id(catalog_mod.load_catalog(config_dir), action_id)
    if action is None:
        raise ActionError("action_not_found", f"action {action_id!r} is not in the catalog", status=404)
    b = binding_mod.BoundAction(action=action, params=dict(row["params"]), bound_fact_ids=list(row["bound_fact_ids"] or []))
    request = adapters_mod.build_request(
        phase="rollback", run_id=run_id, incident_id=incident_id, version=v,
        action=b.as_dict(), params=dict(row["params"]), params_hash=str(row["params_hash"]), operator=operator,
    )
    res: adapters_mod.ActionResult = adapter.revert(request)
    _set_state(conn, pid, "rolled_back" if res.ok else "executed")
    _append_log(conn, ctx, b, proposal=pid, phase="rollback", operator=operator, adapter=res.adapter,
                request=request, result={**res.detail, "outcome": res.outcome}, outcome=res.outcome, error=res.error,
                params_hash=str(row["params_hash"]))
    if res.ok:
        _clear_containment_if_last(conn, run_id, incident_id)
    _emit(conn, ctx, {"action_id": action_id, "phase": "rollback", "outcome": res.outcome})
    return {"proposal_id": pid, "outcome": res.outcome, "error": res.error}


def verify(conn: psycopg.Connection[Any], ctx: dict[str, Any], action_id: str, *, operator: str, config_dir: str | None = None) -> dict[str, Any]:
    """Recompute the criterion against everything processed since the action was approved."""
    run_id, incident_id, v = ctx["run"]["run_id"], ctx["incident"]["incident_id"], ctx["version_number"]
    pid = proposal_id(run_id, incident_id, v, action_id)
    after_seq = int(ctx["version"]["trigger_seq"])
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM action_proposals WHERE proposal_id=%s", (pid,))
        row = cur.fetchone()
        if row is None:
            raise ActionError("not_proposed", "this action has no proposal for this incident version", status=404)
        cur.execute("SELECT created_at FROM action_log WHERE proposal_id=%s AND phase='execute' ORDER BY created_at LIMIT 1", (pid,))
        executed = cur.fetchone()
        if executed is not None:
            # Verify from the last event that had been processed when the action was approved, not from the trigger.
            cur.execute(
                """SELECT coalesce(max(run_seq), %s) s FROM processed_events
                   WHERE run_id=%s AND run_seq <= %s AND event_time <= %s""",
                (after_seq, run_id, ctx["cutoff_seq"], executed["created_at"]),
            )
            after_seq = max(after_seq, int(one(cur)["s"]))
    action = catalog_mod.by_id(catalog_mod.load_catalog(config_dir), action_id)
    if action is None:
        raise ActionError("action_not_found", f"action {action_id!r} is not in the catalog", status=404)
    result = verify_mod.run(
        conn, verification=action["verification"], run_id=run_id, params=dict(row["params"]),
        after_seq=after_seq, cutoff_seq=ctx["cutoff_seq"],
    )
    b = binding_mod.BoundAction(action=action, params=dict(row["params"]))
    _append_log(conn, ctx, b, proposal=pid, phase="verify", operator=operator, adapter="query",
                request={"query_id": result["query_id"], "after_seq": after_seq, "params": dict(row["params"])},
                result=result, outcome=result["status"], error=None, params_hash=str(row["params_hash"]))
    return {"proposal_id": pid, "verification": result}


# ------------------------------------------------------------------------------------------------- persistence

def _upsert_proposal(conn: psycopg.Connection[Any], ctx: dict[str, Any], b: binding_mod.BoundAction, *, state: str) -> str:
    run_id, incident_id, v = ctx["run"]["run_id"], ctx["incident"]["incident_id"], ctx["version_number"]
    pid = proposal_id(run_id, incident_id, v, b.action_id)
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO action_proposals (proposal_id, run_id, incident_id, version, action_id, playbook_id, kind, severity,
                   reversible, params, params_hash, bound_fact_ids, catalog_version, state)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (proposal_id) DO UPDATE SET params=EXCLUDED.params, params_hash=EXCLUDED.params_hash,
                   bound_fact_ids=EXCLUDED.bound_fact_ids, state=EXCLUDED.state, updated_at=now()""",
            (pid, run_id, incident_id, v, b.action_id, b.action["playbook_id"], b.action["kind"], b.action["severity"],
             bool(b.action.get("reversible", True)), jsonb(b.params), b.params_hash, b.bound_fact_ids,
             catalog_mod.CATALOG_VERSION, state),
        )
    return pid


def _set_state(conn: psycopg.Connection[Any], pid: str, state: str) -> None:
    with conn.cursor() as cur:
        cur.execute("UPDATE action_proposals SET state=%s, updated_at=now() WHERE proposal_id=%s", (state, pid))


def _append_log(
    conn: psycopg.Connection[Any], ctx: dict[str, Any], b: binding_mod.BoundAction, *, proposal: str, phase: str,
    operator: str, adapter: str, request: dict[str, Any], result: dict[str, Any] | None, outcome: str, error: str | None,
    params_hash: str | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO action_log (proposal_id, run_id, incident_id, version, action_id, kind, phase, operator,
                   adapter, params_hash, request, result, outcome, error)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (proposal, ctx["run"]["run_id"], ctx["incident"]["incident_id"], ctx["version_number"], b.action_id,
             b.action["kind"], phase, operator, adapter, params_hash or b.params_hash, jsonb(request),
             jsonb(result) if result is not None else None, outcome, error),
        )


def _stamp_containment(conn: psycopg.Connection[Any], run_id: str, incident_id: str, *, mode: str) -> datetime | None:
    """First containment wins; a later applied action upgrades a preview stamp but never the other way round."""
    now = datetime.now(UTC)
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE incidents SET contained_at = coalesce(contained_at, %s),
                   containment_mode = CASE WHEN %s = 'applied' THEN 'applied' ELSE coalesce(containment_mode, 'preview') END,
                   updated_at = now()
               WHERE run_id=%s AND incident_id=%s RETURNING contained_at""",
            (now, mode, run_id, incident_id),
        )
        row = cur.fetchone()
    return (row or {}).get("contained_at")


def _clear_containment_if_last(conn: psycopg.Connection[Any], run_id: str, incident_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT count(*) n FROM action_proposals
               WHERE run_id=%s AND incident_id=%s AND severity='containment' AND state='executed'""",
            (run_id, incident_id),
        )
        if int(one(cur)["n"]) == 0:
            cur.execute(
                "UPDATE incidents SET contained_at=NULL, containment_mode=NULL, updated_at=now() WHERE run_id=%s AND incident_id=%s",
                (run_id, incident_id),
            )


def _emit(conn: psycopg.Connection[Any], ctx: dict[str, Any], payload: dict[str, Any]) -> None:
    run_id = ctx["run"]["run_id"]
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO ui_updates (run_id, update_seq, type, payload)
               VALUES (%s, (SELECT coalesce(max(update_seq),0)+1 FROM ui_updates WHERE run_id=%s), 'action', %s)""",
            (run_id, run_id, jsonb({"incident_id": ctx["incident"]["incident_id"], **payload})),
        )
