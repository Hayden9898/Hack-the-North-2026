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

### M7 — harden, evaluate, package ✅
- Full regression: `pytest -m "not slow"` → 81 passed + `test_analytics_and_replay.py`/`test_generality.py` 5 passed
  when run serially (three failures in the combined run were caused by a second pytest process truncating the shared
  test database concurrently — rerun serially: all green). `-m slow` D01 full-file import: passed (23 s).
- Full-dataset replay with the active model (`hybrid-full`): 180,800 events, same 3 incidents, March = 2 high risk +
  36 suspicious (7 rule + 31 model-only markers, matching `ml.evaluate`). 77 ev/s while the test suite shared the DB
  (215.6 ev/s uncontended, `rules-only-full`).
- R07 generality: renamed accounts/IPs, /24, object ids, seed and dates shifted to 2027 → identical rule set and
  incident classes (`tests/integration/test_generality.py`).
- Browser verification (Chrome, this session): run console start → warmup → auto-pause at visible boundary → resume
  (virtual clock at 120×, SSE live) → pause; detector worker killed mid-run and restarted: processed == detections,
  no gaps/duplicates, run continued; hybrid run incidents; R2/R5 incident evidence drawer (78 exact lines, proof
  77 = 77 ✓); labelled fault injection → "AI proposal rejected by validator" with reasons, deterministic facts and
  unknowns intact; playbooks; no console errors. Servers stopped afterwards.
- `mypy` clean, `ruff` clean, frontend `tsc`/`oxlint`/`vite build` clean.
- Commands/reports: `reports/{investigation,evaluation,performance,sponsor-evidence,demo-script}.md`.
- Not done / blocked: real Slack, Sentry, Tiger Cloud and Anthropic calls (no credentials supplied) — adapters tested
  with stubs only; live-mode p95 latency not measured (no live source).

### M8 — ML preprocessing stage (branch `feature/ml-preprocessing`) ✅ candidate, not activated
- Finding: 8 of 30 v1 features are constant on the Sep–Dec training partition (`pair_unfamiliar`,
  `first_200_after_denials`, `is_admin`, `unusual_query_key_count`, `status_other`, `bytes_reference_missing`,
  `reference_unknown`, `cold_start`); an Isolation Forest never splits on a constant column, so the active model was
  blind to the attack indicators (that is why line 168338 scored 0.618, below threshold).
- `app/detection/preprocess.py` (`domain_v1`): `TrainingDomain` transformer fitted on training only, first step of a
  pickled `Pipeline`; prunes blind spots from the forest input (30 → 22) and adds +1.0 per never-seen value so zero
  training support always outranks any in-domain score. `ml.train` builds it by default (`--no-preprocess` opt-out),
  manifest carries `preprocessing`; `load_model` verifies schema and manifest agreement; legacy artifacts unchanged.
- Candidate `if_v1_domain_2026-09-19` (same source run, same params, 99.9): calibration burden identical (44 alerts,
  0.75/day, 0 departures); March model-only 36 → 50 alerts, rule events flagged 5/7 → 7/7, high-risk 1/2 → 2/2,
  known sequence flagged 12/20 → 17/20 incl. the pivotal 168338. See `reports/preprocessing.md`.
- Verified: `tests/unit/test_preprocess.py` 8 passed; `test_model_integration.py` 4 passed (new M05 parity +
  blind-spot flags + refusal); mypy clean, ruff clean.
- Not done: the candidate is **not** activated (active model still `if_v1_2026-09-19`, so `reports/evaluation.md`
  still describes the live demo); activate with
  `python -m ml.calibrate --model-id if_v1_domain_2026-09-19 --percentile 99.9 --activate`.

### Frontend + observability + acceptance follow-up — September 19, 2026

- AWS-first resource console implemented: flat navigation, URL-preserved filters/details, keyboard commands, responsive
  tables, Motion drawers, evidence proofs, explicit degraded states and real API contracts. Reference inventory in
  `docs/design/frontend-direction.md`. Optional `/welcome` adapts the IRL monochrome/lanyard interaction using original
  CSS/SVG/Motion artwork; no heavy WebGL enters the console.
- Added React Sentry and upgraded Python Sentry to 2.69.2. Application errors, structured logs, API/navigation/worker
  traces and distributed context are wired. Allowlist scrubbing removes evidence, prompts, request content, SQL,
  exception messages/locals and automatic breadcrumbs. No Session Replay. Operator-only diagnostic explicitly distinguishes
  queued from externally verified events. MCP/CLI authentication is separate; application DSNs still absent.
- Added `doctor`, `verify`, individual gates, read-only canonical `verify-live`, and `verify-report`; per-run HTML/JSON,
  browser screenshots/traces and Python JUnit. Added frontend-first CI workflow (not run remotely). No silent skipped/flaky
  passes; DB-name/identity checks and a session advisory lock protect destructive fixtures from production or concurrent tests.
- Fixed test portability: import cases depended on absent ignored `.log` files; now generated as explicit synthetic test
  fixtures, retaining assertions. The full-file test still requires the original SHA-256 and exact dataset counts.
