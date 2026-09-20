# Replay Speed Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a full causal replay of the 180,800-line dataset dramatically faster (target: full replay in the
low single-digit minutes, ideally seconds) by removing the per-event Postgres round-trips that dominate today's
~215 events/sec, while producing byte-for-byte identical detections, rule matches and incidents.

**Architecture:** Two independent levers, applied in order of risk (lowest first):
1. Turn `detector.py`'s per-event single-row `INSERT`/`UPDATE` calls into buffered, batched writes flushed once
   per microbatch (currently 200 events) instead of 4x per event.
2. Replace the two remaining sources of *mandatory* per-event SQL reads — `features/history.py::window_counts()`
   (always called) and `detection/rules.py`'s five `_fetch()`/query call sites (called only when a rule's cheap
   Python precondition already matched) — with an in-memory `ReplayState` object that mirrors the exact same
   causal semantics (same time windows, same `run_seq`-ordered "prior events only" guarantee, same truncation
   caps) using plain Python data structures, populated synchronously as each event is processed in order.

Because event volume for this dataset (180,800 events total) is small enough to hold entirely in memory, the
in-memory logs never need eviction/pruning — every per-key log is a simple append-only, chronologically-ordered
list, sliced by `bisect` for time-windowed queries. This sidesteps an entire class of "pruned too early" bugs
that a sliding-eviction design would risk.

`incidents/correlate.py` and `notifications/outbox.py` are **out of scope** — `apply_matches()` short-circuits
immediately (`if not matches: return []`) and only runs a handful of times across the entire 8-month dataset, so
it is never the bottleneck and needs no change, except for one narrow interaction handled in Task 8 (flushing
buffered `processed_events` rows before `apply_matches` runs, since `incidents/facts.py::build_packet()` reads
`processed_events` back via SQL for evidence legs).

**Tech Stack:** Python 3.12, psycopg 3.2.9 (`cursor.executemany()` already used this way for `entity_stats` in
`features/history.py::StatsStore.flush()` — follow that existing pattern for all new bulk writes), pytest,
TimescaleDB/PostgreSQL 17.

**Spec:** This plan's own "Architecture" section above; no separate spec doc exists. Ground truth for current
behavior is `backend/app/workers/detector.py`, `backend/app/features/history.py`,
`backend/app/detection/rules.py`, `backend/app/incidents/correlate.py`, and the existing integration tests in
`tests/integration/` (`test_detector_rules.py`, `test_generality.py`, `test_model_integration.py`), which encode
every causal-correctness invariant as an observable outcome (rule ids fired, incident classes, incident counts).
**These tests are the correctness oracle for this whole refactor — every task ends by running the full suite and
confirming it still passes unchanged.**

## Global Constraints

- No behavior change is acceptable: every existing test in `tests/` must pass, unchanged, after every task.
- No dataset literals (account names, IPs, dates, object ids) may be encoded anywhere in the new code — same rule
  the codebase already follows (see `detection/rules.py` module docstring).
- Causal ordering is by `run_seq`, not wall-clock `event_time` (ties at equal `event_time` are broken by
  `run_seq`, per `tests/integration/test_detector_rules.py::test_t02_equal_timestamps_keep_stable_order_and_causal_windows`).
  The in-memory design gets this for free by only ever appending an event to `ReplayState` *after* it has been
  fully processed, in the same strictly-increasing `run_seq` order the batch query already delivers rows in — do
  not reintroduce a `run_seq`/`event_time` comparison anywhere in the new code; ordering is structural, not
  compared.
- Config-driven thresholds (window seconds, caps) must keep coming from `cfg.policy[...]` at call time, exactly
  as today — never hardcode a window/cap value from `config/policy.yaml` into the new code.

---

## File Structure

- Create: `backend/app/features/replay_state.py` — `ReplayState`, `_TimeLog`, `_PrefixCap`, `_Leg`. One
  responsibility: in-memory causal event history for one run, queryable the same way SQL was queried.
- Create: `tests/unit/test_replay_state.py` — differential test: in-memory `window_counts` equivalent vs. the
  existing SQL-backed `window_counts()`, run against a real Postgres fixture with a randomized event stream.
- Modify: `backend/app/workers/detector.py` — buffered writes, wiring `ReplayState` into `_process_event`.
- Modify: `backend/app/detection/rules.py` — `RuleContext.conn` → `RuleContext.state: ReplayState`; rewrite the
  five rule functions' evidence lookups.
- Modify: `config/policy.yaml` — raise `replay.microbatch` once batching lands (Task 9).
- Modify: `reports/performance.md` — append newly measured numbers (Task 9). Never hand-write a number here that
  wasn't produced by actually running the benchmark/replay.

---

### Task 1: Buffer `feature_snapshots` + `detections` writes, batch the `run_events` state update

Lowest-risk task: nothing reads `feature_snapshots` or `detections` back via SQL anywhere in the codebase (they
are terminal output tables), so buffering them is a pure performance change with zero causal-correctness surface.
`processed_events` is deliberately **not** touched in this task (it still has SQL readers until Task 8).

**Files:**
- Modify: `backend/app/workers/detector.py:104-248` (`process_batch`, `_process_event`)
- Test: `tests/integration/test_detector_rules.py`, `tests/integration/test_generality.py`,
  `tests/integration/test_model_integration.py` (existing — no new test file needed; these already assert exact
  row counts/classes that would break if a row were dropped or duplicated by a buffering bug)

