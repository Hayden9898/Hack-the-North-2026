"""D01–D04: import correctness, idempotency, explicit rejects, distinct identical lines."""
from __future__ import annotations

import hashlib

import pytest
from tests.conftest import FIXTURES

from app.db.engine import connect_direct
from app.ingest.importer import import_dataset
from app.ingest.parser import file_event_id

pytestmark = pytest.mark.integration


def _q(url, sql, *args):
    with connect_direct(url) as conn, conn.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall()


def test_small_import_is_idempotent_and_keeps_identical_lines_distinct(db):
    path = FIXTURES / "march_anchor.log"
    first = import_dataset(path, db)
    assert first.import_state == "ready"
    assert first.total_lines == 40
    assert first.valid_count == 40
    assert first.rejected_count == 0
    # D02: line 5 is duplicated verbatim as line 13 → two evidence ids, two rows.
    ids = _q(db, "select event_id, line_number from event_registry where line_number in (5, 13) order by line_number")
    assert len(ids) == 2 and ids[0]["event_id"] != ids[1]["event_id"]
    assert ids[0]["event_id"] == file_event_id(first.content_sha256, 5)
    rows = _q(db, "select raw_line from raw_events r join event_registry e using (event_id) where line_number in (5,13)")
    assert rows[0]["raw_line"] == rows[1]["raw_line"]

    second = import_dataset(path, db)
    assert second.rows_inserted == 0
    assert second.dataset_id == first.dataset_id
    assert _q(db, "select count(*) as n from raw_events")[0]["n"] == 40
    assert _q(db, "select count(*) as n from event_registry")[0]["n"] == 40


def test_resume_after_partial_import_adds_no_duplicates(db):
    path = FIXTURES / "march_anchor.log"
    partial = import_dataset(path, db, batch_size=7, stop_after_batches=2)
    assert partial.import_state == "importing"
    assert partial.progress_line == 14
    resumed = import_dataset(path, db, batch_size=7)
    assert resumed.import_state == "ready"
    assert resumed.valid_count == 40
    assert _q(db, "select count(*) as n from raw_events")[0]["n"] == 40


def test_rejects_are_explicit_and_leading_zero_ip_survives(db):
    path = FIXTURES / "mixed_rejects.log"
    res = import_dataset(path, db)
    assert res.total_lines == 8
    assert res.valid_count == 6
    assert res.rejected_count == 2
    rejects = _q(db, "select line_number, reason, raw_input from ingestion_rejects order by line_number")
    assert [r["line_number"] for r in rejects] == [5, 8]
    assert "format" in rejects[0]["reason"]
    assert "timestamp" in rejects[1]["reason"]
    assert rejects[0]["raw_input"] == "this line is garbage"
    ips = _q(db, "select distinct ip_raw from raw_events where username = 'nicole_h'")
    assert ips == [{"ip_raw": "10.0.9.05"}]


@pytest.mark.slow
def test_full_supplied_dataset_import_matches_overview(db, dataset_path):
    """D01. Uses the real file; takes a while but this is the gate for M1."""
    res = import_dataset(dataset_path, db, batch_size=5000)
    assert res.import_state == "ready"
    assert res.content_sha256 == "9f773643335352d8aa8cc9f07c5f92614b65c806f84c84790f56e4c652970575"
    assert res.total_lines == 180800
    assert res.valid_count == 180800
    assert res.rejected_count == 0
    status = {r["status"]: r["n"] for r in _q(db, "select status, count(*) n from raw_events group by status")}
    assert status == {200: 140069, 302: 34506, 403: 5324, 401: 899, 500: 1, 400: 1}
    assert _q(db, "select count(distinct username) n from raw_events")[0]["n"] == 10
    bounds = _q(db, "select min(event_time) a, max(event_time) b from raw_events")[0]
    assert bounds["a"].isoformat() == "2025-08-01T12:00:57+00:00"
    assert bounds["b"].isoformat() == "2026-03-31T22:00:26+00:00"
    # Evidence round-trip: the registry line for 168338 resolves to the exact raw line in the file.
    with open(dataset_path, encoding="utf-8") as fh:
        for i, line in enumerate(fh, 1):
            if i == 168338:
                expected = line.rstrip("\n")
                break
    row = _q(
        db,
        "select r.raw_line, r.status, r.response_bytes from raw_events r join event_registry e using (event_id) "
        "where e.line_number = 168338",
    )[0]
    assert row["raw_line"] == expected
    assert row["status"] == 200 and row["response_bytes"] == 8459200
    again = import_dataset(dataset_path, db)
    assert again.rows_inserted == 0
    assert _q(db, "select count(*) n from raw_events")[0]["n"] == 180800
    assert hashlib.sha256(dataset_path.read_bytes()).hexdigest() == res.content_sha256