- Fixed model artifact IDs in readiness, stale/failure UI edges, lazy-route startup state and mobile badge clipping.
- Verified locally: **100 Python tests (61 non-DB + 39 DB), 23 Chromium checks (22 UI + 1 real SDK/local transport),
  types/lint/build, dependency checks and diff checks passed**. Details: `docs/design/verification.md`.
- Local Docker persistent storage was full. Tests passed against isolated RAM-backed TimescaleDB on port 5434; no
  unrelated Docker data was deleted. Persistent dev/API readiness remains blocked. Original canonical data/model missing
  locally; historical M7 measurements above have not been re-run here. The canonical live gate refuses to fabricate a pass.
- Sponsor review: `docs/sponsor-fit.md`; prioritize already-selected CSE/Sentry/Tiger Data evidence. Sentry needs Logs
  and Tracing plus demonstrated real impact, not SDK installation alone. Sponsor selection cutoff was Sep 19, 2 PM EDT.
- Remaining external gates: Sentry organization/project choice and DSNs, actual telemetry receipt and diagnostic improvement,
  original dataset/model, persistent DB capacity, deployed auth/TLS/SSE/storage, private source maps, other real provider calls.

### CSE comparison and evidence workflow follow-up — September 19, 2026

- Reviewed public Minny `eedd030` and htn26 `4ebcbe4` source snapshots without running or incorporating their code.
  `docs/competitive-review.md` distinguishes implemented strengths, unreproduced benchmark claims, and our release gaps.
- Added version-pinned investigation briefs: recorded account, trigger/time/source line, measured fact → proof links,
  explicit unknowns/context, confidential local JSON handoff with source/config/model provenance. No AI proposals or
  mutable operational state in exports. Kept overview focused; moved AI review alongside analyst review/response.
- Fixed historical incident leakage from later evidence memberships, same-sequence R5 rule matches, relationships and
  reviews. Migration 0004 records relationship-creation provenance and backfills legacy R5 links from persisted evidence.
- Added real-DB regression for version isolation/backfill and three browser checks for export integrity, keyboard focus,
  accessibility, mobile/reduced motion, missing/truncated evidence and inert untrusted text. Fixed mobile search labeling.
- Verified: **101 Python tests (61 non-DB + 40 DB), 26 browser checks (25 UI + 1 SDK), types/lint/build and diff checks**.
  Reports: `20260920T013836.953603Z-backend` and `20260920T013932.252622Z-frontend` under `reports/verification/`.
- Disposable synthetic test DB removed after verification; no existing application data changed. Apply migration 0004
  to the intended app database before restarting updated services. Canonical-data/model, persistent DB, real Sentry
  credentials/receipt and hosting remain unverified; no detection-accuracy superiority or prize outcome is claimed.
### M9 — Runs always attach the active model (branch `fix-ml-pipeline`) ✅
- Root cause of the "rules-only mode" banner on UI-created runs: `model_id` was per run, the run form's model field
  was free text defaulting to blank, and nothing resolved the active model on the operator's behalf. Only
  `replay-demo` looked it up, so `hybrid-full` scored with ML while every UI-created run was rules-only.
- `runs.create_run` now attaches the newest active model (`runs.active_model_id`) whenever `model_id` is not
  pinned. There is no opt-out anywhere (UI, API or CLI): every run is rules + ML. The only rules-only run is one
  created before any model is active (bootstrap snapshot pass); it degrades visibly, never with a fabricated model.
- New `GET /api/v1/models` (status, threshold, `is_default`, `artifact_present`); the run form has no model choice,
  it states which model every run gets; `pending_load` gets a label.
- `/health/ready` reports `models.active` and a `no_active_model_rules_only` degraded mode; the artifacts list now
  names model ids (it listed `manifest.json` twice before).
- Verified: `tests/integration/test_run_default_model.py` 4 passed (default/newest/pinned, API, health);
  full suite 100 passed (11 min); mypy, ruff, tsc, oxlint, vite build clean. The running API must be restarted to
  pick this up (`serve_api` runs without reload).

### M9 — hosted deployment (Railway) ✅ image verified, cloud deploy pending credentials
- One `Dockerfile` (node build → python:3.12-slim runtime, 184 MB) running three roles: `scripts.serve_api`
  (FastAPI **plus** the built console, mounted last so API routes always win and unknown `/api/*` stays a JSON 404),
  `scripts.serve_worker` (detector + side-effect loops as two threads, `WORKER_ROLES` to split them, SIGTERM drains),
  and the existing one-off CLIs. `railway.json` / `railway.worker.json` carry build, start command and healthcheck;
  `docker compose --profile app` runs the same image locally (opt-in, `db-up` unaffected).
- D-006 No Redis/object storage: the queues are Postgres tables with `SKIP LOCKED` leases and the model is CPU
  scikit-learn from the image. Consequence recorded in `docs/DEPLOY.md`: `POST /datasets` (upload → worker import)
  needs a shared filesystem, so hosted seeding is `scripts.import_dataset` over the network instead.
- Browser/API auth for shared deployments: `/health/ready` now declares `auth.operator_required`; the console asks
  for the operator token in its header and sends it only as `Authorization` (sessionStorage, never a URL). Reads stay
  unauthenticated, as locally.
