"""Response packet: one Markdown handoff containing everything the person doing the remediation needs.

The packet is rendered from committed rows only — the incident version, the typed facts with their evidence
references, the validated explanation if one exists, the applicable playbooks and the bound actions with their
parameters and verification criteria. It restates the fact packet hash so a reader can tell which snapshot of the
evidence it was written from, and it states plainly what the logs do not contain.
"""
from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any

import psycopg

from app.actions import binding as binding_mod
from app.investigation import playbooks as pb_mod


def render(
    conn: psycopg.Connection[Any],
    ctx: dict[str, Any],
    bound: list[binding_mod.BoundAction],
    *,
    app_base_url: str,
    execution_mode: str,
    config_dir: str | None = None,
) -> str:
    inc, ver, v = ctx["incident"], ctx["version"], ctx["version_number"]
    run_id, incident_id = ctx["run"]["run_id"], inc["incident_id"]
    packet = ctx["packet"] or {}
    facts = list(packet.get("facts") or [])
    link = f"{app_base_url.rstrip('/')}/runs/{run_id}/incidents/{incident_id}"

    with conn.cursor() as cur:
        cur.execute("SELECT state, validated FROM explanations WHERE run_id=%s AND incident_id=%s AND version=%s", (run_id, incident_id, v))
        expl = cur.fetchone()
        cur.execute(
            """SELECT e.run_seq, e.event_time, reg.line_number, p.username, p.ip_raw, p.method, p.path, p.status
               FROM incident_evidence e
               JOIN processed_events p ON p.run_id=e.run_id AND p.run_seq=e.run_seq AND p.event_time=e.event_time
               LEFT JOIN event_registry reg ON reg.event_id = e.event_id
               WHERE e.run_id=%s AND e.incident_id=%s AND e.run_seq <= %s
               GROUP BY e.run_seq, e.event_time, reg.line_number, p.username, p.ip_raw, p.method, p.path, p.status
               ORDER BY e.run_seq""",
            (run_id, incident_id, ctx["cutoff_seq"]),
        )
        timeline = [dict(r) for r in cur.fetchall()]
        cur.execute(
            "SELECT reviewer, disposition, reason, created_at FROM analyst_feedback WHERE run_id=%s AND incident_id=%s ORDER BY created_at",
            (run_id, incident_id),
        )
        feedback = [dict(r) for r in cur.fetchall()]
        cur.execute(
            """SELECT action_id, phase, operator, adapter, outcome, created_at FROM action_log
               WHERE run_id=%s AND incident_id=%s ORDER BY created_at, id""",
            (run_id, incident_id),
        )
        action_log = [dict(r) for r in cur.fetchall()]

    kinds = {f["kind"] for f in facts}
    rule_ids = [str(r) for r in (ver.get("rule_ids") or [])]
    playbooks = pb_mod.applicable(pb_mod.load_catalog(config_dir), rule_ids, kinds)
    selected = set(((expl or {}).get("validated") or {}).get("playbook_ids") or [])

    L: list[str] = []
    w = L.append
    w(f"# Response packet — incident {incident_id[:12]} v{v}")
    w("")
    # No wall-clock stamp: the packet is a pure function of committed rows under the cutoff, so identical evidence
    # renders to an identical document and an identical sha256 (which is also its idempotency key when sent).
    w(f"*Rendered from committed evidence under run cutoff #{ctx['cutoff_seq']} (last event "
      f"{_ts(ctx['run'].get('last_processed_time'))}). Nothing in this document was written by a language model.*")
    w("")
    w("| | |")
    w("|---|---|")
    w(f"| Classification | **{ver['threat_class']}** |")
    w(f"| Rules matched | {', '.join(rule_ids) or '—'} |")
    w(f"| Account | `{inc.get('account') or '—'}` |")
    w(f"| Source | `{inc.get('ip_raw') or '—'}` |")
    w(f"| Window | {_ts(ver.get('timeline_start'))} → {_ts(ver.get('timeline_end'))} |")
    w(f"| Trigger | run_seq #{ver.get('trigger_seq')} (`{str(ver.get('trigger_event_id') or '')[:16]}`) |")
    w(f"| Fact packet | `{ctx.get('packet_hash') or '—'}` |")
    w(f"| Status | {inc.get('status')}{_containment(inc)} |")
    w(f"| Console | {link} |")
    w("")

    w("## What was observed")
    w("")
    if not facts:
        w("_No fact packet was stored for this version._")
    for role, title in (("trigger", "Trigger facts"), ("support", "Supporting facts"), ("context", "Context and counterevidence")):
        group = [f for f in facts if f.get("role") == role]
        if not group:
            continue
        w(f"### {title}")
        w("")
        for f in group:
            refs = f.get("evidence_event_ids") or []
            where = f"{len(refs)} evidence line(s)" if refs else (f"aggregate query `{(f.get('query') or {}).get('id')}`" if f.get("query") else "derived")
            w(f"- **{f['kind']}** = `{_short(f.get('value'))}` — {where} · `{f['fact_id']}` · cutoff #{f.get('cutoff_seq')}")
        w("")

    if timeline:
        w("## Timeline (exact log lines)")
        w("")
        w("| # | line | time | account | source | request | status |")
        w("|---|---|---|---|---|---|---|")
        for t in timeline[:60]:
            w(f"| {t['run_seq']} | {t.get('line_number') or '—'} | {_ts(t.get('event_time'))} | `{t['username']}` | "
              f"`{t['ip_raw']}` | `{t['method']} {t['path']}` | {t['status']} |")
        if len(timeline) > 60:
            w(f"| … | | {len(timeline) - 60} further evidence lines in the console | | | | |")
        w("")

    w("## What these logs cannot tell you")
    w("")
    unknowns = list(packet.get("unknown_codes") or [])
    if unknowns:
        for u in unknowns:
            w(f"- `{u}`")
    else:
        w("- The access log records requests and status codes only: no session identity, request body, user agent, "
          "or the contents of any change an endpoint made.")
    w("")
    if expl is not None:
        w(f"AI review state: **{expl['state']}**. The AI may only select facts and qualified hypotheses that a "
          "validator checks; it cannot assert anything the fact packet does not contain.")
        w("")

    w("## Recommended review steps")
    w("")
    for pb in playbooks:
        mark = " *(selected by the AI review)*" if pb["id"] in selected else ""
        w(f"### {pb['title']}{mark}")
        w("")
        w(f"_Uncertainty:_ {pb['uncertainty']}")
        w("")
        w("**Evidence to obtain (not present in these logs)**")
        w("")
        for r in pb.get("required_evidence") or []:
            w(f"- {r}")
        w("")
        w("**Steps**")
        w("")
        for s in pb.get("proposed_steps") or []:
            if isinstance(s, dict):
                for cond, step in s.items():
                    w(f"1. *{cond}:* {step}")
            else:
                w(f"1. {s}")
        w("")
        for label in ("permissions", "impact", "verification", "rollback"):
            val = pb.get(label)
            if val:
                w(f"- **{label}:** {_join(val)}")
        w("")

    w("## Containment actions bound to this incident")
    w("")
    w(f"Execution mode: **{execution_mode}**. Every parameter below was bound by code from a typed fact or from the "
      "incident record — no parameter came from a language model.")
    w("")
    for b in bound:
        entry = b.as_dict()
        state = "available" if b.available else "unavailable"
        w(f"### {entry['title']} (`{entry['action_id']}`, {entry['severity']}, {state})")
        w("")
        w(entry["summary"])
        w("")
        if entry["params"]:
            w("| parameter | value | bound from |")
            w("|---|---|---|")
            for k, val in entry["params"].items():
                w(f"| {k} | `{val}` | `{entry['bound_from'].get(k, '—')}` |")
            w("")
        if not b.available:
            for reason in b.unmet:
                w(f"- not available: {reason}")
            w("")
            continue
        w(f"- **impact:** {entry['impact']}")
        w(f"- **permissions:** {_join(entry.get('permissions'))}")
        w(f"- **rollback:** {_join(entry['rollback'])}")
        w(f"- **verification:** {entry['verification'].get('criterion')}")
        w("")

    if action_log:
        w("## Action log (append-only)")
        w("")
        w("| time | action | phase | operator | adapter | outcome |")
        w("|---|---|---|---|---|---|")
        for a in action_log:
            w(f"| {_ts(a['created_at'])} | `{a['action_id']}` | {a['phase']} | {a['operator']} | {a['adapter']} | {a['outcome']} |")
        w("")

    if feedback:
        w("## Analyst dispositions")
        w("")
        for f in feedback:
            w(f"- **{f['disposition']}** — {f['reviewer']} at {_ts(f['created_at'])}: {f['reason']}")
        w("")

    return "\n".join(L).rstrip() + "\n"


def sha256(markdown: str) -> str:
    return hashlib.sha256(markdown.encode("utf-8")).hexdigest()


def _containment(inc: dict[str, Any]) -> str:
    if not inc.get("contained_at"):
        return ""
    return f" · contained {_ts(inc['contained_at'])} ({inc.get('containment_mode')})"


def _ts(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    return str(value or "—")


def _short(value: Any, limit: int = 80) -> str:
    s = str(value)
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _join(value: Any) -> str:
    if isinstance(value, list):
        return "; ".join(str(v) for v in value)
    return str(value or "—")
