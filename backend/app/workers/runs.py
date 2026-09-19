"""Run lifecycle: creation (isolated state + frozen reference), replay admission and control operations.

A run owns its ordering, reference, model, thresholds, incidents, jobs and notifications. Reset = new run.
Admission assigns contiguous run_seq in (event_time, original line) order and is bounded by the queue cap and,
in the visible phase, by virtual time.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

from app.config import DetectionConfig
from app.db.engine import jsonb
from app.features.reference import Reference, build_reference
from app.observability import sentry

CONTROL_STATES = {"created", "warming", "running", "paused", "completed", "blocked"}


def create_run(
    conn: psycopg.Connection[Any],
    cfg: DetectionConfig,
    *,
    dataset_id: str | None,
    mode: str = "replay",
    name: str = "",
    visible_start: datetime | None = None,
    range_start: datetime | None = None,
    range_end: datetime | None = None,
    model_id: str | None = None,
    speed: float | None = None,
    pause_at_visible_start: bool = False,
    source_id: str | None = None,
    reference: Reference | None = None,
) -> dict[str, Any]:
    run_id = str(uuid.uuid4())
    if reference is None:
        if dataset_id:
            reference = build_reference(conn, dataset_id, cfg)
        else:
            reference = Reference.empty()
    config = {
        "policy": cfg.policy,
        "routes_version": cfg.routes.version,
        "config_hash": cfg.config_hash,
        "reference": reference.to_dict(),
        "reference_hash": reference.hash,
        "pause_at_visible_start": pause_at_visible_start,
    }
    if visible_start is None:
        visible_start = cfg.partitions["evaluation"].start if dataset_id else datetime.now(UTC)
    if mode == "live":
        phase = "visible"  # live runs have no historical range to warm through
    else:
        phase = "warmup" if (range_start or datetime.min.replace(tzinfo=UTC)) < visible_start else "visible"
    model_health = "rules_only" if model_id is None else "pending_load"
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO runs (run_id, name, dataset_id, source_id, mode, phase, model_id, model_health, config_hash, config,
                   feature_version, visible_start, range_start, range_end, speed, state, virtual_time,
                   last_admitted_time, last_admitted_line)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'created', %s, %s, 0) RETURNING *""",
            (run_id, name, dataset_id, source_id, mode, phase, model_id, model_health, cfg.config_hash, jsonb(config), cfg.feature_version,
             visible_start, range_start, range_end, float(cfg.policy["replay"]["default_speed"]) if speed is None else float(speed),
             visible_start if phase == "visible" else range_start, range_start or datetime(1970, 1, 1, tzinfo=UTC)),
        )
        row = dict(cur.fetchone())
    return row


def get_run(conn: psycopg.Connection[Any], run_id: str, lock: bool = False) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(f"SELECT * FROM runs WHERE run_id=%s{' FOR UPDATE' if lock else ''}", (run_id,))
        row = cur.fetchone()
    return dict(row) if row else None


def current_virtual_time(run: dict[str, Any], now: datetime | None = None) -> datetime | None:
    """Virtual clock for replay in the visible phase: anchor + (wall elapsed) × speed while running."""
    vt = run.get("virtual_time")
    if vt is None or float(run.get("speed") or 0) <= 0:
        return None  # speed 0 = unbounded fast-forward: admission is limited only by the queue cap
    if run["state"] != "running" or run.get("virtual_anchor_wall") is None:
        return vt
    now = now or datetime.now(UTC)
    return vt + timedelta(seconds=(now - run["virtual_anchor_wall"]).total_seconds() * float(run["speed"]))


def control(conn: psycopg.Connection[Any], run_id: str, action: str, speed: float | None = None, max_speed: float = 1e5) -> dict[str, Any]:
    """start | pause | resume | speed. Reset is deliberately not an action (create a new run)."""
    run = get_run(conn, run_id, lock=True)
    if run is None:
        raise KeyError(run_id)
    now = datetime.now(UTC)
    state = run["state"]
    with conn.cursor() as cur:
        if action == "start":
            if state != "created":
                raise ValueError(f"cannot start a run in state {state}")
            new_state = "warming" if run["phase"] == "warmup" else "running"
            cur.execute(
                "UPDATE runs SET state=%s, virtual_anchor_wall=%s, updated_at=now() WHERE run_id=%s",
                (new_state, now, run_id),
            )
        elif action == "pause":
            if state not in ("warming", "running"):
                raise ValueError(f"cannot pause a run in state {state}")
            vt = current_virtual_time(run, now)
            cur.execute("UPDATE runs SET state='paused', virtual_time=%s, virtual_anchor_wall=NULL, updated_at=now() WHERE run_id=%s", (vt, run_id))
        elif action == "resume":
            if state != "paused":
                raise ValueError(f"cannot resume a run in state {state}")
            new_state = "warming" if run["phase"] == "warmup" else "running"
            cur.execute("UPDATE runs SET state=%s, virtual_anchor_wall=%s, updated_at=now() WHERE run_id=%s", (new_state, now, run_id))
        elif action == "speed":
            if speed is None or speed < 0:
                raise ValueError("speed must be >= 0 (0 = unbounded fast-forward)")
            speed = min(float(speed), max_speed) if speed > 0 else 0.0
            vt = current_virtual_time(run, now)
            cur.execute(
                "UPDATE runs SET speed=%s, virtual_time=%s, virtual_anchor_wall=CASE WHEN state='running' THEN %s ELSE virtual_anchor_wall END, updated_at=now() WHERE run_id=%s",
                (speed, vt, now, run_id),
            )
        else:
            raise ValueError(f"unknown action {action}")
    updated = get_run(conn, run_id)
    assert updated is not None
    return updated


