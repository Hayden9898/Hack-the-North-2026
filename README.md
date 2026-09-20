# Log & Order

**From "what happened" to "what I did about it" — a behavioral security investigation console for HTTP access logs.**

Log & Order replays or ingests access-log events in causal order, decides which ones are suspicious *in context*,
groups them into incidents backed by provable facts, and takes the operator all the way through a reviewed,
verified, reversible response. Nothing is shown that the system cannot point back to a log line for.

> *"Normal" means no configured detector flagged the record. "High risk" means investigate urgently, not established
> guilt. Accounts and IPs identify recorded actors, not the humans behind them.*

## Why it's different

- **Explanations you can check.** An AI step may only *select* stored facts and propose qualified hypotheses. A
  validator checks every claim against the evidence before it reaches the UI; a fabricated claim is rejected and the
  deterministic explanation is shown instead. The product works fully with the AI provider switched off.
- **Rules and ML, neither trusted alone.** Six independent deterministic rules (R1–R6) fire even if the model misses.
  A frozen Isolation Forest, trained and calibrated causally on history-relative features, adds ML-only anomalies as
  *suspicious*. One policy combines them into normal / suspicious / high risk. No invented "96% malicious" scores.
- **Strictly causal, fully replayable.** Every event is scored using only what came before it. Runs are hashed
  (`config_hash`, dataset SHA-256, model id), so the same input reproduces the same decisions.
- **Detection that closes the loop.** Each applicable playbook step becomes a typed **containment action** whose
  parameters are bound *by code* from proven facts (never by the model). Operators dry-run, approve, execute, verify
  against the log, and roll back, with every phase in an append-only action log.
- **Boring, durable infrastructure.** One TimescaleDB. No Redis, no broker: the queues are Postgres tables with
  `SKIP LOCKED` leases.

## How it works

```
 access logs ──► ingest ──► causal features ──► rules R1–R6 ─┐
 (file / live)   (strict     (5-min, 1-hour,                  ├─► policy ──► incidents ──► facts + proofs
                  parser)     long-term history)  Isolation ──┘   (normal /   (versioned,     │
                                                  Forest           suspicious/  correlated)    ▼
                                                  (frozen)         high risk)          AI selects facts
                                                                                       validator checks
                                                                                              │
                     Slack outbox ◄── response packet ◄── verify ◄── execute ◄── dry run ◄── playbooks ◄┘
                     (durable)        (Markdown)          (vs log)   (approve)   (bound actions)
```

| Layer | Responsibility |
|---|---|
| `backend/app/ingest` | Strict, checkpointed, idempotent import and live ingestion with explicit rejects |
| `backend/app/features` | Causal, per-event, history-relative feature vectors |
| `backend/app/detection` | Rules R1–R6, frozen Isolation Forest, novelty, one classification policy |
| `backend/app/incidents` | Correlation, versioned incidents, typed facts and evidence proofs |
| `backend/app/investigation` | Playbooks, constrained AI pipeline, deterministic fallback, validator |
| `backend/app/actions` | Containment catalog, fact binding, dry run, verify, rollback, response packet |
| `backend/app/notifications` | Durable outbox with Slack preview and live adapters |
| `backend/app/observability` | Sentry errors, Tracing and Logs with privacy filtering |
| `frontend/` | React + TypeScript console over REST and SSE |

## Feature tour

### Incident investigation
The console uses AWS-inspired resource navigation, searchable source and execution tables, an event explorer with
resizable evidence drawers, versioned incident investigation and Cmd/Ctrl+K navigation. Each incident has a
versioned evidence brief; every measured condition opens the same proof drawer, and the brief exports locally as JSON
([contract](docs/case-brief.md)).

### Containment: dry run → execute → verify → roll back

Open a high-risk incident. **Containment actions** lists every action whose playbook applies, already bound:
`restore_acl` carries the exact `account` and `path` read from the `prior_denials_count` fact, `block_source` the
unfamiliar source, `revert_role_change` the admin endpoint. Each value shows the fact id it came from. Actions whose
preconditions fail are listed with the reason rather than hidden.

1. **Dry run** shows the exact request an approval would issue, the precondition checks and a verification preview.
2. **Approve & execute** re-checks preconditions and refuses if the facts moved (`binding_changed`), there was no dry
   run (`dry_run_required`), or it already ran (`already_executed`). In preview mode the incident is stamped
   `contained (preview)`, never "applied".
3. **Verify** recomputes the criterion (e.g. "no further 2xx on this path by this account") over everything processed
   past the approval point: `satisfied` / `contradicted` / `pending`, with the observed count.
