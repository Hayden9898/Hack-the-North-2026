# WatchTower — coding-agent execution plan

**Version 1.0.** Read `overview.md` -> `architecture.md` -> this file before editing application code. This package replaces the two previous proposals. The requested deliverable is a working, tested implementation, not another plan. Implement milestone gates in order and keep a concise progress record. Do not treat example configuration or estimated time as measured results.

## 1. Operating instructions

Inspect the supplied repository and applicable AGENTS.md instructions first. Preserve working code and the team's uncommitted changes. No repository was available while writing this specification, so paths below are target module boundaries, not claims that files already exist. If no project exists, scaffold the default stack from architecture.md. Reuse an existing compatible frontend rather than rewriting it to satisfy a framework preference.

Use the most capable available coding model; this design does not depend on particular model names or a multi-agent runtime. Choose routine implementation details autonomously. Stop only for missing credentials/destination needed for an actual integration or a material conflict that cannot be resolved locally; continue all unblocked local work. Do not reinterpret absent credentials as permission to fake successful integrations.

Do not deploy publicly, send test alerts to arbitrary recipients, or alter production accounts. Once the operator explicitly configures the intended Slack destination and enables live delivery for a run, use that configuration without repeated permission prompts. Keep development/replay preview mode as the default.

Create a decision note when changing a contract. The note must state the observed issue, chosen change and regression check. Do not drop causal ordering, evidence validation, run isolation or durable delivery to make a demo appear complete.

## 2. Inputs and configuration

Required input: `htn_challenge_logs_2026.txt` with expected SHA-256 `9f773643335352d8aa8cc9f07c5f92614b65c806f84c84790f56e4c652970575`. In the current workspace it is at `/workspace/scratch/616e1430067b/upload/htn_challenge_logs_2026.txt`; that scratch path is not portable, so locate an explicitly supplied copy or use DATASET_PATH. Do not hardcode that absolute path into application code.

The prize sheet and old handoffs are context; overview.md already records the relevant verified requirements and source limitations. Prior winning project repositories were not supplied. Only reuse code whose license and event rules allow it, with attribution.

Provide `.env.example` with nonsecret placeholders:

| Variable | Purpose/default |
|---|---|
| DATABASE_URL | Local TimescaleDB or Tiger Cloud connection; require provider TLS for cloud |
| DATASET_PATH | Local import CLI input |
| MODEL_DIR | Only locally generated, versioned artifacts |
| APP_BASE_URL | Trusted URL used in alert links |
| APP_AUTH_SECRET / INGEST_TOKEN | Shared-deployment session signing and source authentication |
| SENTRY_DSN / SENTRY_ENVIRONMENT | Observability, disabled visibly when not configured |
| LLM_PROVIDER / LLM_MODEL / LLM_API_KEY | One provider; deterministic mode when absent |
| SLACK_MODE | preview by default |
| SLACK_WEBHOOK_URL | Server-only secret for intended destination |
| MAX_RUN_NOTIFICATION_COUNT | Cap explicitly enabled replay test delivery |

Thresholds, route patterns, time windows and feature versions belong in versioned configuration files, not env strings or scattered constants. Pin dependency versions and database image after verifying a local and target-cloud smoke test. Preserve all timestamp offsets and raw evidence.

## 3. Target repository boundaries

- backend/app/api: REST, upload, OpenAPI and SSE.
- backend/app/ingest: parser, idempotent import and ordered live admission.
- backend/app/db: models, repositories and migrations.
- backend/app/features: pure feature definitions and SQL-backed observed history.
- backend/app/detection: model adapter, independent R1–R5 rules and final policy.
- backend/app/incidents: correlation, immutable versions, typed facts and evidence queries.
- backend/app/investigation: bounded provider adapter, selections schema and validator.
- backend/app/notifications: deterministic templates, outbox and delivery adapter.
- backend/app/observability: spans, sanitized logs and health.
- backend/app/workers: ordered detector, replay controller and side-effect job loop.
- frontend/src: live feed, run controls, incident timeline, evidence drawer and health indicators.
- config: route categories, policy defaults, playbooks and model partitions.
- ml: train, calibrate, evaluate and artifact manifests.
- tests: fixtures, unit rules/features, database integration and critical end-to-end flows.
- scripts: import, replay, benchmark and demo setup.
- reports: investigation.md, evaluation.md, performance.md, sponsor-evidence.md.

Keep implementation small enough to understand. A module need not become a separate service/package.

## 4. Ordered milestones

