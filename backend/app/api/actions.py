"""Containment actions: bound proposals, dry run, execute, verify, rollback, and the response packet.

Every mutation is operator-authenticated and lands in the append-only action log. The router holds no logic beyond
mapping refusals from the service layer onto HTTP status codes.
"""
from __future__ import annotations

from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.actions import adapters as adapters_mod
from app.actions import packet as packet_mod
from app.actions import service
from app.api import deps
from app.config import canonical_hash
from app.db.engine import jsonb
from app.settings import Settings

router = APIRouter(tags=["actions"])


def _adapter(s: Settings) -> Any:
    return adapters_mod.build_adapter(s)


def _ctx(conn: psycopg.Connection[Any], run_id: str, incident_id: str, version: int | None) -> dict[str, Any]:
    run = deps.load_run(conn, run_id)
    try:
        return service.load_context(conn, run, incident_id, version)
    except service.ActionError as exc:
        raise HTTPException(status_code=exc.status, detail={"error": exc.code, "message": exc.message, **exc.extra}) from exc


def _call(fn: Any, *args: Any, **kwargs: Any) -> Any:
    try:
        return fn(*args, **kwargs)
    except service.ActionError as exc:
        raise HTTPException(status_code=exc.status, detail={"error": exc.code, "message": exc.message, **exc.extra}) from exc


@router.get("/runs/{run_id}/incidents/{incident_id}/actions")
def list_actions(
    run_id: str,
    incident_id: str,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    s: Settings = Depends(deps.settings),
    version: int | None = Query(default=None, ge=1),
) -> dict[str, Any]:
    ctx = _ctx(conn, run_id, incident_id, version)
    return service.list_for_incident(conn, ctx, s.config_dir, adapter_name=getattr(_adapter(s), "name", "preview"))


@router.post("/runs/{run_id}/incidents/{incident_id}/actions/{action_id}/dry-run")
def dry_run_action(
    run_id: str,
    incident_id: str,
    action_id: str,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    s: Settings = Depends(deps.settings),
    operator: str = Depends(deps.require_operator),
    version: int | None = Query(default=None, ge=1),
) -> dict[str, Any]:
    ctx = _ctx(conn, run_id, incident_id, version)
    return _call(service.dry_run, conn, ctx, action_id, operator=operator, adapter=_adapter(s), config_dir=s.config_dir)


@router.post("/runs/{run_id}/incidents/{incident_id}/actions/{action_id}/execute")
def execute_action(
    run_id: str,
    incident_id: str,
    action_id: str,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    s: Settings = Depends(deps.settings),
    operator: str = Depends(deps.require_operator),
    version: int | None = Query(default=None, ge=1),
) -> dict[str, Any]:
    ctx = _ctx(conn, run_id, incident_id, version)
    return _call(service.execute, conn, ctx, action_id, operator=operator, adapter=_adapter(s), config_dir=s.config_dir)


@router.post("/runs/{run_id}/incidents/{incident_id}/actions/{action_id}/verify")
def verify_action(
    run_id: str,
    incident_id: str,
    action_id: str,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    s: Settings = Depends(deps.settings),
    operator: str = Depends(deps.require_operator),
    version: int | None = Query(default=None, ge=1),
) -> dict[str, Any]:
    ctx = _ctx(conn, run_id, incident_id, version)
    return _call(service.verify, conn, ctx, action_id, operator=operator, config_dir=s.config_dir)


@router.post("/runs/{run_id}/incidents/{incident_id}/actions/{action_id}/rollback")
def rollback_action(
    run_id: str,
    incident_id: str,
    action_id: str,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    s: Settings = Depends(deps.settings),
    operator: str = Depends(deps.require_operator),
    version: int | None = Query(default=None, ge=1),
) -> dict[str, Any]:
    ctx = _ctx(conn, run_id, incident_id, version)
    return _call(service.rollback, conn, ctx, action_id, operator=operator, adapter=_adapter(s), config_dir=s.config_dir)


# ------------------------------------------------------------------------------------------------- response packet

