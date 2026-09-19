"""Dataset upload (streamed to a configured directory, size-limited) and import progress."""
from __future__ import annotations

import hashlib
import uuid
from pathlib import Path
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, UploadFile

from app.api import deps
from app.db.engine import jsonb, one
from app.ingest.importer import dataset_id_for
from app.ingest.parser import PARSE_VERSION
from app.settings import Settings

router = APIRouter(tags=["datasets"])


def _serialize(d: dict[str, Any]) -> dict[str, Any]:
    return {
        "dataset_id": d["id"],
        "content_sha256": d["content_sha256"],
        "original_name": d["original_name"],
        "bytes": d["bytes"],
        "import_state": d["import_state"],
        "progress_line": d["progress_line"],
        "progress_bytes": d["progress_bytes"],
        "total_lines": d["total_lines"],
        "valid_count": d["valid_count"],
        "rejected_count": d["rejected_count"],
        "first_event_time": d["first_event_time"],
        "last_event_time": d["last_event_time"],
        "stats": {k: v for k, v in (d["stats"] or {}).items() if k != "upload_path"},
        "error": d["error"],
        "created_at": d["created_at"],
    }


@router.get("/datasets")
def list_datasets(conn: psycopg.Connection[Any] = Depends(deps.db)) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM datasets ORDER BY created_at DESC")
        return [_serialize(dict(r)) for r in cur.fetchall()]


@router.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str, conn: psycopg.Connection[Any] = Depends(deps.db)) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM datasets WHERE id=%s", (dataset_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="dataset not found")
        cur.execute("SELECT line_number, reason, left(raw_input, 300) AS raw_input FROM ingestion_rejects WHERE dataset_id=%s ORDER BY line_number LIMIT 50", (dataset_id,))
        rejects = [dict(r) for r in cur.fetchall()]
    out = _serialize(dict(row))
    out["rejects_sample"] = rejects
    return out


@router.post("/datasets", status_code=202)
async def upload_dataset(
    file: UploadFile,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    s: Settings = Depends(deps.settings),
    _: str = Depends(deps.require_operator),
) -> dict[str, Any]:
    """Stream the upload to UPLOAD_DIR under a server-generated name; the side-effect worker imports it."""
    upload_dir = Path(s.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    tmp = upload_dir / f"upload-{uuid.uuid4()}.log"
    h = hashlib.sha256()
    size = 0
    with tmp.open("wb") as out:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > s.max_upload_bytes:
                out.close()
                tmp.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="upload exceeds configured size limit")
            h.update(chunk)
            out.write(chunk)
    digest = h.hexdigest()
    dataset_id = dataset_id_for(digest)
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM datasets WHERE id=%s", (dataset_id,))
        existing = cur.fetchone()
        if existing:
            tmp.unlink(missing_ok=True)
            return {**_serialize(dict(existing)), "job": "existing"}
        final = upload_dir / f"{dataset_id}.log"
        tmp.replace(final)
        cur.execute(
            """INSERT INTO datasets (id, content_sha256, original_name, bytes, parse_version, import_state, stats)
               VALUES (%s, %s, %s, %s, %s, 'pending', %s) RETURNING *""",
            (dataset_id, digest, (file.filename or "upload.log")[:200], size, PARSE_VERSION, jsonb({"upload_path": str(final)})),
        )
        row = dict(one(cur))
    return {**_serialize(row), "job": "queued"}
