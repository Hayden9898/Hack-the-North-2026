"""Idempotent, checkpointed file import. Raw import is separate from run processing."""
from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg

from app.config import get_config
from app.db.engine import connect_direct, jsonb, one
from app.ingest.parser import PARSE_VERSION, ParseError, file_event_id, parse_line, reject_text
from app.ingest.registry import RegistryRow, register_batch
from app.observability import sentry

log = logging.getLogger("logorder.import")


@dataclass
class ImportSummary:
    dataset_id: str
    content_sha256: str
    import_state: str
    total_lines: int
    valid_count: int
    rejected_count: int
    progress_line: int
    rows_inserted: int
    first_event_time: Any = None
    last_event_time: Any = None


def sha256_file(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as fh:
        while chunk := fh.read(1 << 20):
            h.update(chunk)
            size += len(chunk)
    return h.hexdigest(), size


def dataset_id_for(sha256: str) -> str:
    return "ds_" + sha256[:24]


def import_dataset(
    path: str | Path,
    database_url: str | None = None,
    *,
    original_name: str | None = None,
    batch_size: int = 5000,
    stop_after_batches: int | None = None,
    progress_cb: Callable[[int, int], None] | None = None,
) -> ImportSummary:
    """Load a file once. Re-running is a no-op for a ready dataset; a partial import resumes from its checkpoint."""
    path = Path(path)
    routes = get_config().routes
    with sentry.transaction("ingest.import", "import_dataset"):
        digest, size = sha256_file(path)
        dataset_id = dataset_id_for(digest)
        conn = connect_direct(database_url)
        try:
            state = _open_dataset(conn, dataset_id, digest, size, original_name or path.name)
            if state["import_state"] == "ready":
                log.info("dataset %s already ready; nothing to import", dataset_id)
                return _summary(conn, dataset_id, rows_inserted=0)
            start_line = int(state["progress_line"])
            inserted_total = 0
            batches = 0
            batch: list[RegistryRow] = []
            rejects: list[tuple[int, str, str]] = []
            line_no = 0
            with path.open("rb") as fh:
                for raw in fh:
                    line_no += 1
                    if line_no <= start_line:
                        continue
                    text = raw.decode("utf-8", "surrogateescape").rstrip("\r\n")
                    try:
                        ev = parse_line(text, routes)
                        batch.append(RegistryRow(file_event_id(digest, line_no), ev, dataset_id=dataset_id, line_number=line_no))
                    except ParseError as exc:
                        rejects.append((line_no, reject_text(text), exc.reason))
                    if len(batch) + len(rejects) >= batch_size:
                        inserted_total += _commit_batch(conn, dataset_id, batch, rejects, line_no, size, fh.tell())
                        batch, rejects = [], []
                        batches += 1
                        if progress_cb:
                            progress_cb(line_no, size)
                        if stop_after_batches is not None and batches >= stop_after_batches:
                            return _summary(conn, dataset_id, rows_inserted=inserted_total)
                if batch or rejects or line_no > start_line:
                    inserted_total += _commit_batch(conn, dataset_id, batch, rejects, line_no, size, size)
            _finalize(conn, dataset_id, line_no)
            return _summary(conn, dataset_id, rows_inserted=inserted_total)
        finally:
            conn.close()


def _open_dataset(conn: psycopg.Connection[Any], dataset_id: str, digest: str, size: int, name: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM datasets WHERE id = %s FOR UPDATE", (dataset_id,))
        row = cur.fetchone()
        if row is None:
            cur.execute(
                """INSERT INTO datasets (id, content_sha256, original_name, bytes, parse_version, import_state)
                   VALUES (%s, %s, %s, %s, %s, 'importing') RETURNING *""",
                (dataset_id, digest, name, size, PARSE_VERSION),
            )
            row = cur.fetchone()
        elif row["import_state"] in ("pending", "failed"):
            cur.execute("UPDATE datasets SET import_state='importing', error=NULL, updated_at=now() WHERE id=%s RETURNING *", (dataset_id,))
            row = cur.fetchone()
    conn.commit()
    assert row is not None
    return dict(row)


def _commit_batch(
    conn: psycopg.Connection[Any],
    dataset_id: str,
    batch: list[RegistryRow],
    rejects: list[tuple[int, str, str]],
    line_no: int,
    size: int,
    byte_pos: int,
) -> int:
    with sentry.span("ingest.persist", rows=len(batch), rejects=len(rejects)):
        statuses = register_batch(conn, batch)
        inserted = sum(1 for s in statuses if s == "accepted")
        with conn.cursor() as cur:
            if rejects:
                cur.executemany(
                    "INSERT INTO ingestion_rejects (dataset_id, line_number, raw_input, reason) VALUES (%s, %s, %s, %s)",
                    [(dataset_id, ln, raw, reason) for ln, raw, reason in rejects],
                )
                for ln, _raw, reason in rejects:
                    sentry.log_event("parse_rejected", "warning", dataset_id=dataset_id, line_number=ln, reason=reason)
            cur.execute(
                """UPDATE datasets SET progress_line=%s, progress_bytes=%s,
                       valid_count = valid_count + %s, rejected_count = rejected_count + %s, updated_at=now()
                   WHERE id=%s""",
                (line_no, min(byte_pos, size), inserted, len(rejects), dataset_id),
            )
        conn.commit()
    return inserted


def _finalize(conn: psycopg.Connection[Any], dataset_id: str, total_lines: int) -> None:
    with conn.cursor() as cur:
        # Fresh planner statistics: without them the registry/raw join below can pick a nested-loop plan that takes
        # minutes on 180k rows (observed on a freshly truncated test database).
        cur.execute("ANALYZE event_registry")
        cur.execute("ANALYZE raw_events")
        # Authoritative counts come from the tables, not from in-memory counters.
        cur.execute("SELECT count(*) AS n FROM event_registry WHERE dataset_id=%s", (dataset_id,))
        valid = one(cur)["n"]
        cur.execute("SELECT count(*) AS n FROM ingestion_rejects WHERE dataset_id=%s", (dataset_id,))
        rejected = one(cur)["n"]
        cur.execute(
            """SELECT min(r.event_time) a, max(r.event_time) b, count(distinct r.username) users
               FROM raw_events r JOIN event_registry e USING (event_id) WHERE e.dataset_id=%s""",
            (dataset_id,),
        )
        b = one(cur)
        cur.execute(
            """SELECT r.status, count(*) n FROM raw_events r JOIN event_registry e USING (event_id)
               WHERE e.dataset_id=%s GROUP BY r.status""",
            (dataset_id,),
        )
        status_counts = {str(row["status"]): row["n"] for row in cur.fetchall()}
        if valid + rejected != total_lines:
            cur.execute(
                "UPDATE datasets SET import_state='failed', error=%s, updated_at=now() WHERE id=%s",
                (f"count mismatch: valid {valid} + rejected {rejected} != lines {total_lines}", dataset_id),
            )
            conn.commit()
            raise RuntimeError("import count mismatch")
        cur.execute(
            """UPDATE datasets SET import_state='ready', total_lines=%s, valid_count=%s, rejected_count=%s,
                   first_event_time=%s, last_event_time=%s, stats=%s, updated_at=now() WHERE id=%s""",
            (total_lines, valid, rejected, b["a"], b["b"], jsonb({"status_counts": status_counts, "users": b["users"]}), dataset_id),
        )
    conn.commit()


def _summary(conn: psycopg.Connection[Any], dataset_id: str, rows_inserted: int) -> ImportSummary:
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM datasets WHERE id=%s", (dataset_id,))
        d = one(cur)
    conn.commit()
    return ImportSummary(
        dataset_id=d["id"],
        content_sha256=d["content_sha256"],
        import_state=d["import_state"],
        total_lines=int(d["total_lines"]),
        valid_count=int(d["valid_count"]),
        rejected_count=int(d["rejected_count"]),
        progress_line=int(d["progress_line"]),
        rows_inserted=rows_inserted,
        first_event_time=d["first_event_time"],
        last_event_time=d["last_event_time"],
    )