4. **Roll back** reverses a reversible action; the containment stamp clears when none remain.

The **response packet** renders one Markdown handoff (facts with evidence refs, what the logs cannot show,
playbooks, bound actions, the action log) and pushes a link through the notification outbox. The run console shows
*contained / actionable* and median time to containment.

```bash
python -m scripts.contain_incident --run-id <run> [--action restore_acl [--execute] [--verify]] [--packet]
```

To make execution real, set `ACTION_MODE=live` and `ACTION_WEBHOOK_URL=<your remediation endpoint>`; the POST body is
the same object the dry run displays.

### Fault injection (labelled)
`python -m scripts.inject_invalid_claim --run-id <run>` submits a fabricated AI proposal for a real incident and
shows the validator rejecting it (`explanation.state = rejected`, deterministic fallback shown).

## Demo

The canonical dataset is 180,800 lines from Aug 2025 to Mar 2026. Replaying March surfaces three incidents:

| Incident | Detectors | Outcome |
|---|---|---|
| Unfamiliar-source failed-login episode | R1 → R4 | high risk |
| Admin role transition | R3 | flagged |
| Confidential ZIP access on line 168338 after 77 prior denials | R2 → R5 | high risk |

```bash
python tasks.py replay-demo     # isolated run, active model, Slack preview, warmed Aug–Feb, paused at Mar 1
```

Open the run in the UI, set a speed (e.g. 600×; 0 = fast-forward) and press **Resume**.

## Quick start

Requires Python 3.12, Node 20+ (tested with 24) and Docker Desktop. `make` is optional: every target also runs as
`python tasks.py <target>`.

```bash
cp .env.example .env                 # defaults work for the local demo; add keys only for real integrations
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # or: source .venv/bin/activate && pip install -r requirements.txt
cd frontend && npm install && cd ..
python tasks.py db-up                # TimescaleDB on localhost:5433 (dev + test databases)
python tasks.py migrate
python tasks.py import DATASET_PATH=./htn_challenge_logs_2026.txt   # 180,800 rows, ~25 s, idempotent
python tasks.py dev                  # API :8000, detector worker, side-effect worker, UI :5173
```

Open http://127.0.0.1:5173, create a run (or use `replay-demo`) and press **Start**.

### Train the model (optional but recommended)

```bash
python -m scripts.run_replay --name snapshots-full   # causal feature snapshots, Aug–Mar (~14 min); rules-only until a model is active
python tasks.py train                                # training-domain stage + forest on Sep–Dec, calibrates Jan–Feb
python -m ml.calibrate --model-id <id> --percentile 99.9 --activate   # review burden + samples, freeze threshold
python -m ml.evaluate --model-id <id>                # March: rules vs model vs hybrid vs baseline
```

`--no-preprocess` fits a plain forest; see [reports/preprocessing.md](reports/preprocessing.md).

### Dataset fidelity gate

`dataset.txt` in this checkout is a short transfer sample, not the canonical file. Its last line is an explicit
truncation marker and is correctly rejected by the strict parser; the 529 preceding lines parse. Use it for parser and
UI smoke checks only, never to train, calibrate, evaluate or quote detector results. The original file's expected
digest and counts are in `tests/integration/test_import.py`.

## Honest status: real, preview, or unverified

| Component | Status |
|---|---|
| Import, causal detector, rules, incidents, facts, evidence proofs, SSE, UI | **Real**, tested against the supplied file and synthetic scenarios |
| Isolation Forest (`ml/artifacts/if_v1_2026-09-19`) | **Real**, trained, calibrated and evaluated causally; active at the 99.9th percentile |
| TimescaleDB (local Docker, PG 17.11 / TimescaleDB 2.30.1) incl. continuous aggregate | **Real**, benchmarked |
| Containment actions (dry run → execute → verify → roll back, response packet) | **Real**: binding, sequencing refusals, action log, verification and packet tested end-to-end (11 e2e + 18 unit). Execution is **preview** by default; the `live` webhook adapter is **unverified** against a real endpoint |
| Railway deployment (`Dockerfile`, `railway*.json`) | Image and config real, verified end-to-end in containers; **no cloud project deployed yet** |
| Slack | **Preview** (rendered and stored, nothing sent); live adapter unit-tested with stubs, real webhook **unverified** |
| Sentry Tracing + Logs | SDKs, worker trace context and privacy filtering tested locally; real project receipt **unverified** without DSNs |
| AI review (Anthropic `claude-opus-5`, official SDK 1.7.0) | Adapter, validator and pipeline tested with a scripted provider; **deterministic-only** without `LLM_API_KEY`; real calls **unverified** |
| Tiger Cloud | **Unverified**: no connection string was available; only standard TimescaleDB features are used |