**Interfaces:**
- Produces: `Detector._process_event(...)` gains a `buffers: _WriteBuffers` parameter; `_WriteBuffers` is a new
  small dataclass in `detector.py` with `feature_snapshots: list[tuple]`, `detections: list[tuple]`,
  `processed_seqs: list[int]`.

- [ ] **Step 1: Run the full existing suite once to record a clean baseline**

Run: `python -m pytest tests/ -q`
Expected: all tests pass (record the pass count — this is your baseline to diff against after every later step).

- [ ] **Step 2: Add `_WriteBuffers` and rewrite `_process_event` to append instead of execute**

In `backend/app/workers/detector.py`, add near the top (after the `RunModel` dataclass):

```python
@dataclass
class _WriteBuffers:
    feature_snapshots: list[tuple[Any, ...]] = field(default_factory=list)
    detections: list[tuple[Any, ...]] = field(default_factory=list)
    processed_seqs: list[int] = field(default_factory=list)
```

Replace lines 214-238 of `_process_event` (the `with conn.cursor() as cur:` block that does the three `INSERT`s
and one `UPDATE`) with:

```python
        deviations = _top_deviations(fr.observed)
        buffers.feature_snapshots.append(
            (run_id, ev.run_seq, ev.event_id, ev.event_time, FEATURE_VERSION, fr.history_count, fr.vector, jsonb(fr.observed), ref.hash)
        )
        buffers.detections.append(
            (run_id, ev.run_seq, ev.event_id, ev.event_time, ev.phase, decision.threat_class, run.get("model_id"), rm.health, score, pct,
             decision.model_flagged, decision.reason_codes, decision.rule_ids, jsonb(deviations))
        )
        buffers.processed_seqs.append(ev.run_seq)
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO processed_events (event_time, run_id, run_seq, event_id, username, ip_raw, method, path, route_family, object_id,
                       status, response_bytes, threat_class, phase)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (ev.event_time, run_id, ev.run_seq, ev.event_id, ev.username, ev.ip_raw, ev.method, ev.path, ev.route_family, ev.object_id,
                 ev.status, ev.response_bytes, decision.threat_class, ev.phase),
            )
```

This keeps the `processed_events` `INSERT` executing immediately, per-event, exactly as it did before this
task — only the other three statements (two `INSERT`s and the `run_events` `UPDATE`) move into buffers. Update
the `_process_event` signature (line 169) to accept `buffers: _WriteBuffers` as the last parameter, and update
its call site in `process_batch` (line 139) to pass a `buffers` instance created once per batch.

- [ ] **Step 3: Flush the buffers once per batch, right before the existing end-of-batch commit-prep**

In `process_batch`, after the `for row in rows:` loop (i.e. right after the loop that used to be at lines
137-140, before `stats.flush()` at line 141), add:

```python
        with conn.cursor() as cur:
            if buffers.feature_snapshots:
                cur.executemany(
                    """INSERT INTO feature_snapshots (run_id, run_seq, event_id, event_time, feature_version, history_count, numeric_vector, observed_context, reference_hash)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    buffers.feature_snapshots,
                )
            if buffers.detections:
                cur.executemany(
                    """INSERT INTO detections (run_id, run_seq, event_id, event_time, phase, threat_class, processing_status, model_id, model_health,
                           model_score, anomaly_percentile, model_flagged, reason_codes, rule_ids, top_deviations)
                       VALUES (%s, %s, %s, %s, %s, %s, 'processed', %s, %s, %s, %s, %s, %s, %s, %s)""",
                    buffers.detections,
                )
            if buffers.processed_seqs:
                cur.execute(
                    "UPDATE run_events SET processing_state='processed', processed_at=now() WHERE run_id=%s AND run_seq = ANY(%s)",
                    (run_id, buffers.processed_seqs),
                )
```

Declare `buffers = _WriteBuffers()` right before the `for row in rows:` loop starts, so it's created fresh per
batch and passed into every `_process_event` call in that batch.

- [ ] **Step 4: Run the full suite again and diff against the Step 1 baseline**

Run: `python -m pytest tests/ -q`
Expected: identical pass count to Step 1. Any new failure means a buffered row's column order/types drifted from
the original per-event `INSERT` — compare tuple order against the original SQL column list carefully.

- [ ] **Step 5: Commit**

```bash
git add backend/app/workers/detector.py
git commit -m "perf: batch feature_snapshots/detections/run_events writes per microbatch"
```

---

### Task 2: Build `ReplayState` with the `window_counts` equivalent, and a differential test proving parity

**Files:**
- Create: `backend/app/features/replay_state.py`
- Create: `tests/unit/test_replay_state.py`
- Test: the new file above (run against the `db` fixture already used by `tests/integration/*` — check
  `tests/conftest.py` for the fixture name/signature before writing the test; it provides a live Postgres
  connection).

**Interfaces:**
- Produces:
  - `class _Leg` — frozen dataclass: `event_id: str`, `run_seq: int`, `event_time: datetime`, `object_id: str | None = None`.
  - `class _TimeLog` — `append(event_time: datetime, item: Any) -> None`; `since(lo: datetime, hi: datetime | None = None) -> list[Any]` (chronological, oldest first); `count_since(lo: datetime) -> int`; `most_recent_since(lo: datetime, hi: datetime | None = None) -> Any | None`.
  - `class _PrefixCap` — `__init__(cap: int)`; `append(item: Any) -> None`; `legs() -> tuple[list[Any], bool]` (legs, truncated).
  - `class ReplayState` — `__init__(login_families: frozenset[str], forum_families: frozenset[str], max_packet_events: int)`; `record_event(ev: Event, matches: list[RuleMatch], changes: list[IncidentChange]) -> None`; `window_counts(ev: Event, windows: dict[str, int], r1_window: int) -> WindowCounts`.
