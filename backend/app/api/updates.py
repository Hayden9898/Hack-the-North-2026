"""Server-sent events backed by the durable ui_updates table; resumable via Last-Event-ID; never holds a detector lock."""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sse_starlette.sse import EventSourceResponse

from app.api import deps
from app.db.engine import one, transaction
from app.settings import Settings

router = APIRouter(tags=["updates"])

HEARTBEAT_SECONDS = 15
POLL_SECONDS = 0.5
MAX_GAP = 5000  # if a client is further behind than this, tell it to resync from a snapshot


def _require_run(url: str, run_id: str) -> None:
    with transaction(url) as conn:
        deps.load_run(conn, run_id)


def _fetch(url: str, run_id: str, after: int, limit: int = 200) -> tuple[list[dict[str, Any]], int]:
    with transaction(url) as conn, conn.cursor() as cur:
        cur.execute("SELECT coalesce(max(update_seq), 0) AS m FROM ui_updates WHERE run_id=%s", (run_id,))
        latest = int(one(cur)["m"])
        cur.execute(
            "SELECT update_seq, type, payload, committed_at FROM ui_updates WHERE run_id=%s AND update_seq > %s ORDER BY update_seq LIMIT %s",
            (run_id, after, limit),
        )
        rows = [dict(r) for r in cur.fetchall()]
    return rows, latest


@router.get("/runs/{run_id}/updates")
async def updates(
    request: Request,
    run_id: str,
    s: Settings = Depends(deps.settings),
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    after: int | None = Query(default=None, ge=0),
    once: bool = Query(default=False, description="polling fallback: send what is available, then close"),
) -> EventSourceResponse:
    # Pool checkout can block for seconds when the database is down; keep it off the event loop so /health/live stays live.
    await asyncio.get_running_loop().run_in_executor(None, _require_run, s.database_url, run_id)
    try:
        cursor = int(last_event_id) if last_event_id else (after if after is not None else 0)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Last-Event-ID must be an integer") from exc

    async def gen() -> AsyncIterator[dict[str, Any]]:
        nonlocal cursor
        loop = asyncio.get_running_loop()
        rows, latest = await loop.run_in_executor(None, _fetch, s.database_url, run_id, cursor)
        if latest - cursor > MAX_GAP:
            yield {"event": "resync_required", "id": str(latest), "data": json.dumps({"latest_seq": latest, "your_seq": cursor})}
            cursor = latest
            rows = []
        idle = 0.0
        while not await request.is_disconnected():
            if not rows:
                rows, latest = await loop.run_in_executor(None, _fetch, s.database_url, run_id, cursor)
            if rows:
                for r in rows:
                    cursor = int(r["update_seq"])
                    yield {"event": r["type"], "id": str(cursor), "data": json.dumps({"seq": cursor, "committed_at": r["committed_at"].isoformat(), **r["payload"]})}
                rows = []
                idle = 0.0
                if once:
                    return
                continue
            if once:
                yield {"event": "heartbeat", "id": str(cursor), "data": json.dumps({"seq": cursor})}
                return
            await asyncio.sleep(POLL_SECONDS)
            idle += POLL_SECONDS
            if idle >= HEARTBEAT_SECONDS:
                idle = 0.0
                yield {"event": "heartbeat", "id": str(cursor), "data": json.dumps({"seq": cursor})}

    return EventSourceResponse(gen(), ping=HEARTBEAT_SECONDS * 4)


@router.get("/runs/{run_id}/updates/snapshot")
def snapshot(run_id: str, s: Settings = Depends(deps.settings)) -> dict[str, Any]:
    """Latest update sequence for clients that need to resync."""
    with transaction(s.database_url) as conn:
        deps.load_run(conn, run_id)
        with conn.cursor() as cur:
            cur.execute("SELECT coalesce(max(update_seq),0) m FROM ui_updates WHERE run_id=%s", (run_id,))
            return {"latest_seq": int(one(cur)["m"])}