Time budgets below are planning estimates for a capable team and coding agent, roughly 18–24 productive hours total. Work to gates; revise the schedule if less time remains. Instrument the first vertical slice so observability is available during development.

### M0 — establish runnable foundation (about 1 hour)

- Inspect existing project, data paths and instructions; record assumptions.
- Set up backend, frontend shell, pinned dependencies, local database and health routes.
- Create migrations for evidence registry, raw hypertable, runs, ordered inbox and updates.
- Wire basic Sentry Tracing + Logs and visible integration status from the beginning.
- Provide a one-command local startup with credentials optional for LLM/Slack/Sentry.

**Gate:** clean checkout starts backend/UI/database; migrations run; readiness distinguishes missing DB from optional integrations; no secret is committed or returned in errors.

### M1 — ingest and produce the factual investigation (about 2 hours)

- Implement strict parser and original-line evidence references.
- Import all records, compute/verify hash and statistics, and keep rejects explicitly.
- Implement idempotent import retries and client event conflict handling.
- Reproduce the overview's March timeline and verify the 77 prior denials at the exact success cutoff.
- Search other accounts/time periods for anomalies; do not simply stop at the known sequence.
- Write reports/investigation.md: observed facts, potential mechanisms, counterevidence, unknowns, and evidence references. Distinguish dataset observations from organizer ground truth.

**Gate:** 180,800 parsed records, 0 rejected for this file; exact status counts and 10 users; reimport adds 0 rows; original leading-zero IP retained; no invented missing fields; reported evidence resolves to correct raw lines.

### M2 — build a complete deterministic vertical slice (about 3 hours)

- Implement run admission, serial detector transaction, persistent observed counters and cutoff-aware evidence access.
- Implement independent R1–R5 rules with configurable predicates from architecture.md.
- Materialize incident versions and typed fact packets; deterministic summaries first.
- Implement durable updates, basic incident detail/evidence UI and Slack preview outbox.
- Replay a small fixture end to end. Crash the worker on each side of a commit and resume.

**Gate:** normal/suspicious/high-risk fixtures produce inspectable decisions; known access-change facts link correctly; no ML/LLM is needed to see an incident; detector resumes without duplicate state or notifications. Label this stage rules-only.

### M3 — train and validate ML, then integrate it (about 3 hours)

- Generate feature vectors causally with the exact inference code and ordered schema.
- Bootstrap August; train September–December; calibrate January–February; reserve March evaluation.
- Build frozen familiar-login reference, smoothing rules and explicit missing/cold-start flags.
- Fit one Isolation Forest; store model manifest/hash and calibration score distribution.
- Compare a simple statistical rarity baseline, rules-only, model-only and the hybrid.
- Select threshold from calibration examples and alert burden; freeze before evaluating March.
- Integrate independent ML/rule execution and mark missing/degraded model state.

**Gate:** train/inference feature parity; no future data in normalization/history; deterministic repeated run under pinned versions; no fabricated threat probabilities; model impact and limitations documented. A rejected model stays visibly in shadow mode; it does not silently override useful rules.

### M4 — complete causal replay and analyst UI (about 3 hours)

- Implement replay start/pause/resume/speed with virtual time and bounded admission queue.
- Warm pre-March history without producing Slack/LLM side effects. Do not show warmup events as model-evaluated live decisions.
- Keep every screen, metric, evidence query and tool scoped to the run's processed cutoff.
- Add incident timeline, baseline comparison, facts drawer, related episodes, delivery status and integration health.
- Implement durable SSE reconnect; virtualize/paginate the event list.
- Reset by creating a new run, with separate state and preview notifications.

**Gate:** pause drains only bounded admitted work; resume/restart works; future imported rows cannot appear in the current run; two runs cannot affect each other; no blank/fake dashboard states during failures.

### M5 — implement constrained AI investigation and playbooks (about 2–3 hours)

- Build deterministic fact packet and counterevidence selection before provider integration.
- Implement a single bounded read-only tool interface and provider adapter.
- Enforce the schema and code-specific hypothesis support predicates; publish templates from validated selections only.
- Include fallback, timeout, one repair limit, cache and stale-version rejection.
- Add reviewed remediation playbooks and analyst disposition with audit history.
- Include visible “AI suggested / observed fact / unknown” distinctions.

**Gate:** fabricated IDs, contradictory hypotheses, altered packet hashes, nonexistent playbooks, future facts and embedded prompt instructions cannot produce verified facts. Provider outage leaves core detections and deterministic summaries intact. A false-positive suggestion cannot lower severity or cancel an alert.