- Consumes: `app.features.events.Event`, `app.features.history.WindowCounts` (import, do not modify
  `WindowCounts` itself).

- [ ] **Step 1: Write the differential test first**

Create `tests/unit/test_replay_state.py`:

```python
"""ReplayState must reproduce window_counts() exactly, for any event order a real replay could produce."""
from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

import pytest

from app.features.events import Event
from app.features.history import configure, window_counts
from app.features.replay_state import ReplayState

pytestmark = pytest.mark.integration  # needs the `db` fixture (real processed_events table)

WINDOWS = {"short": 300, "medium": 3600, "long": 259200}
R1_WINDOW = 60


def _mk_event(run_seq, t, username, ip, route_family, status, method="GET"):
    return Event(
        run_seq=run_seq, event_id=f"e{run_seq}", event_time=t, phase="visible", username=username, ip_raw=ip,
        method=method, path="/x", raw_target="/x", query_keys=(), route_family=route_family, object_id=None,
        status=status, response_bytes=100, offset_minutes=0, line_number=run_seq, raw_line="",
    )


def test_replay_state_matches_sql_window_counts(db):
    configure(("login",))
    accounts = ["alice", "bob", "carol"]
    ips = ["10.0.0.1", "10.0.0.2"]
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rng = random.Random(7)
    run_id = "replay-state-parity"
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO runs (run_id, state, mode, phase, admitted_seq, processed_seq) VALUES (%s,'running','replay','visible',0,0)",
            (run_id,),
        )
    state = ReplayState(login_families=frozenset({"login"}), forum_families=frozenset({"forum"}), max_packet_events=200)
    events = []
    for i in range(1, 301):
        t = t0 + timedelta(seconds=rng.randint(0, 7200))
        ev = _mk_event(i, t, rng.choice(accounts), rng.choice(ips), rng.choice(["login", "browse"]), rng.choice([200, 401]))
        events.append(ev)
    events.sort(key=lambda e: e.run_seq)  # run_seq order is what both implementations rely on for causality

    for ev in events:
        sql_counts = window_counts(db, run_id, ev, WINDOWS, R1_WINDOW)
        mem_counts = state.window_counts(ev, WINDOWS, R1_WINDOW)
        assert mem_counts == sql_counts, f"mismatch at run_seq={ev.run_seq}: sql={sql_counts} mem={mem_counts}"
        with db.cursor() as cur:
            cur.execute(
                """INSERT INTO processed_events (event_time, run_id, run_seq, event_id, username, ip_raw, method, path, route_family, object_id,
                       status, response_bytes, threat_class, phase)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (ev.event_time, run_id, ev.run_seq, ev.event_id, ev.username, ev.ip_raw, ev.method, ev.path, ev.route_family,
                 ev.object_id, ev.status, ev.response_bytes, "normal", ev.phase),
            )
        state.record_event(ev, matches=[], changes=[])
    db.commit()
```

