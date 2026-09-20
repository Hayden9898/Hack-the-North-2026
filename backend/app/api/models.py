"""Models: registered artifacts and which one new runs attach by default."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import psycopg
from fastapi import APIRouter, Depends

from app.api import deps
from app.settings import Settings
from app.workers import runs as runs_mod

router = APIRouter(tags=["models"])


@router.get("/models")
def list_models(conn: psycopg.Connection[Any] = Depends(deps.db), s: Settings = Depends(deps.settings)) -> list[dict[str, Any]]:
    """Newest first. `is_default` marks the model a run gets when none is chosen (the newest active one)."""
    default = runs_mod.active_model_id(conn)
    with conn.cursor() as cur:
        cur.execute(
            """SELECT model_id, feature_version, status, threshold, reference_hash, artifact_sha256, created_at,
                      manifest->>'algorithm' AS algorithm, manifest->>'threshold_percentile' AS threshold_percentile
               FROM models ORDER BY created_at DESC, model_id DESC"""
        )
        rows = [dict(r) for r in cur.fetchall()]
    model_dir = Path(s.model_dir)
    return [
        {
            **r,
            "is_default": r["model_id"] == default,
            "artifact_present": (model_dir / r["model_id"] / "manifest.json").exists(),
        }
        for r in rows
    ]