### M6 — prove sponsor integrations and delivery reliability (about 2–3 hours)

- Create Tiger continuous aggregate over processed_events; explicit replay-range refresh.
- Validate dashboard aggregate/raw equality and stale-data fallback; benchmark an actual query.
- Complete Sentry spans and structured Logs in detector and job workers; scrub sensitive content.
- Capture a genuine slow-query improvement or other observed issue and its fix. Label fault injection separately from real bugs.
- Implement outbox leases, retries, rate-limit handling and dead-letter/failed delivery UI.
- Test Slack locally with a stub; with configured authorization, send one clearly labeled message to the intended test channel.

**Gate:** two Sentry products beyond errors demonstrated; Tiger aggregate returns exact expected results; real measurements recorded; no external dependency blocks detector progress. If credentials are unavailable, adapters/stub tests may pass but report cloud integration as unverified, not complete.

### M7 — harden, evaluate and package (about 2–3 hours)

- Run full-dataset causal replay and the critical failure matrix below.
- Add varied synthetic scenarios and rename/shift known-sequence entities to expose hardcoding.
- Sample routine and flagged real windows for human review; document sampling method and uncertainty.
- Measure throughput/latency, alert burden, job queues and anomaly-score distribution.
- Prepare a repeatable demo reset/start command and three-minute script.
- Finish README, investigation/evaluation/performance reports, sponsor evidence and attribution.

**Gate:** all release criteria below are green or explicitly reported as external integration blockers. No silent missing requirement. Record exact tested commit, dataset hash, configuration/model hashes and commands.

## 5. Critical acceptance matrix

Write tests for these actual risks, not merely tests that repeat implementation details.

| ID | Scenario | Required assertion |
|---|---|---|
| D01 | Full source import | Counts/hash/time range match overview; raw references round-trip |
| D02 | Identical lines at different offsets | Distinct evidence IDs retained |
| D03 | Retry same client ID with different payload | Conflict; original cannot be overwritten |
| D04 | Malformed/oversize/leading-zero IP | Invalid rows explicitly rejected; supplied leading-zero IP survives |
| T01 | Append future rows before old event is scored | Its features, facts and verdict match a prefix-only run |
| T02 | Equal timestamp events | Stable run order; preceding ties included, following ties excluded |
| T03 | Late live event | Preserved as late, not green-classified or silently inserted into history |
| T04 | Two replays/resets | State, incidents, chart data and outbox isolated by run_id |
| T05 | Restart before/after commit | No double increment, skipped event, partial incident or duplicate outbox key |
| T06 | Poison processing record | Bounded retry then visible blocked run; no false all-clear |
| R01 | Familiar routine sensitive access | No high-risk verdict solely from filename/large bytes |
| R02 | Four unfamiliar-pair failures in 60 seconds | R1 suspicious with exact predicate evidence |
| R03 | First sensitive success after >=5 denials | R2 suspicious; default high-risk only with corroboration |
| R04 | Linked known March sequence | R5 escalates on line 168338; supporting legs reference valid earlier records |
| R05 | Later unfamiliar login + sensitive access | R4 links prior failures and later success without asserting session identity |
| R06 | Many users share common asset/IP subnet | No unrelated incident mega-merge |
| R07 | Rename accounts/IPs, shift dates/post IDs | Same generic patterns detected after coherent bootstrap regeneration |
| R08 | Legitimate approved change analogue | System preserves uncertainty and analyst feedback; no claimed proof of attack |
| M01 | Identical history to training/inference | Same ordered feature vector and score with pinned artifact |
| M02 | Account/IP repeated failures | Does not become familiar in frozen successful-login reference |
| M03 | Missing model or schema mismatch | Explicit degraded mode; rules still fire; scores null |
| M04 | New account/no bootstrap support | Unknown/cold-start flag; not automatic high-risk |
| E01 | Nonexistent/contradictory/future fact selection | Validation failure and deterministic fallback |
| E02 | Prompt injection in target/query | No tool scope escape or arbitrary SQL/action |
| E03 | AI returns after newer incident version | Cannot replace current explanation |
| E04 | AI says false positive despite high-risk facts | Cannot suppress or downgrade detector decision |
| Q01 | LLM timeout / Sentry outage | Detection and deterministic alert enqueue continue |
| Q02 | Slack 429/500/permanent 400/ambiguous timeout | Correct persisted retry/failure status; duplicate possibility acknowledged |
| Q03 | Side-effect worker dies with leased job | Lease reclaimed; database idempotency preserved |
| A01 | Continuous aggregate not refreshed | Raw fallback or visible freshness; detector unaffected |
| A02 | Pinned historical view after later processing | No future aggregate/chart leakage |
| U01 | SSE reconnect or expired cursor | Resume without lost state or snapshot resync |
| S01 | Evidence contains HTML/script-like text | Escaped display; no DOM execution |
| S02 | Unauthorized shared-deployment mutations | Rejected; secrets absent from browser/network logs |

