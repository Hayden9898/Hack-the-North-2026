# Progress record

Concise record of milestones, decisions, commands and results. Newest entries at the bottom of each section.

## Environment (observed 2026-09-19)

- Windows 11, Python 3.12.6, Node 24.18, Docker Desktop 28.5.1 (had to be started), no `make` (use `python tasks.py`).
- Database: `timescale/timescaledb:latest-pg17` pinned by digest → PostgreSQL 17.11, TimescaleDB 2.30.1, port 5433.
- No credentials present for Tiger Cloud, Slack, Sentry or an LLM provider. Defaults: local DB, Slack preview,
  Sentry disabled (visible), deterministic-only AI review. Adapters are built and unit-tested; cloud integrations
  are reported as **unverified** until credentials are supplied.

## Assumptions / decisions

- D-001 Repo was empty (no commits). Scaffolded the default stack from architecture.md; commits on `main` per milestone.
- D-002 Frontend: React + TypeScript + Vite (no existing frontend to preserve).
- D-003 LLM provider default: Anthropic via official SDK; selected by `LLM_PROVIDER`; absent key ⇒ deterministic mode.
- D-004 Migrations are hand-written SQL inside Alembic revisions (hypertables need raw SQL anyway).
- D-005 Added tables beyond the architecture list: `rule_matches` (per-rule legs/params for provenance) and
  `run_late_events` (late live records kept separate from the ordered inbox). Both are additive; contracts unchanged.

## Milestones

### M0 — runnable foundation ✅
- Compose DB, pinned Python deps (`requirements.txt` + `requirements.lock.txt`), Vite shell, config YAMLs,
  Alembic revision 0001 (24 tables, 2 hypertables), health routes, Sentry wiring, task runner.
- Verified: `python -m pytest -q` → 8 passed (config unit tests, health integration tests incl. DB-missing 503).

### M1 — ingest + factual investigation ⏳
- Parser (strict, forensic preservation, one bounded decode pass), registry (accepted/duplicate/conflict), checkpointed
  idempotent importer, CLI `python tasks.py import`. Investigation script + `reports/investigation.md`.
- Verified: full import 180,800/0 rejects, hash + status counts + range match; reimport inserts 0; leading-zero IP kept;
  line 168338 round-trips to its raw line; 77 prior denials confirmed by causal loop and SQL recount.
  Commands: `python -m scripts.import_dataset` (22.3 s), `pytest tests/integration/test_import.py` (4 passed).
- Fix: finalize now runs ANALYZE before the registry/raw join — without statistics the planner chose a nested loop that
  ran >14 minutes on a fresh test database (no index on raw_events.event_id alone; hypertable PK is (time,id)).

### M2 — deterministic vertical slice ⏳
- Detector (ordered microbatch transactions, entity counters, bounded window queries), rules R1–R5, correlation with
  immutable versions + typed fact packets, deterministic summaries, Slack preview outbox with debounce, run
  admission/controls (speed 0 = unbounded fast-forward), API (runs/events/incidents/facts/feedback/SSE/live ingest),
  side-effect worker (leases, retries, 429 Retry-After, permanent 4xx, ambiguous timeouts, preview mode).
- Verified: `pytest -m "not slow"` → 62 passed (R01–R06, T02, T04–T06, D01–D04, Q02/Q03, S02, T03/D03, U01 once-mode).
  Full real-dataset rules-only replay: 180,800 events in 840 s (215 ev/s), 3 incidents, rule matches exactly at lines
  168314/168324–6 (R1), 168336 (R3), 168338 (R2+R5 high risk), 168345 (R4 high risk); zero matches elsewhere.
- D-006 Model-only anomalies mark the event `suspicious` in the feed (with measured deviations) but create no incident
  and no Slack message; only rules create incidents. Reason: calibration review showed ML flags are rarities, not
  sequences; incident/alert semantics stay deterministic and inspectable.
- D-007 SSE endpoint gained `?once=true` (send available updates then close) as the documented polling fallback.

### M3 — ML trained, calibrated, integrated ✅
- `ml/train.py` fits IsolationForest on Sep–Dec causal snapshots (92,001 rows), calibrates on Jan–Feb (43,972 rows);
  `ml/calibrate.py` reviews burden at 99/99.5/99.9 with sampled alerts vs a naive rarity baseline; `ml/evaluate.py`
  reports rules/model/hybrid/baseline on March + known-sequence timing. Model `if_v1_2026-09-19` active at the 99.9th
  percentile (threshold 0.6338, 0.75 flags/day on calibration). See `reports/evaluation.md`.
- Verified: `tests/integration/test_model_integration.py` → 3 passed (M01 parity + shadow, M03 degraded/schema/hash/path
  refusal, M02 failures never familiar, M04 cold start not high risk).

### M5 — constrained AI investigation + playbooks ✅
- `app/investigation/`: typed selection schema (fact ids/codes only, no prose), validator (schema, packet hash,
  membership, cutoff, per-hypothesis minimum predicates, contradictions, playbook applicability, forced trigger
  inclusion), bounded read-only tools (run_id/cutoff injected; ≤6 calls, ≤200 rows), Anthropic adapter (official SDK
  1.7.0, `claude-opus-5`, strict client tools, `submit_selections` tool), pipeline (deadline, one repair, cache by
  packet hash, deterministic fallback), reviewed `config/playbooks.yaml`, playbooks in incident API.
- Verified: `tests/unit/test_validator.py` 10 passed; `tests/integration/test_investigation.py` 6 passed
  (valid+tools, E01, E02 injection/tool scope, E03 stale version, E04 FP cannot suppress, Q01 timeout fallback).
- Real provider call is **unverified** (no LLM_API_KEY); the adapter is exercised only through the scripted fake.
- Fixes from frontend review: events page query limits before joining (90 ms → 1.3 ms server-side on 180k rows),
  summary lines de-duplicated across versions, timeline rows aggregated per event, live runs start in `visible` phase.

### M6 — sponsor integrations + delivery reliability ✅ (cloud services unverified)
- Migration 0003: continuous aggregate `processed_events_5m` (materialized_only, explicit refresh, watermark table).
  `app/incidents/analytics.py`: aggregate + raw tail, raw as-of views, raw fallback when never refreshed/missing,
  server-side roll-up (5m/60m/1d, optional account grouping); endpoints `/analytics/{timeseries,refresh,benchmark}`;
  side-effect worker refreshes stale runs every ≥30 s.
- Measured (`python -m scripts.benchmark`, `reports/performance.md`): events page 79.7 → 2.9 ms; aggregate vs raw
  716 → 402 ms (all buckets) and 72 → 37 ms (daily), identical results; window query p95 1.2 ms; 215.6 ev/s replay.
- Verified: `tests/integration/test_analytics_and_replay.py` 3 passed (A01/A02, pause drains ≤ queue cap then resumes,
  virtual clock gates admission). mypy clean (59 files), ruff clean, frontend typecheck/lint/build clean.
- Sentry/Slack/Tiger Cloud/LLM remain **unverified** externally (no credentials) — see `reports/sponsor-evidence.md`.