def admit_replay(conn: psycopg.Connection[Any], run_id: str, cfg: DetectionConfig, now: datetime | None = None) -> dict[str, Any]:
    """Admit the next bounded batch from the dataset. Returns {'admitted': n, 'phase_changed': bool, 'exhausted': bool}."""
    now = now or datetime.now(UTC)
    run = get_run(conn, run_id, lock=True)
    if run is None or run["mode"] != "replay" or run["state"] not in ("warming", "running"):
        return {"admitted": 0, "phase_changed": False, "exhausted": False}
    cap = int(cfg.policy["replay"]["queue_cap"])
    backlog = int(run["admitted_seq"]) - int(run["processed_seq"])
    room = cap - backlog
    if room <= 0:
        return {"admitted": 0, "phase_changed": False, "exhausted": False}
    params: dict[str, Any] = {
        "ds": run["dataset_id"],
        "t": run["last_admitted_time"] or datetime(1970, 1, 1, tzinfo=UTC),
        "ln": int(run["last_admitted_line"] or 0),
        "lim": room,
    }
    clauses = ["dataset_id = %(ds)s", "(event_time, line_number) > (%(t)s, %(ln)s)"]
    if run["range_end"] is not None:
        clauses.append("event_time < %(end)s")
        params["end"] = run["range_end"]
    upper: datetime | None = None
    if run["phase"] == "warmup":
        upper = run["visible_start"]
        clauses.append("event_time < %(upper)s")
    else:
        vt = current_virtual_time(run, now)
        if vt is not None:
            upper = vt
            clauses.append("event_time <= %(upper)s")
    if upper is not None:
        params["upper"] = upper
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT event_id, event_time, line_number FROM event_registry WHERE {' AND '.join(clauses)} ORDER BY event_time, line_number LIMIT %(lim)s",
            params,
        )
        rows = cur.fetchall()
        n = len(rows)
        seq0 = int(run["admitted_seq"])
        if rows:
            cur.executemany(
                "INSERT INTO run_events (run_id, run_seq, event_id, event_time, phase, processing_state) VALUES (%s, %s, %s, %s, %s, 'admitted')",
                [(run_id, seq0 + i + 1, r["event_id"], r["event_time"], run["phase"]) for i, r in enumerate(rows)],
            )
            last = rows[-1]
            cur.execute(
                "UPDATE runs SET admitted_seq=%s, last_admitted_time=%s, last_admitted_line=%s, updated_at=now() WHERE run_id=%s",
                (seq0 + n, last["event_time"], last["line_number"], run_id),
            )
        phase_changed = False
        exhausted = False
        if n < room:
            # Nothing more is admissible right now. Either the warmup boundary or the dataset end was reached (or the
            # virtual clock has not advanced far enough).
            if run["phase"] == "warmup":
                cur.execute(
                    "SELECT 1 FROM event_registry WHERE dataset_id=%s AND (event_time, line_number) > (%s, %s) AND event_time < %s LIMIT 1",
                    (run["dataset_id"], params["t"] if n == 0 else rows[-1]["event_time"], params["ln"] if n == 0 else rows[-1]["line_number"], run["visible_start"]),
                )
                if cur.fetchone() is None:
                    pause = bool((run["config"] or {}).get("pause_at_visible_start"))
                    cur.execute(
                        """UPDATE runs SET phase='visible', state=%s, virtual_time=%s, virtual_anchor_wall=%s, updated_at=now() WHERE run_id=%s""",
                        ("paused" if pause else "running", run["visible_start"], None if pause else now, run_id),
                    )
                    phase_changed = True
                    sentry.log_event("run_phase_visible", run_id=run_id, warmup_admitted=seq0 + n)
            else:
                cur.execute(
                    "SELECT 1 FROM event_registry WHERE dataset_id=%s AND (event_time, line_number) > (%s, %s)" + (" AND event_time < %s" if run["range_end"] else "") + " LIMIT 1",
                    (run["dataset_id"], params["t"] if n == 0 else rows[-1]["event_time"], params["ln"] if n == 0 else rows[-1]["line_number"], *([run["range_end"]] if run["range_end"] else [])),
                )
                exhausted = cur.fetchone() is None
    return {"admitted": n, "phase_changed": phase_changed, "exhausted": exhausted}


def maybe_complete(conn: psycopg.Connection[Any], run_id: str) -> bool:
    """Mark a replay run completed once everything admissible has been admitted and processed."""
    run = get_run(conn, run_id, lock=True)
    if run is None or run["mode"] != "replay" or run["state"] not in ("running", "warming"):
        return False
    if int(run["admitted_seq"]) != int(run["processed_seq"]):
        return False
    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM event_registry WHERE dataset_id=%s AND (event_time, line_number) > (%s, %s)" + (" AND event_time < %s" if run["range_end"] else "") + " LIMIT 1",
            (run["dataset_id"], run["last_admitted_time"] or datetime(1970, 1, 1, tzinfo=UTC), int(run["last_admitted_line"] or 0),
             *([run["range_end"]] if run["range_end"] else [])),
        )
        if cur.fetchone() is not None or run["phase"] == "warmup":
            return False
        from app.notifications import outbox

        flushed = outbox.flush_all(conn, run_id)
        cur.execute("UPDATE runs SET state='completed', virtual_time=last_processed_time, virtual_anchor_wall=NULL, updated_at=now() WHERE run_id=%s", (run_id,))
        cur.execute(
            "INSERT INTO ui_updates (run_id, update_seq, type, payload) VALUES (%s, (SELECT coalesce(max(update_seq),0)+1 FROM ui_updates WHERE run_id=%s), 'run_state', %s)",
            (run_id, run_id, jsonb({"state": "completed", "flushed_digests": flushed})),
        )
    return True