The current policy adds **R6**, a suspicious-only detector for six unfamiliar-source login failures over an hour that
never duplicates R1's fast-burst evidence. R4 can independently escalate either verified auth episode only after a
subsequent login and sensitive-resource access. Historical reports predate R6 and must be regenerated on the
original dataset before quoting alert burden or effectiveness.

## Commands

| `make` / `python tasks.py …` | What it does |
|---|---|
| `dev` | Start DB, migrate, run API + detector + side-effect worker + Vite dev server |
| `doctor` | Report prerequisites, API/UI readiness, missing dataset/model; no data mutations |
| `verify` | Frontend first, then protected serial backend tests; saves a human-readable report |
| `verify-frontend` / `verify-backend` | Run one acceptance gate |
| `verify-live RUN_ID=…` | Read-only canonical replay/evidence acceptance against the running app |
| `verify-report` | Serve only verification reports on loopback port 8765 |
| `migrate` | Apply Alembic migrations (dev and, if reachable, test DB) |
| `import DATASET_PATH=…` | Idempotent, checkpointed import with explicit rejects |
| `train` / `calibrate` / `evaluate` | ML lifecycle (`calibrate`/`evaluate` need `MODEL_ID=…`) |
| `replay-demo` | Isolated warmed demo run paused at the visible boundary |
| `test` | `pytest -m "not slow"`; add `ARGS="-m slow"` for the full-file import test |
| `benchmark` | Measured timings → `reports/performance_data.json` |
| `lint` / `typecheck` / `build` | ruff + oxlint / mypy + tsc / production frontend build |

Tests need the local database (`TEST_DATABASE_URL`) and fail loudly if it is missing rather than skipping. No network
credentials are required for any test; tests marked `external` (none run by default) would need real keys.

## Configuration

See `.env.example`. Detection thresholds, route categories, partitions, playbooks and actions live in `config/*.yaml`
and are hashed into every run. Secrets stay server-side; the UI never receives them. The API binds to loopback by
default. For a shared deployment set `APP_AUTH_SECRET` (operator bearer token), `INGEST_TOKEN` (live source), fixed
CORS origins and TLS in front; the API refuses non-loopback binds without them.

## Live ingestion

```http
POST /api/v1/runs                  {"mode": "live", "source_id": "src"}
POST /api/v1/runs/{id}/events      {"source_id": "src", "events": [{"event_id": "…", "line": "<access log line>"}]}
```

Up to 1,000 records / 2 MiB per request. Each item is reported as accepted, duplicate, conflict, rejected or late;
late records are stored but never scored.

## Deployment (Railway)

One `Dockerfile` builds the UI and Python services into a single image with three roles: `scripts.serve_api`
(FastAPI **and** the built console, same-origin), `scripts.serve_worker` (detector + side-effect loops) and one-off
CLIs. `railway.json` and `railway.worker.json` carry build, start command and healthcheck. The only external
dependency is one TimescaleDB (Tiger Cloud or `timescale/timescaledb-ha:pg17`). In a container the API binds
`0.0.0.0`, so `APP_AUTH_SECRET` and `INGEST_TOKEN` are mandatory. `ml/artifacts/` is gitignored, so a fresh deploy
runs rules-only until a trained artifact is force-added. Runbook: [docs/DEPLOY.md](docs/DEPLOY.md).

## Documentation

| Topic | Where |
|---|---|
| Specification | [`overview.md`](overview.md) → [`architecture.md`](architecture.md) → `plan(3).md` |
| Progress and decisions | [`PROGRESS.md`](PROGRESS.md) |
| Reproducible acceptance workflow | [docs/verification-guide.md](docs/verification-guide.md) |
| Adversarial regression gate and its scope | [docs/adversarial-evaluation.md](docs/adversarial-evaluation.md) |
| Investigation brief contract | [docs/case-brief.md](docs/case-brief.md) |
| Sentry setup and privacy boundary | [docs/sentry-observability.md](docs/sentry-observability.md) |
| Sponsor requirements and evidence | [docs/sponsor-fit.md](docs/sponsor-fit.md) |
| Frontend setup and browser tests | [frontend/README.md](frontend/README.md) |
| Frontend design research | [docs/design/frontend-direction.md](docs/design/frontend-direction.md) |
| Reports | `reports/investigation.md`, `evaluation.md`, `performance.md`, `sponsor-evidence.md` |

Existing installations must run migrations through `0006` before starting the updated API and detector.
