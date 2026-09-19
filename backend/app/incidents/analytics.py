"""Tiger analytics: continuous aggregate for the dashboard with an explicit refresh watermark, a non-overlapping raw
tail, and raw as-of views for pinned historical inspection (architecture.md §4 Tiger analytics).

The aggregate never influences detection; it serves charts only.
"""
from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

from app.db.engine import normalize_url, one
from app.observability import sentry

CAGG = "processed_events_5m"
BUCKET = timedelta(minutes=5)

RAW_SELECT = """
SELECT time_bucket('5 minutes', event_time) AS bucket, username AS account,
       count(*) AS events, count(*) FILTER (WHERE status = 401) AS c401, count(*) FILTER (WHERE status = 403) AS c403,
       sum(coalesce(response_bytes, 0)) AS response_bytes,
       count(*) FILTER (WHERE threat_class = 'high_risk') AS high_risk, count(*) FILTER (WHERE threat_class = 'suspicious') AS suspicious
FROM processed_events
WHERE run_id = %(run)s {extra}
GROUP BY 1, 2
"""


def aggregate_available(conn: psycopg.Connection[Any]) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM timescaledb_information.continuous_aggregates WHERE view_name = %s", (CAGG,))
        return cur.fetchone() is not None


def refresh_run(database_url: str, run_id: str) -> dict[str, Any]:
    """Explicitly refresh the aggregate over the run's processed time range (autocommit connection; the CALL cannot run
    inside a transaction). Records the watermark in aggregate_refreshes."""
    t0 = time.perf_counter()
    with psycopg.connect(normalize_url(database_url), autocommit=True) as conn, conn.cursor() as cur:
        cur.execute("SELECT min(event_time) a, max(event_time) b FROM processed_events WHERE run_id = %s", (run_id,))
        row = cur.fetchone()
        if row is None or row[0] is None:
            return {"refreshed": False, "reason": "no processed events"}
        start = row[0] - BUCKET
        end = row[1] + BUCKET  # refresh window end is exclusive of the last (possibly partial) bucket boundary
        with sentry.span("analytics.refresh", run_id=run_id):
            cur.execute("CALL refresh_continuous_aggregate(%s, %s, %s)", (CAGG, start, end))
        # Buckets whose end is <= the last processed time are complete; the watermark is the start of the first
        # bucket that may still receive events.
        watermark = _bucket_floor(row[1])
        cur.execute(f"SELECT count(*) n FROM {CAGG} WHERE run_id = %s", (run_id,))
        buckets = int(one(cur)[0])
        dur = int((time.perf_counter() - t0) * 1000)
        cur.execute(
            """INSERT INTO aggregate_refreshes (run_id, refreshed_through, refreshed_at, buckets, duration_ms) VALUES (%s, %s, now(), %s, %s)
               ON CONFLICT (run_id) DO UPDATE SET refreshed_through = EXCLUDED.refreshed_through, refreshed_at = now(), buckets = EXCLUDED.buckets, duration_ms = EXCLUDED.duration_ms""",
            (run_id, watermark, buckets, dur),
        )
    return {"refreshed": True, "refreshed_through": watermark, "buckets": buckets, "duration_ms": dur}


