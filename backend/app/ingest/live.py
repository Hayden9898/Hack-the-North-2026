"""Ordered live admission for a single authenticated source per run (architecture.md §3).

Per-item outcome: accepted | duplicate | conflict | rejected | late. Accepted items are sorted by
(event_time, client_order) and must not precede the run's last admitted timestamp; earlier records are durably kept as
`late`, excluded from live scoring and counted visibly. Equal timestamps use admission order.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC
from typing import Any

import psycopg

from app.config import DetectionConfig
from app.ingest.parser import ParseError, parse_line, reject_text
from app.ingest.registry import RegistryRow, register_batch
from app.observability import sentry

MAX_BATCH = 1000
MAX_BATCH_BYTES = 2 * 1024 * 1024
MAX_RECORD_BYTES = 64 * 1024


@dataclass
class ItemResult:
    index: int
    client_event_id: str
    status: str  # accepted | duplicate | conflict | rejected | late
    reason: str | None = None
    run_seq: int | None = None


@dataclass
class BatchOutcome:
    counts: dict[str, int] = field(default_factory=dict)
    items: list[ItemResult] = field(default_factory=list)
    admitted_seq: int = 0
    late_count: int = 0


def _event_id(run_source: str, client_event_id: str) -> str:
    import hashlib

    return hashlib.sha256(f"live:{run_source}:{client_event_id}".encode()).hexdigest()


def admit_live_batch(conn: psycopg.Connection[Any], run_id: str, source_id: str, items: list[dict[str, Any]], cfg: DetectionConfig) -> BatchOutcome:
    """Runs inside the caller's transaction; locks the run row to serialise admission."""
    if len(items) > MAX_BATCH:
        raise ValueError(f"batch exceeds {MAX_BATCH} records")
    if sum(len(str(i.get("line", ""))) for i in items) > MAX_BATCH_BYTES:
        raise ValueError("batch exceeds 2 MiB")
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM runs WHERE run_id=%s FOR UPDATE", (run_id,))
        run = cur.fetchone()
    if run is None:
        raise KeyError(run_id)
    if run["mode"] != "live":
        raise ValueError("run is not a live run")
    if run["state"] not in ("running", "paused", "created", "warming"):
        raise ValueError(f"run is {run['state']}")
    if run["source_id"] and run["source_id"] != source_id:
        raise PermissionError("run belongs to a different source")

    outcome = BatchOutcome()
    parsed: list[tuple[int, str, Any]] = []
    for idx, item in enumerate(items):
        cid = str(item.get("event_id") or "")
        line = str(item.get("line") or "")
        if not cid:
            outcome.items.append(ItemResult(idx, cid, "rejected", "missing event_id"))
            continue
        if len(line) > MAX_RECORD_BYTES:
            outcome.items.append(ItemResult(idx, cid, "rejected", "record exceeds 64 KiB"))
            continue
        try:
            ev = parse_line(line, cfg.routes)
        except ParseError as exc:
            outcome.items.append(ItemResult(idx, cid, "rejected", exc.reason))
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO ingestion_rejects (source_id, run_id, request_index, raw_input, reason) VALUES (%s, %s, %s, %s, %s)",
                    (source_id, run_id, idx, reject_text(line), exc.reason),
                )
            sentry.log_event("parse_rejected", "warning", run_id=run_id, request_index=idx, reason=exc.reason)
            continue
        parsed.append((idx, cid, ev))

    # Intra-batch identity: the first occurrence of an event_id is the one that goes to the registry; later
    # occurrences mirror the cross-batch semantics (same payload -> duplicate, different payload -> conflict).
    # Without this, two accepted rows with one event_id would violate run_events UNIQUE(run_id, event_id).
    conflict_reason = "same event_id with different payload; original retained"
    first_seen: dict[str, tuple[str, str | None]] = {}  # cid -> (payload_hash, registry status once known)
    unique: list[tuple[int, str, Any]] = []
    repeats: list[tuple[int, str, str]] = []
    for idx, cid, ev in parsed:
        if cid in first_seen:
            repeats.append((idx, cid, ev.payload_hash))
        else:
            first_seen[cid] = (ev.payload_hash, None)
            unique.append((idx, cid, ev))

    rows = [RegistryRow(_event_id(source_id, cid), ev, source_id=source_id, client_event_id=cid) for _, cid, ev in unique]
    statuses = register_batch(conn, rows)
    accepted: list[tuple[int, str, RegistryRow]] = []
    for (idx, cid, _ev), row, st in zip(unique, rows, statuses, strict=True):
        first_seen[cid] = (first_seen[cid][0], st)
        if st == "accepted":
            accepted.append((idx, cid, row))
        else:
            outcome.items.append(ItemResult(idx, cid, st, None if st == "duplicate" else conflict_reason))
    for idx, cid, ph in repeats:
        first_hash, first_status = first_seen[cid]
        # If the first occurrence itself conflicted with the registry, the retained original is the registry row,
        # whose payload differs from the first occurrence; a repeat is reported as conflict too.
        if ph == first_hash and first_status != "conflict":
            outcome.items.append(ItemResult(idx, cid, "duplicate", None))
        else:
            outcome.items.append(ItemResult(idx, cid, "conflict", conflict_reason))

    # Ordered admission: sort by (event_time, client order); enforce the watermark.
    accepted.sort(key=lambda t: (t[2].event.event_time, t[0]))
    watermark = run["last_admitted_time"]
    seq = int(run["admitted_seq"])
    late = 0
    new_rows = []
    with conn.cursor() as cur:
        for idx, cid, row in accepted:
            et = row.event.event_time
            if watermark is not None and et < watermark:
                cur.execute(
                    "INSERT INTO run_late_events (run_id, event_id, event_time, watermark) VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                    (run_id, row.event_id, et, watermark),
                )
                late += 1
                outcome.items.append(ItemResult(idx, cid, "late", f"event_time {et.isoformat()} precedes watermark {watermark.isoformat()}"))
                sentry.log_event("event_late", "warning", run_id=run_id, lag_seconds=(watermark - et).total_seconds())
                continue
            seq += 1
            watermark = et
            new_rows.append((run_id, seq, row.event_id, et, "visible"))
            outcome.items.append(ItemResult(idx, cid, "accepted", None, seq))
        if new_rows:
            cur.executemany(
                "INSERT INTO run_events (run_id, run_seq, event_id, event_time, phase, processing_state) VALUES (%s, %s, %s, %s, %s, 'admitted')",
                new_rows,
            )
        cur.execute(
            """UPDATE runs SET admitted_seq=%s, last_admitted_time=%s, late_count = late_count + %s, source_id = coalesce(source_id, %s),
                   updated_at=now() WHERE run_id=%s""",
            (seq, watermark, late, source_id, run_id),
        )
    outcome.items.sort(key=lambda r: r.index)
    for r in outcome.items:
        outcome.counts[r.status] = outcome.counts.get(r.status, 0) + 1
    outcome.admitted_seq = seq
    outcome.late_count = late
    assert sum(outcome.counts.values()) == len(items), "per-item statuses must add up"
    return outcome


def utc_now_iso() -> str:
    from datetime import datetime

    return datetime.now(UTC).isoformat()
