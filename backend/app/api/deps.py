"""Shared API dependencies: DB transactions, authentication for mutations/ingestion on shared deployments."""
from __future__ import annotations

import hmac
from collections.abc import Iterator
from typing import Any

import psycopg
from fastapi import Depends, Header, HTTPException, Request

from app.config import DetectionConfig, get_config
from app.db.engine import transaction
from app.settings import Settings, get_settings


def settings() -> Settings:
    return get_settings()


def config(s: Settings = Depends(settings)) -> DetectionConfig:
    return get_config(s.config_dir)


def db(s: Settings = Depends(settings)) -> Iterator[psycopg.Connection[Any]]:
    try:
        with transaction(s.database_url) as conn:
            yield conn
    except psycopg.OperationalError as exc:
        raise HTTPException(status_code=503, detail={"error": "database_unavailable", "type": type(exc).__name__}) from exc


def require_operator(request: Request, s: Settings = Depends(settings), authorization: str | None = Header(default=None)) -> str:
    """Mutations: on a loopback demo without APP_AUTH_SECRET anyone local is the operator; otherwise a bearer secret."""
    if not s.app_auth_secret:
        if s.loopback_only:
            return "local-operator"
        raise HTTPException(status_code=503, detail="APP_AUTH_SECRET must be configured for non-loopback deployments")
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token or not hmac.compare_digest(token, s.app_auth_secret):
        raise HTTPException(status_code=401, detail="operator authentication required")
    return "operator"


def require_ingest_token(s: Settings = Depends(settings), x_ingest_token: str | None = Header(default=None)) -> str:
    """Live ingestion is authenticated by INGEST_TOKEN whenever one is configured (always on shared deployments)."""
    if not s.ingest_token:
        if s.loopback_only:
            return "local-source"
        raise HTTPException(status_code=503, detail="INGEST_TOKEN must be configured for non-loopback deployments")
    if not x_ingest_token or not hmac.compare_digest(x_ingest_token, s.ingest_token):
        raise HTTPException(status_code=401, detail="invalid ingest token")
    return "authenticated-source"


def load_run(conn: psycopg.Connection[Any], run_id: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM runs WHERE run_id=%s", (run_id,))
        row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="run not found")
    return dict(row)
