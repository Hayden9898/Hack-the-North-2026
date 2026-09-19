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