If R04 does not fire, inspect the rule/data mismatch openly. Do not hardcode the expected line number into the engine to pass the test. Known-line assertions belong only in fixtures/evaluation.

## 6. Evaluation protocol

Report rule-only, model-only and hybrid under the same causal replay and dataset partitions. Show actual alert counts before/after grouping, alerts per recorded day, known incident time-to-first-warning/time-to-escalation, and ML-only examples worth investigating. Explain false positives and misses.

The March incident was already inspected to design hypotheses, so March is a chronological evaluation set but not a pristine blind holdout. State this. Synthetic name/date substitutions test generality of implementation, not real-world generalization. Add unrelated benign changes and additional patterns, and report synthetic and real results separately.

There is no organizer-labeled ground truth. Do not report global accuracy, ROC-AUC or “99% detection” on invented labels. Use analyst-reviewed precision on a documented sample with sample size and uncertain dispositions; known-incident recall applies only to the small provisional inventory. A useful unresolved bucket is better than forced labels. State whether AI informed a review; do not treat AI judgments as independent truth.

Provisional performance targets on the documented demo machine, to measure rather than assume: full 180,800-row import <5 minutes; sustained >=100 scored events/second in accelerated replay without enrichment; p95 admission-to-committed-verdict <1s at 10 events/second; high-risk notification enqueued in the verdict transaction; SSE state visible within 2s; enrichment job finishes or falls back within 30s. Measure event-time detection delay separately from processing latency. If a target fails, profile first and report measured capacity; correctness gates take priority.

Measure transaction/query counts and p95 feature-query time. Prefer bounded microbatches and better indexes over adding a cache/distributed queue. Optimize only an observed bottleneck and rerun parity tests. Never publish the targets as achieved metrics.

## 7. Commands the finished implementation must provide

Implement and document these commands or equivalent names behind Makefile tasks; they are a required interface, not currently existing executables:

```bash
make dev
make migrate
make import DATASET_PATH=/path/to/htn_challenge_logs_2026.txt
make train
make calibrate
make evaluate
make replay-demo
make test
make benchmark
make build
```

`make replay-demo` creates an isolated run, warms pre-March history, uses the pinned evaluated model and defaults to Slack preview. Provide a faster known-sequence demo start only through a verified causal warmup/checkpoint, not a manually preloaded future incident. Baseline checkpoints must include cursor/config/model references and produce identical output to full prefix processing before they may be used.

No network API keys required for parser/features/rules/tests or deterministic replay. Integration tests requiring credentials must be explicit and documented, never silently skipped while reporting complete coverage.

## 8. Scope control

If behind schedule, cut in order: animated graph, polished exports, ATT&CK labels, sandbox execution, advanced replay controls. Keep start/pause/resume, timeline/evidence, tested rules/ML, run isolation, deterministic fallback, basic constrained AI review, Slack durability, Tiger analytics and Sentry Tracing + Logs. Do not add a second model before these pass.

If the core still cannot fit the deadline, identify the exact incomplete milestone and deliver a truthful runnable subset. Do not disguise mock outputs as model inference or hosted integrations. No three-model ensemble, autonomous remediation or graph database is justified by the current data.

## 9. Completion and agent's final report

Deliver source and lockfiles, migrations, `.env.example`, startup commands, dataset inspection, causal train/calibration/evaluation tooling, model manifest, regression tests, required UI flows, sponsor integrations and failure handling. Preserve investigation artifacts and original evidence references.

The coding agent's final response must say: what works; commands tested; observed detection/performance results; model and dataset versions; real versus preview/unverified integrations; remaining blockers; and demo startup instructions. Link the three reports and identify any design change. Do not say “production-ready” or “hallucination-free.”

A complete implementation lets a reviewer ingest the supplied data, replay it twice, inspect why the March sequence escalates, trace every factual claim, witness an invalid AI proposal being rejected, restart the worker without corrupting history, and inspect an alert's delivery state—all without relying on hidden manual steps.