@router.get("/runs/{run_id}/incidents/{incident_id}/response-packet")
def get_response_packet(
    run_id: str,
    incident_id: str,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    s: Settings = Depends(deps.settings),
    version: int | None = Query(default=None, ge=1),
    download: bool = Query(default=False),
) -> Any:
    ctx = _ctx(conn, run_id, incident_id, version)
    adapter = _adapter(s)
    md = packet_mod.render(
        conn, ctx, service.applicable_actions(ctx, s.config_dir),
        app_base_url=s.app_base_url, execution_mode="live" if getattr(adapter, "name", "preview") != "preview" else "preview",
        config_dir=s.config_dir,
    )
    if download:
        name = f"response-packet-{incident_id[:12]}-v{ctx['version_number']}.md"
        return Response(
            content=md,
            media_type="text/markdown; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )
    return {
        "run_id": run_id,
        "incident_id": incident_id,
        "version": ctx["version_number"],
        "fact_packet_hash": ctx.get("packet_hash"),
        "content_sha256": packet_mod.sha256(md),
        "markdown": md,
    }


@router.post("/runs/{run_id}/incidents/{incident_id}/response-packet", status_code=201)
def store_response_packet(
    run_id: str,
    incident_id: str,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    s: Settings = Depends(deps.settings),
    operator: str = Depends(deps.require_operator),
    version: int | None = Query(default=None, ge=1),
    notify: bool = Query(default=True, description="Also queue a handoff message through the notification outbox."),
) -> dict[str, Any]:
    """Persist the packet and (by default) queue a link to it for delivery, honouring the existing preview mode."""
    ctx = _ctx(conn, run_id, incident_id, version)
    adapter = _adapter(s)
    md = packet_mod.render(
        conn, ctx, service.applicable_actions(ctx, s.config_dir),
        app_base_url=s.app_base_url, execution_mode="live" if getattr(adapter, "name", "preview") != "preview" else "preview",
        config_dir=s.config_dir,
    )
    digest = packet_mod.sha256(md)
    packet_id = "rp_" + canonical_hash({"run": run_id, "incident": incident_id, "v": ctx["version_number"], "sha": digest})[:20]
    v = ctx["version_number"]
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO response_packets (packet_id, run_id, incident_id, version, fact_packet_hash, content_sha256, markdown, created_by)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (packet_id) DO NOTHING""",
            (packet_id, run_id, incident_id, v, ctx.get("packet_hash"), digest, md, operator),
        )
    queued = False
    if notify:
        queued = _queue_handoff(conn, ctx, packet_id=packet_id, digest=digest, app_base_url=s.app_base_url)
    return {"packet_id": packet_id, "content_sha256": digest, "version": v, "notification_queued": queued}


def _queue_handoff(conn: psycopg.Connection[Any], ctx: dict[str, Any], *, packet_id: str, digest: str, app_base_url: str) -> bool:
    """Reuses the durable outbox, so a handoff obeys the same preview/live rules and retry semantics as an alert."""
    run_id, inc, v = ctx["run"]["run_id"], ctx["incident"], ctx["version_number"]
    incident_id = inc["incident_id"]
    link = f"{app_base_url.rstrip('/')}/runs/{run_id}/incidents/{incident_id}"
    rules = ", ".join(str(r) for r in (ctx["version"].get("rule_ids") or []))
    title = f"Response packet · incident {incident_id[:8]} v{v} · {rules}"
    text = "\n".join([
        title,
        f"account={inc.get('account')} source={inc.get('ip_raw')} class={ctx['version'].get('threat_class')}",
        f"packet sha256={digest[:16]}…",
        f"Open in Log & Order: {link}",
    ])
    payload = {
        "kind": "response_packet",
        "text": text,
        "blocks": [
            {"type": "header", "text": {"type": "plain_text", "text": title[:150]}},
            {"type": "section", "text": {"type": "mrkdwn", "text": f"account `{inc.get('account')}` · source `{inc.get('ip_raw')}`\npacket `{digest[:16]}`"}},
            {"type": "section", "text": {"type": "mrkdwn", "text": f"<{link}|Open incident>"}},
        ],
        "meta": {"run_id": run_id, "incident_id": incident_id, "version": v, "packet_id": packet_id},
    }
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO notification_outbox (idempotency_key, run_id, incident_id, version, notification_kind, destination_key,
                   payload, state, next_attempt_at)
               VALUES (%s,%s,%s,%s,'response_packet','slack:default',%s,'pending', now())
               ON CONFLICT (idempotency_key) DO NOTHING""",
            (f"{run_id}:{incident_id}:response_packet:{digest[:16]}", run_id, incident_id, v, jsonb(payload)),
        )
        return cur.rowcount > 0