def _bucket_floor(t: datetime) -> datetime:
    epoch = datetime(2000, 1, 3, tzinfo=UTC)  # time_bucket origin for interval buckets
    n = int((t - epoch) // BUCKET)
    return epoch + n * BUCKET


def timeseries(
    conn: psycopg.Connection[Any],
    run_id: str,
    *,
    account: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    as_of_seq: int | None = None,
    force_raw: bool = False,
    bucket_minutes: int = 5,
    group_by_account: bool = True,
) -> dict[str, Any]:
    """5-minute buckets for the dashboard.

    - as_of_seq: pinned historical view → raw processed records with run_seq <= cutoff (never the aggregate, which may
      contain later-processed events).
    - otherwise: complete materialized buckets up to the recorded refresh watermark plus a raw tail from the
      watermark onward; if no refresh has happened (or the aggregate is missing) everything comes from raw.
    """
    params: dict[str, Any] = {"run": run_id}
    extra = ""
    if account:
        extra += " AND username = %(acct)s"
        params["acct"] = account
    if start:
        extra += " AND event_time >= %(start)s"
        params["start"] = start
    if end:
        extra += " AND event_time < %(end)s"
        params["end"] = end
    source: dict[str, Any] = {}
    rows: list[dict[str, Any]] = []
    try:
        rows, source = _timeseries(conn, run_id, params, extra, as_of_seq, force_raw)
    except psycopg.errors.UndefinedTable:
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute(RAW_SELECT.format(extra=extra) + " ORDER BY 1, 2", params)
            rows = [dict(r) for r in cur.fetchall()]
        source = {"mode": "raw_fallback", "reason": "aggregate tables missing (migration pending)", "stale": True}
    rows = _rollup(rows, bucket_minutes, group_by_account)
    source["bucket_minutes"] = bucket_minutes
    source["group_by_account"] = group_by_account
    return {"rows": rows, "source": source}


def _rollup(rows: list[dict[str, Any]], bucket_minutes: int, group_by_account: bool) -> list[dict[str, Any]]:
    """Server-side roll-up of 5-minute rows to coarser bins and/or across accounts (charts only)."""
    if bucket_minutes <= 5 and group_by_account:
        return rows
    width = timedelta(minutes=max(5, bucket_minutes))
    epoch = datetime(2000, 1, 3, tzinfo=UTC)
    out: dict[tuple[Any, Any], dict[str, Any]] = {}
    for r in rows:
        b = epoch + ((r["bucket"] - epoch) // width) * width if bucket_minutes > 5 else r["bucket"]
        key = (b, r["account"] if group_by_account else None)
        acc = out.setdefault(key, {"bucket": b, "account": r["account"] if group_by_account else None, "events": 0, "c401": 0, "c403": 0, "response_bytes": 0, "high_risk": 0, "suspicious": 0})
        for k in ("events", "c401", "c403", "response_bytes", "high_risk", "suspicious"):
            acc[k] += int(r[k] or 0)
    return [out[k] for k in sorted(out, key=lambda t: (t[0], t[1] or ""))]


def _timeseries(conn: psycopg.Connection[Any], run_id: str, params: dict[str, Any], extra: str, as_of_seq: int | None, force_raw: bool) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    source: dict[str, Any] = {}
    rows: list[dict[str, Any]] = []
    with conn.cursor() as cur:
        if as_of_seq is not None:
            params["cut"] = as_of_seq
            cur.execute(RAW_SELECT.format(extra=extra + " AND run_seq <= %(cut)s") + " ORDER BY 1, 2", params)
            rows = [dict(r) for r in cur.fetchall()]
            source = {"mode": "raw_as_of", "as_of_seq": as_of_seq}
            return rows, source
        cur.execute("SELECT refreshed_through, refreshed_at, buckets FROM aggregate_refreshes WHERE run_id = %s", (run_id,))
        wm = cur.fetchone()
        available = (not force_raw) and wm is not None and aggregate_available(conn)
        assert wm is not None or not available
        cur.execute("SELECT max(event_time) m FROM processed_events WHERE run_id = %s", (run_id,))
        last = one(cur)["m"]
        if not available:
            cur.execute(RAW_SELECT.format(extra=extra) + " ORDER BY 1, 2", params)
            rows = [dict(r) for r in cur.fetchall()]
            source = {"mode": "raw_fallback", "reason": "aggregate never refreshed for this run" if wm is None else ("forced" if force_raw else "aggregate unavailable"), "stale": True}
            if wm is None and last is not None:
                sentry.log_event("aggregate_stale", "info", run_id=run_id, reason="no_refresh")
            return rows, source
        assert wm is not None
        watermark = wm["refreshed_through"]
        agg_extra = extra.replace("username", "account").replace("event_time", "bucket")
        cur.execute(
            f"SELECT bucket, account, events, c401, c403, response_bytes, high_risk, suspicious FROM {CAGG} WHERE run_id = %(run)s AND bucket < %(wm)s {agg_extra} ORDER BY 1, 2",
            {**params, "wm": watermark},
        )
        agg_rows = [dict(r) for r in cur.fetchall()]
        cur.execute(RAW_SELECT.format(extra=extra + " AND event_time >= %(wm)s") + " ORDER BY 1, 2", {**params, "wm": watermark})
        tail_rows = [dict(r) for r in cur.fetchall()]
        rows = agg_rows + tail_rows
        stale = last is not None and last - watermark > timedelta(hours=1)
        if stale:
            sentry.log_event("aggregate_stale", "info", run_id=run_id, lag_seconds=(last - watermark).total_seconds())
        source = {"mode": "aggregate_plus_raw_tail", "materialized_through": watermark, "refreshed_at": wm["refreshed_at"], "materialized_buckets": len(agg_rows),
                  "raw_tail_buckets": len(tail_rows), "stale": stale, "last_processed_time": last}
    return rows, source


def compare_raw_vs_aggregate(conn: psycopg.Connection[Any], run_id: str, repeats: int = 5) -> dict[str, Any]:
    """Benchmark identical results and latency: raw GROUP BY vs materialized aggregate for the whole run."""
    with conn.cursor() as cur:
        cur.execute("SELECT refreshed_through FROM aggregate_refreshes WHERE run_id = %s", (run_id,))
        wm = cur.fetchone()
        if wm is None:
            return {"error": "aggregate not refreshed for run"}
        watermark = wm["refreshed_through"]
        raw_sql = RAW_SELECT.format(extra=" AND event_time < %(wm)s") + " ORDER BY 1, 2"
        agg_sql = f"SELECT bucket, account, events, c401, c403, response_bytes, high_risk, suspicious FROM {CAGG} WHERE run_id = %(run)s AND bucket < %(wm)s ORDER BY 1, 2"
        p = {"run": run_id, "wm": watermark}
        raw_t, agg_t = [], []
        raw_rows = agg_rows = None
        for _ in range(repeats):
            t = time.perf_counter()
            cur.execute(raw_sql, p)
            raw_rows = [tuple(r.values()) for r in cur.fetchall()]
            raw_t.append((time.perf_counter() - t) * 1000)
            t = time.perf_counter()
            cur.execute(agg_sql, p)
            agg_rows = [tuple(r.values()) for r in cur.fetchall()]
            agg_t.append((time.perf_counter() - t) * 1000)
    identical = raw_rows == agg_rows
    # Dashboard-shaped query: daily totals across the run (small result set; aggregate rolls up 5-minute buckets).
    with conn.cursor() as cur:
        raw_daily = """SELECT time_bucket('1 day', event_time) d, count(*) events, count(*) FILTER (WHERE status=401) c401,
                              count(*) FILTER (WHERE threat_class='high_risk') hr FROM processed_events
                       WHERE run_id = %(run)s AND event_time < %(wm)s GROUP BY 1 ORDER BY 1"""
        agg_daily = f"""SELECT time_bucket('1 day', bucket) d, sum(events) events, sum(c401) c401, sum(high_risk) hr FROM {CAGG}
                        WHERE run_id = %(run)s AND bucket < %(wm)s GROUP BY 1 ORDER BY 1"""
        rd_t, ad_t = [], []
        rd = ad = None
        for _ in range(repeats):
            t = time.perf_counter()
            cur.execute(raw_daily, p)
            rd = [tuple(int(x) if isinstance(x, int) else x for x in r.values()) for r in cur.fetchall()]
            rd_t.append((time.perf_counter() - t) * 1000)
            t = time.perf_counter()
            cur.execute(agg_daily, p)
            ad = [tuple(int(x) if isinstance(x, int) else x for x in r.values()) for r in cur.fetchall()]
            ad_t.append((time.perf_counter() - t) * 1000)
    daily = {"rows": len(rd or []), "identical_results": rd == ad, "raw_ms_median": sorted(rd_t)[len(rd_t) // 2], "aggregate_ms_median": sorted(ad_t)[len(ad_t) // 2]}
    return {
        "daily_rollup": daily,
        "watermark": watermark,
        "rows": len(raw_rows or []),
        "identical_results": identical,
        "raw_ms": {"median": sorted(raw_t)[len(raw_t) // 2], "min": min(raw_t), "max": max(raw_t)},
        "aggregate_ms": {"median": sorted(agg_t)[len(agg_t) // 2], "min": min(agg_t), "max": max(agg_t)},
        "repeats": repeats,
    }
