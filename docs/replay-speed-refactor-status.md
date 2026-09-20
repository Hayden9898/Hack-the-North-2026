# Replay speed refactor — status

Tracks progress on the causal-replay performance refactor described in
`docs/superpowers/plans/2026-09-19-replay-speed-refactor.md`.

## Goal

Make a full causal replay of the 180,800-line dataset dramatically faster by removing per-event Postgres
round-trips, while producing identical detections, rule matches and incidents.

## Status: Task 1 of 9 in progress

**Task 1 — batch `feature_snapshots`/`detections`/`run_events` writes per microbatch** (this commit):

- `backend/app/workers/detector.py`: added a `_WriteBuffers` dataclass (`feature_snapshots`, `detections`,
  `processed_seqs`). `_process_event` now appends rows to these buffers instead of executing an `INSERT`/`UPDATE`
  per event; `process_batch` flushes each buffer once per microbatch via `cursor.executemany(...)`, following the
  same pattern already used by `StatsStore.flush()` in `backend/app/features/history.py`.
- The `processed_events` `INSERT` is deliberately left untouched (still executes immediately, per event) — a
  later task in the plan migrates it once nothing needs to read it back mid-batch via SQL.
- **Not yet run to completion:** the implementer's verification test run was stopped before it finished. This
  change has not been confirmed against the test suite yet. Treat it as unverified until a full
  `python -m pytest tests/ -q -m "not slow"` run is completed and compared against the recorded clean baseline
  (95 passed, 1 deselected, see the plan's ledger at
  `.superpowers/sdd/2026-09-19-replay-speed-refactor/progress.md`).

## Remaining tasks (per the plan)

2. Build `ReplayState` (in-memory window-count equivalent) with a differential test against the SQL original.
3. Wire `ReplayState` into the detector for `window_counts`.
4-7. Migrate rules R1-R5's evidence lookups off SQL onto `ReplayState`.
8. Buffer `processed_events` writes too, with a flush-before-match safeguard.
9. Raise the microbatch size, measure real throughput, update `reports/performance.md`.

## Environment note

This work happens in an isolated git worktree (`worktree-replay-speed-refactor`) against an isolated TimescaleDB
container (`logorder-db-sdd`, port 5434) created specifically for this refactor, so it never contends with the
shared dev database on port 5433.
