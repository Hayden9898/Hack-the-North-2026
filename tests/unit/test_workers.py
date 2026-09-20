"""Worker invariants that need no database: poison-record blame, model-health reconciliation, locked update_seq
allocation, run creation normalisation. Connections are faked; the SQL that would run is asserted instead."""
from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import pytest

from app.config import load_config
from app.detection.model import ModelLoadError
from app.features.reference import Reference
from app.notifications import outbox
from app.workers import runs as runs_mod
from app.workers.detector import BatchResult, Detector, PoisonRecord, RunModel


class FakeCursor:
    def __init__(self, conn: FakeConn) -> None:
        self.conn = conn
        self.rowcount = 0

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *exc: Any) -> None:
        return None

    def execute(self, sql: str, params: Any = None) -> None:
        self.conn.executed.append((" ".join(sql.split()), params))

    def fetchone(self) -> Any:
        return self.conn.fetch(self.conn.executed[-1][0])


class FakeConn:
    def __init__(self, fetch: Callable[[str], Any] | None = None) -> None:
        self.executed: list[tuple[str, Any]] = []
        self.commits = 0
        self.rollbacks = 0
        self._fetch = fetch or (lambda sql: None)

    def fetch(self, sql: str) -> Any:
        return self._fetch(sql)

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


# ---------------------------------------------------------------------------------------------- ui_updates allocation


def test_next_update_seq_locks_the_run_row_before_reading_max():
    conn = FakeConn(lambda sql: {"n": 7} if "max(update_seq)" in sql else None)
    assert outbox.next_update_seq(conn, "r1") == 7
    lock_sql, lock_params = conn.executed[0]
    assert lock_sql.startswith("SELECT 1 FROM runs WHERE run_id=%s FOR UPDATE") and lock_params == ("r1",)
    assert "max(update_seq)" in conn.executed[1][0]


def test_promote_ready_if_live_is_one_query_scoped_to_live_runs():
    conn = FakeConn()
    outbox.promote_ready_if_live(conn, "r1")
    assert len(conn.executed) == 1
    sql, params = conn.executed[0]
    assert "state='debounce'" in sql and "r.mode='live'" in sql and params == ("r1",)


# ---------------------------------------------------------------------------------------------- poison records


@pytest.fixture
def detector() -> Detector:
    return Detector(database_url="postgresql://unused/db", cfg=load_config())


def test_poison_record_carries_the_failing_seq_and_cause():
    cause = ValueError("boom")
    p = PoisonRecord(42, cause)
    assert p.seq == 42 and p.cause is cause and "run_seq 42" in str(p) and "ValueError" in str(p)


def test_step_blames_the_poison_seq_and_commits_the_healthy_prefix(detector, monkeypatch):
    conn = FakeConn()
    monkeypatch.setattr(runs_mod, "admit_replay", lambda *a, **k: {"admitted": 0})
    monkeypatch.setattr(runs_mod, "get_run", lambda *a, **k: {"run_id": "r1", "processed_seq": 10})
    calls: list[int | None] = []
    failures: list[tuple[type, int | None]] = []

    def process_batch(conn_, run_id, batch_size=None):
        calls.append(batch_size)
        if len(calls) == 1:
            raise PoisonRecord(14, ValueError("bad record"))  # the 4th event of a batch starting at 11
        return BatchResult(processed=batch_size or 0, last_seq=13)

    def record_failure(conn_, run_id, exc, seq=None):
        failures.append((type(exc), seq))
        return False

    monkeypatch.setattr(detector, "process_batch", process_batch)
    monkeypatch.setattr(detector, "_record_failure", record_failure)
    res = detector.step(conn, "r1")
    assert failures == [(ValueError, 14)]  # the poison record, not the batch head (11)
    assert calls == [None, 3]  # retry covers exactly seqs 11..13
    assert res.processed == 3 and conn.rollbacks == 1


def test_step_does_not_retry_once_the_run_is_blocked(detector, monkeypatch):
    conn = FakeConn()
    monkeypatch.setattr(runs_mod, "admit_replay", lambda *a, **k: {"admitted": 0})
    monkeypatch.setattr(runs_mod, "get_run", lambda *a, **k: {"run_id": "r1", "processed_seq": 10})
    calls: list[int | None] = []

    def process_batch(conn_, run_id, batch_size=None):
        calls.append(batch_size)
        raise PoisonRecord(14, ValueError("bad record"))

    monkeypatch.setattr(detector, "process_batch", process_batch)
    monkeypatch.setattr(detector, "_record_failure", lambda *a, **k: True)
    assert detector.step(conn, "r1").processed == 0
    assert calls == [None]


def test_step_blames_the_batch_head_for_failures_outside_event_processing(detector, monkeypatch):
    conn = FakeConn()
    monkeypatch.setattr(runs_mod, "admit_replay", lambda *a, **k: {"admitted": 0})
    failures: list[tuple[type, int | None]] = []

    def process_batch(conn_, run_id, batch_size=None):
        raise RuntimeError("crash before commit")

    def record_failure(conn_, run_id, exc, seq=None):
        failures.append((type(exc), seq))
        return False

    monkeypatch.setattr(detector, "process_batch", process_batch)
    monkeypatch.setattr(detector, "_record_failure", record_failure)
    detector.step(conn, "r1")
    assert failures == [(RuntimeError, None)]


