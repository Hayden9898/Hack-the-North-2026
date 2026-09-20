"""Runs: creation, replay control, live ingestion, status and cutoff-scoped processed evidence."""
from __future__ import annotations

from datetime import datetime
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api import deps
from app.config import DetectionConfig
from app.db.engine import one
from app.ingest.live import admit_live_batch
from app.settings import Settings
from app.workers import runs as runs_mod

router = APIRouter(tags=["runs"])


class RunCreate(BaseModel):
    dataset_id: str | None = None
    mode: str = Field(default="replay", pattern="^(replay|live)$")
    name: str = ""
    visible_start: datetime | None = None
    range_start: datetime | None = None
    range_end: datetime | None = None
    model_id: str | None = None  # pin a registered model; default: the newest active model
    speed: float | None = Field(default=None, ge=0)
    pause_at_visible_start: bool = False
    source_id: str | None = None


class ReplayControl(BaseModel):
    action: str = Field(pattern="^(start|pause|resume|speed)$")
    speed: float | None = Field(default=None, ge=0)


class LiveItem(BaseModel):
    event_id: str = Field(min_length=1, max_length=200)
    line: str = Field(max_length=65536)


class LiveBatch(BaseModel):
    source_id: str = Field(min_length=1, max_length=100)
    events: list[LiveItem] = Field(max_length=1000)


