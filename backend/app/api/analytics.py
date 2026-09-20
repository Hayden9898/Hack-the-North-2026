"""Dashboard analytics backed by the Tiger continuous aggregate (with explicit refresh, raw tail and as-of fallback)."""
from __future__ import annotations

from datetime import datetime
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, Query

from app.api import deps
from app.incidents import analytics
from app.observability import sentry
from app.settings import Settings

router = APIRouter(tags=["analytics"])


@router.get("/runs/{run_id}/analytics/timeseries")
def timeseries(
    run_id: str,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    account: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    as_of_seq: int | None = Query(default=None, ge=0),
    force_raw: bool = False,
    bucket_minutes: int = Query(default=5, description="5, 60 or 1440; coarser bins are rolled up server-side"),
    group_by_account: bool = Query(default=False, description="false sums all accounts per bucket (default for charts)"),
) -> dict[str, Any]:
    run = deps.load_run(conn, run_id)
    if as_of_seq is not None:
        as_of_seq = min(as_of_seq, int(run["processed_seq"]))
    if bucket_minutes not in (5, 60, 1440):
        bucket_minutes = 5
    with sentry.span("analytics.query", run_id=run_id, bucket_minutes=bucket_minutes):
        out = analytics.timeseries(conn, run_id, account=account, start=start, end=end, as_of_seq=as_of_seq, force_raw=force_raw,
                                   bucket_minutes=bucket_minutes, group_by_account=group_by_account)
    out["cutoff_seq"] = int(run["processed_seq"])
    return out


@router.post("/runs/{run_id}/analytics/refresh")
def refresh(run_id: str, conn: psycopg.Connection[Any] = Depends(deps.db), s: Settings = Depends(deps.settings), _: str = Depends(deps.require_operator)) -> dict[str, Any]:
    deps.load_run(conn, run_id)
    conn.commit()
    return analytics.refresh_run(s.database_url, run_id)


@router.get("/runs/{run_id}/analytics/benchmark")
def benchmark(run_id: str, conn: psycopg.Connection[Any] = Depends(deps.db), repeats: int = Query(default=5, ge=1, le=20)) -> dict[str, Any]:
    deps.load_run(conn, run_id)
    with sentry.span("analytics.benchmark", run_id=run_id, repeats=repeats):
        return analytics.compare_raw_vs_aggregate(conn, run_id, repeats)