(If `tests/conftest.py`'s `db` fixture already wraps each test in a transaction rollback and doesn't need the
manual `runs` insert, or needs a different call to create a run row, adjust Step 1 to match the existing
convention other integration tests in `tests/integration/` use — copy the `db`/`import_world`/`start_run` pattern
from `tests/integration/test_detector_rules.py` if a bare `runs` insert like above doesn't satisfy foreign keys.)

- [ ] **Step 2: Run it to verify it fails (ReplayState doesn't exist yet)**

Run: `python -m pytest tests/unit/test_replay_state.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.features.replay_state'`.

- [ ] **Step 3: Implement `replay_state.py`**

Create `backend/app/features/replay_state.py`:

```python
"""In-memory mirror of the causal event history that `features/history.py::window_counts()` and
`detection/rules.py` otherwise fetch via SQL. One instance per run. Events are appended only after being fully
processed, in the same strictly-increasing run_seq order the detector already processes them in — this is what
gives every query here the same "prior events only" causality the SQL queries enforced with `run_seq < k`.

Dataset-scale assumption: a run's total event count fits comfortably in memory (hundreds of thousands of events,
not billions), so logs are never pruned — every per-key log is append-only and sliced by `bisect` on demand.
"""
from __future__ import annotations

import bisect
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.features.events import Event
from app.features.history import WindowCounts


@dataclass(frozen=True)
class _Leg:
    event_id: str
    run_seq: int
    event_time: datetime
    object_id: str | None = None


class _TimeLog:
    """Append-only, chronologically-ordered log for one key. `since`/`count_since` mirror
    `event_time >= lo [AND event_time <= hi]`; only already-appended items are ever visible, which mirrors
    `run_seq < k` for free."""

    __slots__ = ("_times", "_items")

    def __init__(self) -> None:
        self._times: list[datetime] = []
        self._items: list[Any] = []

    def append(self, event_time: datetime, item: Any) -> None:
        self._times.append(event_time)
        self._items.append(item)

    def since(self, lo: datetime, hi: datetime | None = None) -> list[Any]:
        i = bisect.bisect_left(self._times, lo)
        j = len(self._times) if hi is None else bisect.bisect_right(self._times, hi)
        return self._items[i:j]

    def count_since(self, lo: datetime) -> int:
        return len(self._times) - bisect.bisect_left(self._times, lo)

    def most_recent_since(self, lo: datetime, hi: datetime | None = None) -> Any | None:
        items = self.since(lo, hi)
        return items[-1] if items else None


class _PrefixCap:
    """Exact running count plus the first `cap` items ever appended — mirrors an SQL fetch with no time bound,
    `ORDER BY run_seq ASC LIMIT cap + 1` (R2's unbounded prior-denial history)."""

    __slots__ = ("count", "_items", "_cap")

    def __init__(self, cap: int) -> None:
        self.count = 0
        self._items: list[Any] = []
        self._cap = cap

    def append(self, item: Any) -> None:
        self.count += 1
        if len(self._items) <= self._cap:
            self._items.append(item)

    def legs(self) -> tuple[list[Any], bool]:
        truncated = len(self._items) > self._cap
        return self._items[: self._cap], truncated


def _dd() -> dict[str, _TimeLog]:
    return {}


@dataclass
class ReplayState:
    login_families: frozenset[str]
    forum_families: frozenset[str]
    max_packet_events: int

    account: dict[str, _TimeLog] = field(default_factory=_dd)
    ip: dict[str, _TimeLog] = field(default_factory=_dd)
    pair: dict[str, _TimeLog] = field(default_factory=_dd)
    pair_login: dict[str, _TimeLog] = field(default_factory=_dd)
    pair_401: dict[str, _TimeLog] = field(default_factory=_dd)
    pair_login_200: dict[str, _TimeLog] = field(default_factory=_dd)
    account_path_403: dict[str, _PrefixCap] = field(default_factory=dict)
    account_forum_view: dict[str, _TimeLog] = field(default_factory=_dd)
    account_object_view: dict[tuple[str, str], _TimeLog] = field(default_factory=dict)
    r1_matches_by_pair: dict[str, _TimeLog] = field(default_factory=_dd)
    r3_matches: _TimeLog = field(default_factory=_TimeLog)

    def _log(self, table: dict[str, _TimeLog], key: str) -> _TimeLog:
        log = table.get(key)
        if log is None:
            log = _TimeLog()
            table[key] = log
        return log

    def window_counts(self, ev: Event, windows: dict[str, int], r1_window: int) -> WindowCounts:
        from datetime import timedelta

        t = ev.event_time
        short = timedelta(seconds=int(windows["short"]))
        medium = timedelta(seconds=int(windows["medium"]))
        acct_log = self.account.get(ev.username)
        ip_log = self.ip.get(ev.ip_raw)
        login_log = self.pair_login.get(ev.pair_key)
        f401_log = self.pair_401.get(ev.pair_key)
        return WindowCounts(
            acct_5m=acct_log.count_since(t - short) if acct_log else 0,
            acct_1h=acct_log.count_since(t - medium) if acct_log else 0,
            ip_5m=ip_log.count_since(t - short) if ip_log else 0,
            pair_login_5m=login_log.count_since(t - short) if login_log else 0,
            pair_401_5m=f401_log.count_since(t - short) if f401_log else 0,
            pair_401_60s=f401_log.count_since(t - timedelta(seconds=r1_window)) if f401_log else 0,
        )

    def record_event(self, ev: Event, matches: list[Any], changes: list[Any]) -> None:
        leg = _Leg(ev.event_id, ev.run_seq, ev.event_time, ev.object_id)
        self._log(self.account, ev.username).append(ev.event_time, leg)
        self._log(self.ip, ev.ip_raw).append(ev.event_time, leg)
        self._log(self.pair, ev.pair_key).append(ev.event_time, leg)
        if ev.route_family in self.login_families:
            self._log(self.pair_login, ev.pair_key).append(ev.event_time, leg)
            if ev.status == 401:
                self._log(self.pair_401, ev.pair_key).append(ev.event_time, leg)
            elif ev.is_2xx:
                self._log(self.pair_login_200, ev.pair_key).append(ev.event_time, leg)
        if ev.method == "GET" and ev.status == 403:
            cap = self.account_path_403.get(ev.account_path_key)
            if cap is None:
                cap = _PrefixCap(self.max_packet_events)
                self.account_path_403[ev.account_path_key] = cap
            cap.append(leg)
        if ev.route_family in self.forum_families and ev.object_id is not None:
            self._log(self.account_forum_view, ev.username).append(ev.event_time, leg)
            key = (ev.username, ev.object_id)
            log = self.account_object_view.get(key)
            if log is None:
                log = _TimeLog()
                self.account_object_view[key] = log
            log.append(ev.event_time, leg)
        for m, ch in zip(matches, changes):
            if m.rule_id == "R1":
                record = {"event_id": ev.event_id, "run_seq": ev.run_seq, "event_time": ev.event_time, "incident_id": ch.incident_id}
                self._log(self.r1_matches_by_pair, ev.pair_key).append(ev.event_time, record)
            elif m.rule_id == "R3":
                record = {
                    "event_id": ev.event_id, "run_seq": ev.run_seq, "event_time": ev.event_time, "key_value": m.key_value,
                    "legs": m.legs, "params": m.params, "incident_id": ch.incident_id,
                }
                self.r3_matches.append(ev.event_time, record)
```

- [ ] **Step 4: Run the differential test and verify it passes**

Run: `python -m pytest tests/unit/test_replay_state.py -v`
Expected: PASS. If it fails, the mismatch message shows the exact `run_seq` and both count sets — compare against
the SQL in `features/history.py::window_counts()` field by field; the most likely bug is an inclusive/exclusive
boundary (`>=` vs `>`) on one of the six counters.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `python -m pytest tests/ -q`
Expected: same pass count as Task 1's baseline (this task only adds a new module + new test; nothing production
wires to it yet).

- [ ] **Step 6: Commit**

```bash
git add backend/app/features/replay_state.py tests/unit/test_replay_state.py
git commit -m "feat: add ReplayState, an in-memory equivalent of window_counts()"
```

---

### Task 3: Wire `ReplayState` into the detector for `window_counts`, keep rules on SQL for now

Smallest possible integration step: swap only the `window_counts()` call site, leave `detection/rules.py`
untouched (still takes `conn`). This isolates the highest-risk new code (Task 2) behind the full existing test
suite before also touching rules.

**Files:**
- Modify: `backend/app/workers/detector.py` (`Detector.__init__`, new `_replay_state` method, `_process_event`)

**Interfaces:**
- Consumes: `ReplayState(login_families, forum_families, max_packet_events)` from Task 2.
- Produces: `Detector._replay_state(run: dict) -> ReplayState`, mirroring the existing `_reference` method.

- [ ] **Step 1: Add per-run `ReplayState` storage and accessor**

In `Detector.__init__` (`backend/app/workers/detector.py`), alongside `self._references: dict[str, Reference] = {}`, add:

```python
        self._replay_states: dict[str, ReplayState] = {}
```

Add a method next to `_reference`:

```python
    def _replay_state(self, run: dict[str, Any]) -> ReplayState:
        rid = run["run_id"]
        if rid not in self._replay_states:
            login = frozenset(self.cfg.routes.categories.get("login_families", frozenset()))
            forum = frozenset(self.cfg.routes.categories.get("forum_object_view_families", frozenset()))
            self._replay_states[rid] = ReplayState(login, forum, int(self.cfg.policy["correlation"]["max_packet_events"]))
        return self._replay_states[rid]
```

Add `from app.features.replay_state import ReplayState` to the imports at the top of `detector.py`.

- [ ] **Step 2: Replace the `window_counts()` call site**

In `_process_event`, replace:

```python
            win = window_counts(conn, run_id, ev, windows, int(self.cfg.policy["rules"]["R1"]["window_seconds"]))
```

with:

```python
            win = self._replay_state(run).window_counts(ev, windows, int(self.cfg.policy["rules"]["R1"]["window_seconds"]))
```

Leave the `from app.features.history import StatsStore, window_counts` import — `window_counts` is still used by
`tests/unit/test_replay_state.py` and stays as the reference implementation in `history.py` (do not delete it
even after later tasks; it is the permanent oracle the differential test checks against).

- [ ] **Step 3: Record every event into `ReplayState` after it's fully processed**

At the end of `_process_event`, right after the existing `stats.apply_event(ev)` call, add:

```python
        self._replay_state(run).record_event(ev, matches, changes)
```

- [ ] **Step 4: Run the full suite**

Run: `python -m pytest tests/ -q`
Expected: identical pass count to Task 1's baseline. `window_counts` in `rules.py`'s `RuleContext` construction
still receives whatever `win` now is (a `WindowCounts` from `ReplayState` instead of SQL) — since Task 2's
differential test already proved these are equal, this should be transparent.

- [ ] **Step 5: Commit**

```bash
git add backend/app/workers/detector.py
git commit -m "perf: source window_counts from in-memory ReplayState instead of SQL"
```

---

### Task 4: Migrate rule R1 (auth burst) off SQL

**Files:**
- Modify: `backend/app/detection/rules.py` (`RuleContext`, `rule_r1_auth_burst`)
- Modify: `backend/app/workers/detector.py` (`RuleContext(...)` construction site)

**Interfaces:**
- Produces: `RuleContext.state: ReplayState` (replaces `RuleContext.conn: psycopg.Connection`).
- Consumes: `ReplayState.pair_401` (from Task 2/3), `_TimeLog.since()`.

- [ ] **Step 1: Change `RuleContext` to carry `state` instead of `conn`**

In `backend/app/detection/rules.py`, change:

```python
@dataclass
class RuleContext:
    conn: psycopg.Connection[Any]
    run_id: str
    ev: Event
    win: WindowCounts
    stats: StatsStore
    ref: Reference
    cfg: DetectionConfig
    r2_match: RuleMatch | None = None
```

to:

```python
@dataclass
class RuleContext:
    state: ReplayState
    run_id: str
    ev: Event
    win: WindowCounts
    stats: StatsStore
    ref: Reference
    cfg: DetectionConfig
    r2_match: RuleMatch | None = None
```

Add `from app.features.replay_state import ReplayState` to the imports; leave `import psycopg` for now (still
used by R2/R4/R5 until Tasks 5-7 finish) — remove it only in Task 7's final cleanup once nothing references it.

- [ ] **Step 2: Update the call site in `detector.py`**

Change:

```python
            ctx = RuleContext(conn=conn, run_id=run_id, ev=ev, win=win, stats=stats, ref=ref, cfg=self.cfg)
```

to:

```python
            ctx = RuleContext(state=self._replay_state(run), run_id=run_id, ev=ev, win=win, stats=stats, ref=ref, cfg=self.cfg)
```

- [ ] **Step 3: Rewrite `rule_r1_auth_burst`'s evidence fetch**

Replace the `_fetch(...)` call and its two following lines in `rule_r1_auth_burst` (currently lines 70-79) with:

```python
    from datetime import timedelta as _td

    log = ctx.state.pair_401.get(ev.pair_key)
    window_legs = log.since(ev.event_time - _td(seconds=int(cfg["window_seconds"])), ev.event_time) if log else []
    cap = int(ctx.cfg.policy["correlation"]["max_packet_events"])
    rows, truncated = window_legs[:cap], len(window_legs) > cap
    legs = [{"role": "prior_failure", "event_id": r.event_id, "run_seq": r.run_seq, "event_time": r.event_time.isoformat()} for r in rows]
    legs += [{"role": "current_failure", **ev.evidence_ref()}]
```

Note `window_legs` includes the current event `ev` itself only if it was already recorded — it is not, since
`record_event` runs *after* rule evaluation (Task 3, Step 3), so `since(...)` here only ever returns strictly
prior events, matching the old SQL's `run_seq < k`. Update the `RuleMatch(...)` return statement below to use
`legs` (unchanged variable name, just built differently) and `incomplete=truncated` (unchanged).

- [ ] **Step 4: Run the full suite**

Run: `python -m pytest tests/ -q`
Expected: identical pass count to baseline. Pay special attention to
`tests/integration/test_detector_rules.py::test_r01_*` (R1-specific scenarios) and
`test_t02_equal_timestamps_keep_stable_order_and_causal_windows` — these are the tests most likely to catch an
off-by-one in the window slicing.

- [ ] **Step 5: Commit**

```bash
git add backend/app/detection/rules.py backend/app/workers/detector.py
git commit -m "perf: migrate R1 evidence lookup off SQL onto ReplayState"
```

---

### Task 5: Migrate rule R2 (access change) off SQL

**Files:**
- Modify: `backend/app/detection/rules.py` (`rule_r2_access_change`)

**Interfaces:**
- Consumes: `ReplayState.account_path_403: dict[str, _PrefixCap]` (from Task 2).

- [ ] **Step 1: Rewrite `rule_r2_access_change`'s evidence fetch and recount**

Replace lines 100-114 of `rule_r2_access_change` (the `_fetch(...)` call and the subsequent `cur.execute(...)`
recount block) with:

```python
    cap_obj = ctx.state.account_path_403.get(ev.account_path_key)
    if cap_obj is None:
        rows, truncated, recount = [], False, 0
    else:
        rows, truncated = cap_obj.legs()
        recount = cap_obj.count
    legs = [{"role": "prior_denial", "event_id": r.event_id, "run_seq": r.run_seq, "event_time": r.event_time.isoformat()} for r in rows]
    legs += [{"role": "current_success", **ev.evidence_ref()}]
```

Note: `recount` will now always equal `denials` (both come from the same in-memory counter path), so
`incomplete=(recount != denials)` becomes tautologically `False`. This is an intentional, documented behavior
change — the SQL recount used to be an independent cross-check against a possible StatsStore/SQL drift; that
drift can no longer occur once both counts are computed by the same code path. Leave the `incomplete=(recount !=
denials)` expression in place unchanged (don't hardcode `False` — keep the check live in case a future bug
reintroduces two divergent counters).

- [ ] **Step 2: Run the full suite**

Run: `python -m pytest tests/ -q`
Expected: identical pass count. Check `test_r02_*` scenarios specifically for the truncation-flag behavior if any
scenario exercises more than `max_packet_events` (200) prior denials — unlikely in this dataset, but confirm.

- [ ] **Step 3: Commit**

```bash
git add backend/app/detection/rules.py
git commit -m "perf: migrate R2 evidence lookup off SQL onto ReplayState"
```

---

### Task 6: Migrate rule R3 (admin transition) off SQL

**Files:**
- Modify: `backend/app/detection/rules.py` (`rule_r3_admin_transition`)

**Interfaces:**
- Consumes: `ReplayState.account_forum_view: dict[str, _TimeLog]` (from Task 2).

- [ ] **Step 1: Rewrite `rule_r3_admin_transition`'s evidence fetch**

Replace the `_fetch(...)` call and the `if not rows: return None` / `view = rows[0]` lines (currently lines
136-147) with:

```python
    from datetime import timedelta as _td

    log = ctx.state.account_forum_view.get(ev.username)
    view = log.most_recent_since(ev.event_time - _td(seconds=int(cfg["forum_view_window_seconds"])), ev.event_time) if log else None
    if view is None:
        return None
    view_row = {"event_id": view.event_id, "run_seq": view.run_seq, "event_time": view.event_time, "object_id": view.object_id}
```

Update the two `legs = [...]` / `params={...}` lines below to read from `view_row` instead of `view` (same keys:
`view_row["object_id"]`, `view_row["event_time"]`, and use `_leg(view_row, "forum_object_view")` — note `_leg()`
expects a dict with `event_id`/`run_seq`/`event_time` as a `datetime`; `view_row["event_time"]` is already a
`datetime`, matching what `_leg()` calls `.isoformat()` on for SQL rows too, so no change needed to `_leg()`
itself).

- [ ] **Step 2: Run the full suite**

Run: `python -m pytest tests/ -q`
Expected: identical pass count. Check `test_r03_*` scenarios.

- [ ] **Step 3: Commit**

```bash
git add backend/app/detection/rules.py
git commit -m "perf: migrate R3 evidence lookup off SQL onto ReplayState"
```

---

### Task 7: Migrate rules R4 (account use sequence) and R5 (linked access change) off SQL, drop `conn` entirely

**Files:**
- Modify: `backend/app/detection/rules.py` (`rule_r4_account_use_sequence`, `rule_r5_linked_access_change`, imports)

**Interfaces:**
- Consumes: `ReplayState.pair_login_200`, `ReplayState.r1_matches_by_pair`, `ReplayState.r3_matches`,
  `ReplayState.account_object_view` (all from Task 2).

- [ ] **Step 1: Rewrite `rule_r4_account_use_sequence`'s two lookups**

Replace the `_fetch(...)` call for `login_rows` (lines 169-179) with:

```python
    from datetime import timedelta as _td

    login_log = ctx.state.pair_login_200.get(ev.pair_key)
    login = login_log.most_recent_since(ev.event_time - _td(seconds=int(cfg["login_window_seconds"])), ev.event_time) if login_log else None
    if login is None:
        return None
```

Replace the `with ctx.conn.cursor() as cur: ...` block for `r1` (lines 180-189) with:

```python
    r1_log = ctx.state.r1_matches_by_pair.get(ev.pair_key)
    r1_record = r1_log.most_recent_since(
        ev.event_time - _td(seconds=int(cfg["r1_episode_window_seconds"])), ev.event_time
    ) if r1_log else None
    if r1_record is None:
        return None
```

Update the `legs = [...]` block below: replace `_leg(r1[0], "r1_episode_match")` with a manually-built dict
(since `r1_record` is already the dict shape stored by `ReplayState.record_event`, not a raw SQL row) —

```python
    legs = [
        {"role": "r1_episode_match", "event_id": r1_record["event_id"], "run_seq": r1_record["run_seq"],
         "event_time": r1_record["event_time"].isoformat(), "incident_id": r1_record["incident_id"]},
        {"role": "successful_login", "event_id": login.event_id, "run_seq": login.run_seq, "event_time": login.event_time.isoformat()},
        {"role": "sensitive_success", **ev.evidence_ref()},
    ]
```

Update the `params={...}` and `links=[...]` below to read `r1_record["event_time"]` and `r1_record["incident_id"]`
in place of `r1[0]["event_time"]` / `r1[0]["incident_id"]`, and `login.event_time` in place of `login["event_time"]`.

- [ ] **Step 2: Rewrite `rule_r5_linked_access_change`'s three lookups**

Replace the `with ctx.conn.cursor() as cur: ... r3s = [...]` block (lines 217-224) with:

```python
    from datetime import timedelta as _td

    window = _td(seconds=int(cfg["window_seconds"]))
    r3s = list(reversed(ctx.state.r3_matches.since(ev.event_time - window, ev.event_time)))[:20]
```

The loop body (`for r3 in r3s:`) already treats `r3` as a dict with keys `key_value`, `params`, `legs`,
`incident_id` — this is exactly the shape `ReplayState.record_event` stores for R3 matches, so the loop body
(lines 226-235) needs no change.

Replace the `with ctx.conn.cursor() as cur: ... a_views = [...]` block (lines 236-244) with:

```python
    log = ctx.state.account_object_view.get((ev.username, obj))
    a_view = log.most_recent_since(b_view_time - window, b_view_time) if log else None
    if a_view is None:
        continue
```

Update the `legs = [...]` block below: replace `_leg(a_views[0], "a_viewed_object")` with:

```python
        {"role": "a_viewed_object", "event_id": a_view.event_id, "run_seq": a_view.run_seq,
         "event_time": a_view.event_time.isoformat(), "object_id": obj, "account": ev.username},
```

- [ ] **Step 3: Remove now-dead code**

Delete the `_fetch()` helper function (lines 50-56) and the `from app.db.engine import one` import — nothing
calls either anymore. Remove `import psycopg` if no longer referenced (check: `RuleContext` no longer has a
`conn: psycopg.Connection` field after Task 4, so this import should now be fully unused across the file —
confirm with a search before deleting).

- [ ] **Step 4: Run the full suite**

Run: `python -m pytest tests/ -q`
Expected: identical pass count. This is the highest-risk task in the plan (R4/R5 have the most cross-references)
— check `test_r04_*`, `test_r05_*`, and `test_generality.py`'s renamed/shifted-date scenario specifically, since
it independently re-derives the same rule chain (R1→R4, R2/R3→R5) under different account names/dates and would
catch a hardcoded assumption.

- [ ] **Step 5: Commit**

```bash
git add backend/app/detection/rules.py
git commit -m "perf: migrate R4/R5 evidence lookups off SQL onto ReplayState; drop psycopg dependency from rules.py"
```

---

### Task 8: Buffer `processed_events` writes, with a flush-before-match safeguard for `build_packet`

Now that nothing in `rules.py` reads `processed_events` via SQL anymore, this table's writes can also be
deferred — **except** `incidents/facts.py::build_packet()` (called from `incidents/correlate.py::apply_matches`)
still reads `processed_events` back via SQL for evidence legs, and that call happens inside the *same* batch, so
any events already processed earlier in the batch — including the current one — must be flushed to the database
before `apply_matches` runs.

**Files:**
- Modify: `backend/app/workers/detector.py` (`_WriteBuffers`, `_process_event`, `process_batch`)

**Interfaces:**
- Produces: `_WriteBuffers.processed_events: list[tuple]`; `_WriteBuffers.flush_processed_events(conn) -> None`.

- [ ] **Step 1: Add a `processed_events` buffer with its own flush method**

Extend `_WriteBuffers` (from Task 1):

```python
@dataclass
class _WriteBuffers:
    feature_snapshots: list[tuple[Any, ...]] = field(default_factory=list)
    detections: list[tuple[Any, ...]] = field(default_factory=list)
    processed_seqs: list[int] = field(default_factory=list)
    processed_events: list[tuple[Any, ...]] = field(default_factory=list)

    def flush_processed_events(self, conn: psycopg.Connection[Any]) -> None:
        if not self.processed_events:
            return
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO processed_events (event_time, run_id, run_seq, event_id, username, ip_raw, method, path, route_family, object_id,
                       status, response_bytes, threat_class, phase)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                self.processed_events,
            )
        self.processed_events.clear()
```

- [ ] **Step 2: Buffer the row, flush immediately before `apply_matches` when there are matches**

In `_process_event`, move the `processed_events` row construction to happen right after `matches`/`decision`
are computed (before the `apply_matches` call), append it to the buffer, and flush the buffer *before* calling
`apply_matches` whenever `matches` is non-empty:

```python
        decision = policy.classify(matches, score, threshold)
        side_effects = ev.phase == "visible"
        buffers.processed_events.append(
            (ev.event_time, run_id, ev.run_seq, ev.event_id, ev.username, ev.ip_raw, ev.method, ev.path, ev.route_family,
             ev.object_id, ev.status, ev.response_bytes, decision.threat_class, ev.phase)
        )
        if matches:
            buffers.flush_processed_events(conn)
        with sentry.span("correlate", matches=len(matches)):
            changes = apply_matches(
                conn, run=run, ev=ev, matches=matches, observed=fr.observed, cfg=self.cfg, reference_hash=ref.hash,
                app_base_url=self.settings.app_base_url, side_effects=side_effects, trace_context=trace,
            )
```

Remove the old immediate `with conn.cursor() as cur: cur.execute("""INSERT INTO processed_events ...""")` block
that Task 1 Step 2 kept in place — this task is what finally moves it into a buffer.

- [ ] **Step 3: Flush any remaining buffered `processed_events` rows at end of batch**

In `process_batch`, in the same `with conn.cursor() as cur:` block added in Task 1 Step 3, add before the
`feature_snapshots`/`detections` flush:

```python
        buffers.flush_processed_events(conn)
```

(Call this as its own statement using its own cursor internally — it opens its own `with conn.cursor()`, so it
does not need to be inside the same `with conn.cursor() as cur:` block as the other flushes; place the call
immediately before that block.)

- [ ] **Step 4: Run the full suite**

Run: `python -m pytest tests/ -q`
Expected: identical pass count. If a test fails inside `build_packet`/`apply_matches` with a missing-row or
empty-result error, the flush-before-match ordering in Step 2 was placed after `apply_matches` instead of before
— double check the `if matches: buffers.flush_processed_events(conn)` line is genuinely reached before the
`apply_matches(...)` call.

- [ ] **Step 5: Commit**

```bash
git add backend/app/workers/detector.py
git commit -m "perf: buffer processed_events writes, flushing early only when a rule match needs SQL visibility"
```

---

### Task 9: Raise the microbatch size, measure, and update the performance report

**Files:**
- Modify: `config/policy.yaml` (`replay.microbatch`)
- Modify: `reports/performance.md`

- [ ] **Step 1: Raise the batch size**

In `config/policy.yaml`, change `replay: microbatch: 200` to `replay: microbatch: 5000`. (This is a starting
point, not a guess to leave unverified — Step 2 measures it.)

- [ ] **Step 2: Run the existing benchmark / full replay and record real numbers**

Run: `python -m scripts.benchmark` (or whatever the existing command in `reports/performance.md`'s header used —
`python -m scripts.benchmark` per that file — and separately time a full causal replay the same way the original
`rules-only-full` measurement was produced, per `reports/performance.md` §"Causal replay throughput").
Expected: a wall-clock time and events/sec figure you can paste into the report. If throughput is far below
expectations, profile before tuning further — do not hand-tune `microbatch` blindly; re-run once after any
change to confirm direction.

- [ ] **Step 3: Run the full test suite one final time**

Run: `python -m pytest tests/ -q`
Expected: identical pass count to the Task 1 baseline — this is the final correctness gate for the whole plan.

- [ ] **Step 4: Update `reports/performance.md` with the newly measured numbers**

Add a new dated section (do not silently overwrite the old measurements — the report's own scope statement says
"measured, not estimated"; keep the old numbers as a labeled "before" row and add the new run as "after", both
sourced from an actual command you ran in Step 2). Follow the existing table format in the file.

- [ ] **Step 5: Commit**

```bash
git add config/policy.yaml reports/performance.md
git commit -m "perf: raise replay microbatch size, record measured throughput after ReplayState refactor"
```

---

## Self-Review Notes (from writing this plan)

- **Spec coverage:** every DB round-trip identified as part of the per-event hot path (`window_counts`, R1-R5
  evidence fetches, the 4 per-event `feature_snapshots`/`detections`/`processed_events`/`run_events` writes) has
  a task. `incidents/correlate.py` and `notifications/outbox.py` are explicitly out of scope with a stated reason
  (short-circuit on empty matches, rare in this dataset) — Task 8 handles the one real interaction between them
  (`build_packet` reading `processed_events`).
- **Placeholder scan:** no task says "add tests" without showing the test; no task says "handle edge cases"
  without naming which edge case and why (ties, truncation caps, the R2 recount becoming tautological).
- **Type consistency:** `ReplayState.window_counts` returns `WindowCounts` (imported, not redefined);
  `RuleContext.state: ReplayState` is introduced in Task 4 and consumed identically in Tasks 5-7; `_Leg` fields
  (`event_id`, `run_seq`, `event_time`, `object_id`) are used consistently in every rule's leg-construction code
  in Tasks 4-7.