def serialize_run(run: dict[str, Any], s: Settings, counts: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = run.get("config") or {}
    return {
        "run_id": run["run_id"],
        "name": run["name"],
        "dataset_id": run["dataset_id"],
        "source_id": run["source_id"],
        "mode": run["mode"],
        "phase": run["phase"],
        "state": run["state"],
        "model_id": run["model_id"],
        "model_health": run["model_health"],
        "config_hash": run["config_hash"],
        "reference_hash": cfg.get("reference_hash"),
        "feature_version": run["feature_version"],
        "visible_start": run["visible_start"],
        "range_start": run["range_start"],
        "range_end": run["range_end"],
        "admitted_seq": run["admitted_seq"],
        "processed_seq": run["processed_seq"],
        "backlog": int(run["admitted_seq"]) - int(run["processed_seq"]),
        "last_admitted_time": run["last_admitted_time"],
        "last_processed_time": run["last_processed_time"],
        "virtual_time": runs_mod.current_virtual_time(run),
        "speed": run["speed"],
        "block_reason": run["block_reason"],
        "blocked_seq": run["blocked_seq"],
        "late_count": run["late_count"],
        "notifications_sent": run["notifications_sent"],
        "pause_at_visible_start": bool(cfg.get("pause_at_visible_start")),
        "integrations": s.integration_status(),
        "counts": counts or {},
        "created_at": run["created_at"],
        "updated_at": run["updated_at"],
    }


@router.get("/runs")
def list_runs(conn: psycopg.Connection[Any] = Depends(deps.db), s: Settings = Depends(deps.settings)) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM runs ORDER BY created_at DESC LIMIT 100")
        return [serialize_run(dict(r), s) for r in cur.fetchall()]


@router.post("/runs", status_code=201)
def create_run(
    body: RunCreate,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    cfg: DetectionConfig = Depends(deps.config),
    s: Settings = Depends(deps.settings),
    _: str = Depends(deps.require_operator),
) -> dict[str, Any]:
    if body.mode == "replay" and not body.dataset_id:
        raise HTTPException(status_code=422, detail="replay runs need a dataset_id")
    if body.dataset_id:
        with conn.cursor() as cur:
            cur.execute("SELECT import_state FROM datasets WHERE id=%s", (body.dataset_id,))
            row = cur.fetchone()
        if row is None or row["import_state"] != "ready":
            raise HTTPException(status_code=409, detail="dataset is not ready")
    if body.model_id:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM models WHERE model_id=%s", (body.model_id,))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="model not found")
    run = runs_mod.create_run(
        conn, cfg, dataset_id=body.dataset_id, mode=body.mode, name=body.name, visible_start=body.visible_start,
        range_start=body.range_start, range_end=body.range_end, model_id=body.model_id, speed=body.speed,
        pause_at_visible_start=body.pause_at_visible_start, source_id=body.source_id,
    )
    if body.mode == "live":
        runs_mod.control(conn, run["run_id"], "start")
        run = runs_mod.get_run(conn, run["run_id"]) or run
    return serialize_run(run, s)


@router.get("/runs/{run_id}")
def get_run(run_id: str, conn: psycopg.Connection[Any] = Depends(deps.db), s: Settings = Depends(deps.settings)) -> dict[str, Any]:
    run = deps.load_run(conn, run_id)
    with conn.cursor() as cur:
        cur.execute("SELECT phase, threat_class, count(*) n FROM detections WHERE run_id=%s GROUP BY 1,2", (run_id,))
        counts: dict[str, Any] = {"warmup": {}, "visible": {}}
        for r in cur.fetchall():
            counts.setdefault(r["phase"], {})[r["threat_class"] or "unscored"] = r["n"]
        cur.execute("SELECT current_class, count(*) n FROM incidents WHERE run_id=%s GROUP BY 1", (run_id,))
        counts["incidents"] = {r["current_class"]: r["n"] for r in cur.fetchall()}
        cur.execute("SELECT state, count(*) n FROM notification_outbox WHERE run_id=%s GROUP BY 1", (run_id,))
        counts["notifications"] = {r["state"]: r["n"] for r in cur.fetchall()}
        cur.execute("SELECT state, count(*) n FROM explanation_jobs WHERE run_id=%s GROUP BY 1", (run_id,))
        counts["explanation_jobs"] = {r["state"]: r["n"] for r in cur.fetchall()}
        cur.execute("SELECT count(*) n FROM run_late_events WHERE run_id=%s", (run_id,))
        counts["late_events"] = one(cur)["n"]
        counts["containment"] = _containment_counts(cur, run_id)
    return serialize_run(run, s, counts)


def _containment_counts(cur: Any, run_id: str) -> dict[str, Any]:
    """Actionable incidents, how many reached a containment action, and the median wall time it took.

    `median_seconds` measures console time — detection to approval — and is only meaningful for incidents an
    operator worked during this session. `preview` counts containments recorded without contacting any system.
    """
    cur.execute(
        """SELECT count(*) FILTER (WHERE current_class IN ('suspicious','high_risk'))          AS actionable,
                  count(*) FILTER (WHERE contained_at IS NOT NULL)                             AS contained,
                  count(*) FILTER (WHERE containment_mode = 'preview')                         AS preview,
                  count(*) FILTER (WHERE containment_mode = 'applied')                         AS applied,
                  percentile_disc(0.5) WITHIN GROUP (
                      ORDER BY extract(epoch FROM (contained_at - created_at))
                  ) FILTER (WHERE contained_at IS NOT NULL)                                    AS median_seconds
           FROM incidents WHERE run_id=%s""",
        (run_id,),
    )
    row = dict(one(cur))
    median = row.pop("median_seconds", None)
    return {**{k: int(v or 0) for k, v in row.items()}, "median_seconds": float(median) if median is not None else None}


@router.post("/runs/{run_id}/replay")
def replay_control(
    run_id: str,
    body: ReplayControl,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    cfg: DetectionConfig = Depends(deps.config),
    s: Settings = Depends(deps.settings),
    _: str = Depends(deps.require_operator),
) -> dict[str, Any]:
    deps.load_run(conn, run_id)
    try:
        run = runs_mod.control(conn, run_id, body.action, speed=body.speed, max_speed=float(cfg.policy["replay"]["max_speed"]))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return serialize_run(run, s)


@router.post("/runs/{run_id}/events")
def live_events(
    run_id: str,
    body: LiveBatch,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    cfg: DetectionConfig = Depends(deps.config),
    _: str = Depends(deps.require_ingest_token),
) -> dict[str, Any]:
    deps.load_run(conn, run_id)
    try:
        out = admit_live_batch(conn, run_id, body.source_id, [i.model_dump() for i in body.events], cfg)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {
        "counts": out.counts,
        "received": len(body.events),
        "admitted_seq": out.admitted_seq,
        "late_count": out.late_count,
        "items": [i.__dict__ for i in out.items],
    }


@router.get("/runs/{run_id}/events")
def list_events(
    run_id: str,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    after_seq: int = Query(default=0, ge=0),
    before_seq: int | None = Query(default=None, ge=0),
    limit: int = Query(default=100, ge=1, le=200),
    threat_class: str | None = Query(default=None, pattern="^(normal|suspicious|high_risk)$"),
    phase: str | None = Query(default=None, pattern="^(warmup|visible)$"),
    account: str | None = None,
    order: str = Query(default="asc", pattern="^(asc|desc)$"),
) -> dict[str, Any]:
    """Processed evidence only, never beyond the run cutoff. Cursor = run_seq."""
    run = deps.load_run(conn, run_id)
    cutoff = int(run["processed_seq"])
    clauses = ["d.run_id = %(run)s", "d.run_seq <= %(cutoff)s"]
    params: dict[str, Any] = {"run": run_id, "cutoff": cutoff, "lim": limit}
    if after_seq:
        clauses.append("d.run_seq > %(after)s")
        params["after"] = after_seq
    if before_seq is not None:
        clauses.append("d.run_seq < %(before)s")
        params["before"] = before_seq
    if threat_class:
        clauses.append("d.threat_class = %(tc)s")
        params["tc"] = threat_class
    if phase:
        clauses.append("d.phase = %(phase)s")
        params["phase"] = phase
    if account:
        # Semi-join keeps the account filter inside the bounded detections scan (index on processed_events(run_id, username, event_time)).
        clauses.append("EXISTS (SELECT 1 FROM processed_events p2 WHERE p2.run_id = d.run_id AND p2.run_seq = d.run_seq AND p2.event_time = d.event_time AND p2.username = %(acct)s)")
        params["acct"] = account
    direction = "DESC" if order == "desc" else "ASC"
    with conn.cursor() as cur:
        # Select the page from detections first (PK order + LIMIT), then join. Joining before limiting made the planner
        # hash-join the whole hypertable (measured 108–900 ms on 180k rows); this form is index lookups only.
        cur.execute(
            f"""WITH page AS (
                    SELECT d.* FROM detections d WHERE {' AND '.join(clauses)} ORDER BY d.run_seq {direction} LIMIT %(lim)s
                )
                SELECT d.run_seq, d.event_id, d.event_time, d.phase, d.threat_class, d.processing_status, d.model_score, d.anomaly_percentile,
                       d.model_flagged, d.model_health, d.reason_codes, d.rule_ids, d.top_deviations,
                       p.username, p.ip_raw, p.method, p.path, p.status, p.response_bytes, p.route_family, p.object_id, e.line_number
                FROM page d
                JOIN processed_events p ON p.run_id = d.run_id AND p.run_seq = d.run_seq AND p.event_time = d.event_time
                LEFT JOIN event_registry e ON e.event_id = d.event_id
                ORDER BY d.run_seq {direction}""",
            params,
        )
        rows = [dict(r) for r in cur.fetchall()]
    next_cursor = rows[-1]["run_seq"] if rows else after_seq
    return {"cutoff_seq": cutoff, "items": rows, "next_after_seq": next_cursor, "has_more": len(rows) == limit}


@router.get("/runs/{run_id}/events/{run_seq}")
def get_event(run_id: str, run_seq: int, conn: psycopg.Connection[Any] = Depends(deps.db)) -> dict[str, Any]:
    run = deps.load_run(conn, run_id)
    if run_seq > int(run["processed_seq"]):
        raise HTTPException(status_code=404, detail="event not yet processed in this run")
    with conn.cursor() as cur:
        cur.execute(
            """SELECT d.*, r.raw_line, r.raw_target, r.query_keys, r.original_time, r.offset_minutes, r.username, r.ip_raw, r.method, r.path,
                      r.status, r.response_bytes, r.route_family, r.object_id, e.line_number, e.dataset_id,
                      f.numeric_vector, f.observed_context, f.feature_version
               FROM detections d
               JOIN raw_events r ON r.event_id = d.event_id AND r.event_time = d.event_time
               LEFT JOIN event_registry e ON e.event_id = d.event_id
               LEFT JOIN feature_snapshots f ON f.run_id = d.run_id AND f.run_seq = d.run_seq
               WHERE d.run_id=%s AND d.run_seq=%s""",
            (run_id, run_seq),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="event not found")
        cur.execute("SELECT incident_id, relation_type, rule_id FROM incident_evidence WHERE run_id=%s AND event_id=%s", (run_id, row["event_id"]))
        memberships = [dict(r) for r in cur.fetchall()]
    from app.features.vector import FEATURE_NAMES

    out = dict(row)
    vec = out.pop("numeric_vector", None)
    out["features"] = dict(zip(FEATURE_NAMES, vec, strict=False)) if vec else None
    out["incident_memberships"] = memberships
    return out


@router.get("/runs/{run_id}/late")
def list_late(run_id: str, conn: psycopg.Connection[Any] = Depends(deps.db), limit: int = Query(default=100, le=200)) -> dict[str, Any]:
    deps.load_run(conn, run_id)
    with conn.cursor() as cur:
        cur.execute(
            """SELECT l.event_id, l.event_time, l.watermark, l.received_at, r.username, r.ip_raw, r.method, r.path, r.status
               FROM run_late_events l JOIN raw_events r ON r.event_id = l.event_id AND r.event_time = l.event_time
               WHERE l.run_id=%s ORDER BY l.received_at DESC LIMIT %s""",
            (run_id, limit),
        )
        return {"items": [dict(r) for r in cur.fetchall()]}