def test_record_failure_never_blames_an_already_processed_seq(detector):
    """A stale seq (<= processed_seq) falls back to the batch head instead of corrupting the cursor invariant."""
    conn = FakeConn(lambda sql: {"processed_seq": 20} if "processed_seq FROM runs" in sql else {"attempts": 1})
    assert detector._record_failure(conn, "r1", ValueError("x"), seq=5) is False
    attempts_sql, params = next((s, p) for s, p in conn.executed if "attempts = attempts + 1" in s)
    assert params[-1] == 21


# ---------------------------------------------------------------------------------------------- model health


def test_run_model_reconciles_persisted_health_on_every_batch(detector):
    detector._models["r1"] = RunModel(None, "rules_only", "cached")
    conn = FakeConn()
    rm = detector._run_model(conn, {"run_id": "r1", "model_id": None, "model_health": "pending_load"})
    assert rm.health == "rules_only"
    assert [p for s, p in conn.executed if "SET model_health=%s" in s] == [("rules_only", "r1")]
    conn = FakeConn()
    detector._run_model(conn, {"run_id": "r1", "model_id": None, "model_health": "rules_only"})
    assert conn.executed == []  # already consistent: nothing to write


@pytest.mark.parametrize("status,health", [("active", "active"), ("shadow", "shadow"), ("candidate", "shadow"), ("rejected", "shadow")])
def test_only_an_active_registration_classifies(detector, monkeypatch, status, health):
    class Stub:
        artifact_sha256 = "abcdef0123456789"

    seen: dict[str, Any] = {}

    def fake_load(model_dir, model_id, expected_sha256=None, expected_reference_hash=None, cfg=None):
        seen.update(cfg=cfg)
        return Stub()

    monkeypatch.setattr("app.workers.detector.load_model", fake_load)
    conn = FakeConn(lambda sql: {"status": status, "artifact_sha256": "x"} if "FROM models" in sql else None)
    rm = detector._run_model(conn, {"run_id": f"r-{status}", "model_id": "m", "model_health": "pending_load", "config": {}})
    assert rm.health == health and seen["cfg"] is detector.cfg


def test_model_load_failure_is_visibly_degraded(detector, monkeypatch):
    def fake_load(*a, **k):
        raise ModelLoadError("artifact hash mismatch")

    monkeypatch.setattr("app.workers.detector.load_model", fake_load)
    conn = FakeConn(lambda sql: {"status": "active", "artifact_sha256": "x"} if "FROM models" in sql else None)
    rm = detector._run_model(conn, {"run_id": "r-bad", "model_id": "m", "model_health": "pending_load", "config": {}})
    assert rm.model is None and rm.health == "degraded" and "hash mismatch" in rm.detail


# ---------------------------------------------------------------------------------------------- run creation


def _insert_params(conn: FakeConn) -> tuple[Any, ...]:
    return next(p for s, p in conn.executed if s.startswith("INSERT INTO runs"))


def test_create_run_accepts_naive_datetimes_and_starts_the_clock_at_range_start():
    cfg = load_config()
    conn = FakeConn(lambda sql: {"run_id": "x"} if sql.startswith("INSERT INTO runs") else None)
    runs_mod.create_run(
        conn, cfg, dataset_id="ds", model_id="m", reference=Reference.empty(),
        visible_start=datetime(2026, 3, 1), range_start=datetime(2026, 3, 5), range_end=datetime(2026, 3, 9),
    )
    p = _insert_params(conn)
    phase, visible_start, range_start, range_end, virtual_time = p[5], p[11], p[12], p[13], p[15]
    assert phase == "visible"
    assert visible_start == datetime(2026, 3, 1, tzinfo=UTC) and range_end == datetime(2026, 3, 9, tzinfo=UTC)
    assert range_start == datetime(2026, 3, 5, tzinfo=UTC)
    assert virtual_time == range_start  # not visible_start: admission would stall until the clock crawled there


def test_create_run_warmup_clock_starts_at_range_start():
    cfg = load_config()
    conn = FakeConn(lambda sql: {"run_id": "x"} if sql.startswith("INSERT INTO runs") else None)
    runs_mod.create_run(
        conn, cfg, dataset_id="ds", model_id="m", reference=Reference.empty(),
        visible_start=datetime(2026, 3, 1, tzinfo=UTC), range_start=datetime(2026, 2, 1),
    )
    p = _insert_params(conn)
    assert p[5] == "warmup" and p[15] == datetime(2026, 2, 1, tzinfo=UTC)


def test_default_model_is_selected_by_the_run_reference_hash():
    cfg = load_config()
    ref = Reference.empty()
    queries: list[tuple[str, Any]] = []

    def fetch(sql: str) -> Any:
        if sql.startswith("INSERT INTO runs"):
            return {"run_id": "x"}
        return None  # no matching model

    conn = FakeConn(fetch)
    row_cfg = runs_mod.create_run(conn, cfg, dataset_id="ds", reference=ref)
    assert row_cfg == {"run_id": "x"}
    queries = [(s, p) for s, p in conn.executed if "FROM models" in s]
    assert "reference_hash = %s" in queries[0][0] and queries[0][1] == (ref.hash,)
    assert "reference_hash IS NULL" in queries[0][0]  # legacy registrations stay eligible, ranked after a match
    p = _insert_params(conn)
    assert p[6] is None and p[7] == "rules_only"
    assert "rules-only" in p[9].obj["model_reason"]


def test_active_model_id_without_reference_keeps_the_global_newest():
    conn = FakeConn(lambda sql: {"model_id": "m_new"})
    assert runs_mod.active_model_id(conn) == "m_new"
    assert "reference_hash" not in conn.executed[0][0]
