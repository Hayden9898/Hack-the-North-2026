"""Liveness and readiness. Readiness distinguishes a missing database from optional integrations."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Response

from app.config import get_config
from app.db import migrate
from app.db.engine import connect_direct, ping
from app.observability import sentry
from app.settings import get_settings
from app.workers import runs as runs_mod

router = APIRouter(tags=["health"])


@router.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready")
def ready(response: Response) -> dict[str, Any]:
    settings = get_settings()
    db_ok, db_detail = ping(settings.database_url)
    migrations: dict[str, Any] = {"current": None, "head": None, "ok": False}
    if db_ok:
        try:
            current, head = migrate.current_and_head(settings.database_url)
            migrations = {"current": current, "head": head, "ok": current == head}
        except Exception as exc:  # noqa: BLE001
            migrations = {"current": None, "head": None, "ok": False, "error": type(exc).__name__}
    model_dir = Path(settings.model_dir)
    manifests = sorted(p.parent.name for p in model_dir.glob("*/manifest.json")) if model_dir.exists() else []
    config_ok = True
    config_hash = None
    try:
        config_hash = get_config(settings.config_dir).config_hash
    except Exception:  # noqa: BLE001
        config_ok = False
    # A non-loopback bind without both secrets is a deployment that answers 503 to every mutation: not ready, and say why.
    auth_ok = settings.loopback_only or bool(settings.app_auth_secret and settings.ingest_token)
    blocking: list[str] = []
    if not db_ok:
        blocking.append("database_unavailable")
    elif not migrations["ok"]:
        blocking.append("migrations_behind")
    if not config_ok:
        blocking.append("config_invalid")
    if not auth_ok:
        blocking.append("auth_secrets_missing")
    status = "ready" if not blocking else "not_ready"
    degraded: list[str] = []
    integrations = settings.integration_status()
    if integrations["sentry"] != "enabled":
        degraded.append("sentry_disabled")
    if not integrations["llm"].startswith("enabled"):
        degraded.append("llm_deterministic_only")
    if integrations["slack"] != "live":
        degraded.append("slack_preview")
    if not manifests:
        degraded.append("no_model_artifacts_rules_only")
    active_model = None
    if db_ok:
        try:
            with connect_direct(settings.database_url) as conn:
                active_model = runs_mod.active_model_id(conn)
        except Exception:  # noqa: BLE001
            active_model = None
    if active_model is None:
        degraded.append("no_active_model_rules_only")
    if status != "ready":
        response.status_code = 503
    return {
        "status": status,
        "database": {"ok": db_ok, "detail": db_detail},
        "migrations": migrations,
        "config": {"ok": config_ok, "hash": config_hash},
        "models": {"artifacts": manifests, "active": active_model},
        # Whether a browser must present an operator bearer token for mutations. Never the token itself.
        "auth": {"operator_required": settings.operator_auth_required, "ingest_required": settings.ingest_auth_required},
        "integrations": integrations,
        "sentry_active": sentry.enabled(),
        "degraded_modes": degraded,
        "not_ready_reasons": blocking,
    }