- Fix: `scripts.migrate` treated an empty `TEST_DATABASE_URL` as reachable — `ping("")` falls back to the default
  connection parameters — and then failed the deploy on `create_engine('')`. Empty now means "not configured".
- Verified in containers against the local TimescaleDB (`docker compose --profile app up --build`): `/health/ready`
  → `ready`, `timescaledb 2.30.1`, migrations `0004/0004`, `auth.operator_required=true`; SPA served at `/`, deep route
  `/runs/abc` → 200, `/api/v1/nope` → JSON 404; mutation 401 without/with a wrong bearer, 201 with the right one;
  3 live events ingested with `X-Ingest-Token` and processed by the *separate* worker container (processed_seq 3).
  Frontend `tsc`/`oxlint`/`vite build` clean; `ruff`/`mypy` clean on the touched files; `tests/integration/test_health.py`
  5 passed (the DB-backed case errored on a TRUNCATE deadlock from another pytest process sharing `logorder_test`).
- Not done: no Railway project created and no Tiger Cloud connection string, so the deployment itself is
  **unverified**; `ml/artifacts/` is empty in this checkout, so a deploy from git is rules-only until an artifact is
  force-added; the left-over `deploy-check` live run in the local dev database is a verification artifact.

### M9 — containment actions: the call to action ✅
- Problem: the console ended at *reading* — playbooks rendered as prose under "nothing here executes". Added the
  loop that turns a described incident into an approved, verifiable operation without pretending to touch a system
  that does not exist behind a replayed log.
- `config/actions.yaml` (7 actions, 6 containment + 1 handoff) maps each playbook step to a typed action. D-008
  **The AI never supplies a parameter**: `actions/binding.py` reads every value from the incident row or a typed fact
  (`fact:<kind>.args.<key>`, `fact:<kind>.value`, optional `split` for `account|path` keys) and keeps the fact id as
  provenance; a missing fact makes the action *unavailable with the reason*, never partially bound. Preconditions
  (`incident_status_open`, `rule_any`, `fact_present`, `fact_value_in`) are evaluated by code and shown as checks.
- `actions/service.py` sequences dry run → execute → verify → rollback. Refusals are typed 409s: `dry_run_required`,
  `already_executed`, `binding_changed` (the `params_hash` pinned at dry run no longer matches a re-binding),
  `preconditions_unmet` (re-evaluated at execute time, not trusted from the dry run), `not_executed`/`not_reversible`.
  Every phase appends to `action_log` (operator, adapter, exact request, result) before state moves.
- D-009 Execution adapters mirror Slack: `PreviewAdapter` (default) records the request and reports
  `applied_to_external_system: false`; `WebhookAdapter` POSTs the same object when `ACTION_MODE=live` +
  `ACTION_WEBHOOK_URL`. `incidents.contained_at` + `containment_mode ∈ {preview, applied}` — a preview is stamped as
  a preview, and `runs.counts.containment` reports `contained/actionable`, `preview`, `applied`, `median_seconds`.
- `actions/verify.py`: six named SQL identities over `processed_events` under the cutoff (`success_on_path_after`,
  `events_from_source_after`, `admin_post_2xx_after`, …). In a replay the log is fixed, so `contradicted` means "the
  recorded activity continued past the approval point" — surfaced as such rather than hidden.
- `actions/packet.py`: response packet (Markdown) from committed rows only — facts with evidence refs, timeline,
  unknown codes, playbooks, bound actions, action log, dispositions; `sha256` + fact packet hash; `POST` stores it
  and queues a `response_packet` message through the existing outbox (same preview/live rules, idempotent key).
- API `api/actions.py`: `GET …/actions`, `POST …/actions/{id}/{dry-run,execute,verify,rollback}`,
  `GET|POST …/response-packet` (`?download=true` → `.md` attachment). Migration `0004` (`action_proposals`,
  `action_log`, `response_packets`, containment columns). Health `integrations.actions`.
- UI: `pages/ActionsSection.tsx` under the playbooks — bound parameters with "bound from" column, impact /
  permissions / rollback / verification, dry-run request viewer, confirm-to-execute, verification banner, rollback,
  append-only log, response packet preview/download/send. Run console gains a **Containment** block.
- CLI: `scripts/contain_incident.py` (list / dry run / execute / verify / packet) over the same service layer.
- Verified: `tests/unit/test_action_binding.py` 18 passed; `tests/e2e/test_action_flows.py` 11 passed (273 s) —
  provenance listing, unavailable reasons, full loop with containment stamp + clear on rollback, append-only log and
  SSE `action` updates, `binding_changed`, execute-time precondition re-check via a closing disposition, 404 for an
  inapplicable action, `block_source` binding on an R1 incident, packet render/download, outbox handoff idempotency,
  run containment counts. `ruff`, `mypy` (68 files), `tsc`, `oxlint` clean.
- Not done: no real remediation endpoint, so the `live` adapter is **unverified**; the catalog is reviewed content,
  not a claim about CSE's systems; no Slack Block Kit buttons (would need an interactive app, not a webhook).
