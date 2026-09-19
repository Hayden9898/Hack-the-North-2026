"""Global event registry: deduplication and conflict detection for both file and live ingestion.

The registry is an ordinary table (hypertable unique keys must include partition time), so it is the single
authority for event identity. Registry + raw_event rows are inserted in the caller's transaction.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

import psycopg

from app.ingest.parser import ParsedEvent

Status = Literal["accepted", "duplicate", "conflict"]
SEP = "\x1f"


@dataclass(frozen=True)
class RegistryRow:
    event_id: str
    event: ParsedEvent
    dataset_id: str | None = None
    line_number: int | None = None
    source_id: str | None = None
    client_event_id: str | None = None


def register_batch(conn: psycopg.Connection[Any], rows: list[RegistryRow]) -> list[Status]:
    """Insert registry + raw rows for new ids. Returns a per-row status aligned with `rows`.

    duplicate = same id, same payload hash; conflict = same id, different payload (the original is never overwritten).
    """
    if not rows:
        return []
    ids = [r.event_id for r in rows]
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO event_registry (event_id, dataset_id, line_number, source_id, client_event_id, payload_hash, event_time)
            SELECT * FROM unnest(%s::text[], %s::text[], %s::bigint[], %s::text[], %s::text[], %s::text[], %s::timestamptz[])
            ON CONFLICT (event_id) DO NOTHING
            RETURNING event_id
            """,
            (
                ids,
                [r.dataset_id for r in rows],
                [r.line_number for r in rows],
                [r.source_id for r in rows],
                [r.client_event_id for r in rows],
                [r.event.payload_hash for r in rows],
                [r.event.event_time for r in rows],
            ),
        )
        inserted = {row["event_id"] for row in cur.fetchall()}
        statuses: list[Status] = []
        existing: dict[str, str] = {}
        missing = [i for i in ids if i not in inserted]
        if missing:
            cur.execute("SELECT event_id, payload_hash FROM event_registry WHERE event_id = ANY(%s)", (missing,))
            existing = {row["event_id"]: row["payload_hash"] for row in cur.fetchall()}
        accepted = [r for r in rows if r.event_id in inserted]
        for r in rows:
            if r.event_id in inserted:
                statuses.append("accepted")
            elif existing.get(r.event_id) == r.event.payload_hash:
                statuses.append("duplicate")
            else:
                statuses.append("conflict")
        if accepted:
            _insert_raw(cur, accepted)
    return statuses


def _insert_raw(cur: psycopg.Cursor[Any], rows: list[RegistryRow]) -> None:
    ev = [r.event for r in rows]
    cur.execute(
        """
        INSERT INTO raw_events (event_time, event_id, ip_raw, username, method, http_version, raw_target, path,
                                query_raw, query_decoded, query_keys, route_family, object_id, status, response_bytes,
                                raw_line, original_time, offset_minutes)
        SELECT t.event_time, t.event_id, t.ip_raw, t.username, t.method, t.http_version, t.raw_target, t.path,
               t.query_raw, t.query_decoded,
               COALESCE(string_to_array(NULLIF(t.query_keys, ''), %s), '{}'::text[]),
               t.route_family, t.object_id, t.status, t.response_bytes, t.raw_line, t.original_time, t.offset_minutes
        FROM unnest(%s::timestamptz[], %s::text[], %s::text[], %s::text[], %s::text[], %s::text[], %s::text[], %s::text[],
                    %s::text[], %s::text[], %s::text[], %s::text[], %s::text[], %s::smallint[], %s::bigint[],
                    %s::text[], %s::text[], %s::smallint[])
             AS t(event_time, event_id, ip_raw, username, method, http_version, raw_target, path, query_raw,
                  query_decoded, query_keys, route_family, object_id, status, response_bytes, raw_line,
                  original_time, offset_minutes)
        ON CONFLICT DO NOTHING
        """,
        (
            SEP,
            [e.event_time for e in ev],
            [r.event_id for r in rows],
            [e.ip_raw for e in ev],
            [e.username for e in ev],
            [e.method for e in ev],
            [e.http_version for e in ev],
            [e.raw_target for e in ev],
            [e.path for e in ev],
            [e.query_raw for e in ev],
            [e.query_decoded for e in ev],
            [SEP.join(e.query_keys) for e in ev],
            [e.route_family for e in ev],
            [e.object_id for e in ev],
            [e.status for e in ev],
            [e.response_bytes for e in ev],
            [e.raw_line for e in ev],
            [e.original_time for e in ev],
            [e.offset_minutes for e in ev],
        ),
    )
