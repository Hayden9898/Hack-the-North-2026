"""Bounded, read-only, parameterised investigation tools. run_id and cutoff are injected by the backend; the model
cannot override them. All parameters are bound SQL values. Budgets: max calls and max returned rows per job."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import psycopg

from app.investigation import playbooks as pb_mod

MAX_PARAM_LEN = 200
MAX_LIMIT = 50


@dataclass
class ToolBudget:
    max_calls: int
    max_rows: int
    calls: int = 0
    rows: int = 0
    log: list[dict[str, Any]] = field(default_factory=list)


class ToolContext:
    def __init__(self, conn: psycopg.Connection[Any], run_id: str, cutoff_seq: int, packet: dict[str, Any], budget: ToolBudget, catalog: list[dict[str, Any]]):
        self.conn = conn
        self.run_id = run_id
        self.cutoff_seq = cutoff_seq
        self.packet = packet
        self.budget = budget
        self.catalog = catalog

    # ----------------------------------------------------------------------------------------- dispatch

    def call(self, name: str, args: Any) -> tuple[str, bool]:
        """Returns (json_text, is_error). Never raises to the caller loop."""
        if self.budget.calls >= self.budget.max_calls:
            return json.dumps({"error": "tool call budget exhausted"}), True
        self.budget.calls += 1
        fn = TOOLS.get(name)
        if fn is None:
            self.budget.log.append({"tool": name, "error": "unknown tool"})
            return json.dumps({"error": f"unknown tool {name!r}; only the documented read-only tools exist"}), True
        if not isinstance(args, dict):
            return json.dumps({"error": "arguments must be an object"}), True
        # Injected fields are never accepted from the model.
        for forbidden in ("run_id", "cutoff_seq", "sql", "query"):
            if forbidden in args:
                self.budget.log.append({"tool": name, "error": f"forbidden parameter {forbidden}"})
                return json.dumps({"error": f"parameter {forbidden!r} is not accepted"}), True
        try:
            result = fn(self, **{k: _clean(v) for k, v in args.items()})
        except TypeError as exc:
            return json.dumps({"error": f"invalid arguments: {exc}"[:200]}), True
        except psycopg.Error as exc:
            self.conn.rollback()
            return json.dumps({"error": f"query failed: {type(exc).__name__}"}), True
        rows = result.get("rows", []) if isinstance(result, dict) else []
        remaining = self.budget.max_rows - self.budget.rows
        if len(rows) > remaining:
            result["rows"] = rows[: max(0, remaining)]
            result["truncated_by_budget"] = True
        self.budget.rows += len(result.get("rows", [])) if isinstance(result, dict) else 0
        self.budget.log.append({"tool": name, "args": args, "rows": len(result.get("rows", [])) if isinstance(result, dict) else 0})
        return json.dumps(result, default=str), False

    # ----------------------------------------------------------------------------------------- helpers

    def _rows(self, sql: str, params: dict[str, Any], limit: int) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), MAX_LIMIT))
        with self.conn.cursor() as cur:
            cur.execute(sql + " ORDER BY p.run_seq DESC LIMIT %(lim)s", {**params, "run": self.run_id, "cutoff": self.cutoff_seq, "lim": limit})
            rows = [dict(r) for r in cur.fetchall()]
        self.conn.commit()
        for r in rows:
            for k, v in list(r.items()):
                if hasattr(v, "isoformat"):
                    r[k] = v.isoformat()
        return rows


def _clean(v: Any) -> Any:
    if isinstance(v, str):
        return v[:MAX_PARAM_LEN]
    if isinstance(v, (int, float, bool)) or v is None:
        return v
    raise TypeError("nested values are not accepted")


COLS = "p.run_seq, p.event_time, p.username, p.ip_raw, p.method, p.path, p.status, p.response_bytes, p.threat_class"
BASE = "FROM processed_events p WHERE p.run_id = %(run)s AND p.run_seq <= %(cutoff)s"


def account_history(ctx: ToolContext, account: str, limit: int = 20) -> dict[str, Any]:
    """Recent processed requests for an account before the cutoff, plus counts by status."""
    with ctx.conn.cursor() as cur:
        cur.execute(f"SELECT p.status, count(*) n {BASE} AND p.username=%(a)s GROUP BY 1 ORDER BY 1", {"run": ctx.run_id, "cutoff": ctx.cutoff_seq, "a": account})
        counts = {str(r["status"]): r["n"] for r in cur.fetchall()}
    rows = ctx._rows(f"SELECT {COLS} {BASE} AND p.username=%(a)s", {"a": account}, limit)
    return {"account": account, "status_counts_before_cutoff": counts, "rows": rows}


def pair_auth_history(ctx: ToolContext, account: str, ip: str, limit: int = 20) -> dict[str, Any]:
    """Login events for an account/source pair before the cutoff, plus counts by status."""
    with ctx.conn.cursor() as cur:
        cur.execute(f"SELECT p.status, count(*) n {BASE} AND p.username=%(a)s AND p.ip_raw=%(ip)s AND p.route_family='login' GROUP BY 1", {"run": ctx.run_id, "cutoff": ctx.cutoff_seq, "a": account, "ip": ip})
        counts = {str(r["status"]): r["n"] for r in cur.fetchall()}
    rows = ctx._rows(f"SELECT {COLS} {BASE} AND p.username=%(a)s AND p.ip_raw=%(ip)s AND p.route_family='login'", {"a": account, "ip": ip}, limit)
    return {"pair": f"{account}|{ip}", "login_status_counts_before_cutoff": counts, "rows": rows}


def resource_history(ctx: ToolContext, path: str, limit: int = 20) -> dict[str, Any]:
    """Who received which status for an exact path before the cutoff, plus the most recent requests."""
    with ctx.conn.cursor() as cur:
        cur.execute(f"SELECT p.username, p.status, count(*) n {BASE} AND p.path=%(p)s GROUP BY 1,2 ORDER BY 1,2", {"run": ctx.run_id, "cutoff": ctx.cutoff_seq, "p": path})
        audience = [dict(r) for r in cur.fetchall()]
    rows = ctx._rows(f"SELECT {COLS} {BASE} AND p.path=%(p)s", {"p": path}, limit)
    return {"path": path, "audience_before_cutoff": audience, "rows": rows}


def related_object_events(ctx: ToolContext, object_id: str, limit: int = 20) -> dict[str, Any]:
    """Requests referencing a forum object id before the cutoff."""
    rows = ctx._rows(f"SELECT {COLS}, p.route_family {BASE} AND p.object_id=%(o)s", {"o": object_id}, limit)
    return {"object_id": object_id, "rows": rows}


def playbook_catalog(ctx: ToolContext) -> dict[str, Any]:
    """Playbooks applicable to this incident (ids you may select)."""
    kinds = {f["kind"] for f in ctx.packet["facts"]}
    rules = list(ctx.packet.get("rule_ids", []))
    return {"playbooks": [pb_mod.brief(p) for p in pb_mod.applicable(ctx.catalog, rules, kinds)], "rows": []}


TOOLS = {
    "account_history": account_history,
    "pair_auth_history": pair_auth_history,
    "resource_history": resource_history,
    "related_object_events": related_object_events,
    "playbook_catalog": playbook_catalog,
}


def tool_definitions() -> list[dict[str, Any]]:
    """Client tool definitions for the Messages API (strict schemas)."""
    s = {"type": "string", "maxLength": MAX_PARAM_LEN}
    lim = {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT}
    return [
        {"name": "account_history", "description": account_history.__doc__ or "", "strict": True,
         "input_schema": {"type": "object", "additionalProperties": False, "required": ["account", "limit"], "properties": {"account": s, "limit": lim}}},
        {"name": "pair_auth_history", "description": pair_auth_history.__doc__ or "", "strict": True,
         "input_schema": {"type": "object", "additionalProperties": False, "required": ["account", "ip", "limit"], "properties": {"account": s, "ip": s, "limit": lim}}},
        {"name": "resource_history", "description": resource_history.__doc__ or "", "strict": True,
         "input_schema": {"type": "object", "additionalProperties": False, "required": ["path", "limit"], "properties": {"path": s, "limit": lim}}},
        {"name": "related_object_events", "description": related_object_events.__doc__ or "", "strict": True,
         "input_schema": {"type": "object", "additionalProperties": False, "required": ["object_id", "limit"], "properties": {"object_id": s, "limit": lim}}},
        {"name": "playbook_catalog", "description": playbook_catalog.__doc__ or "", "strict": True,
         "input_schema": {"type": "object", "additionalProperties": False, "required": [], "properties": {}}},
    ]
