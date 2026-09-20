# Log & Order

A behavioral security investigation console for HTTP access logs. It replays or ingests events in causal order,
computes history-relative features, runs independent deterministic rules (R1–R6) and a frozen Isolation Forest,
groups matches into versioned incidents with typed, provable facts, previews Slack alerts through a durable outbox,
and lets a constrained AI step *select* facts and qualified hypotheses that a validator checks before anything is shown.

Specification: `overview.md` → `architecture.md` → `plan(3).md`. Progress and decisions: `PROGRESS.md`.
Reports: `reports/investigation.md`, `reports/evaluation.md`, `reports/performance.md`, `reports/sponsor-evidence.md`.
The dedicated synthetic adversarial regression gate and its honest scope are in
[`docs/adversarial-evaluation.md`](docs/adversarial-evaluation.md).

## What is real, preview, or unverified

| Component | Status |
|---|---|
| Import, causal detector, rules, incidents, facts, evidence proofs, SSE, UI | real, tested against the supplied file and synthetic scenarios |
| Isolation Forest (`ml/artifacts/if_v1_2026-09-19`) | real, trained/calibrated/evaluated causally; active at the 99.9th percentile |
| TimescaleDB (local Docker, PG 17.11 / TimescaleDB 2.30.1) incl. continuous aggregate | real, benchmarked |
| Tiger Cloud | **unverified** — no connection string was available; the code uses only standard TimescaleDB features |
| Slack | **preview mode** (messages rendered + stored, nothing sent). Live adapter + retry semantics unit-tested with stubs; real webhook **unverified** |
| Sentry errors, Tracing + Logs | Python/React SDKs, worker trace context, privacy filtering and diagnostic implemented/tested locally; real project receipt **unverified** without DSNs |
| AI review (Anthropic `claude-opus-5` via the official SDK 1.7.0) | adapter + validator + pipeline tested with a scripted provider; **deterministic-only mode** without `LLM_API_KEY`; real calls **unverified** |

## Requirements

For the current reproducible acceptance workflow, see [the operator verification guide](docs/verification-guide.md).
Historical results below require the original dataset/model; they are not fresh evidence of this checkout's local environment.
Application Sentry setup and its evidence/privacy boundary are documented in [Sentry observability](docs/sentry-observability.md).
Sponsor requirements and remaining demo evidence are mapped in [sponsor fit](docs/sponsor-fit.md).

### Dataset fidelity gate

`dataset.txt` in this checkout is a short transfer sample, not the canonical 180,800-line challenge file. Its final
line is an explicit truncation marker and is correctly rejected by the strict parser; the preceding 529 log lines parse.
It is useful for parser and UI smoke checks only. Do not train, calibrate, evaluate, or quote detector results from it.
Use the original file (its expected digest/counts are in `tests/integration/test_import.py`) for canonical import and
replay acceptance.

The current policy adds R6, a suspicious-only detector for six unfamiliar-source login failures over an hour that
never duplicates R1's fast-burst evidence. R4 can independently escalate either verified auth episode only after a
subsequent login and sensitive-resource access. Historical reports predate R6 and must be regenerated on the original
dataset before quoting its alert burden or effectiveness.

Python 3.12, Node 20+ (tested with 24), Docker Desktop. `make` is optional: every target also runs as `python tasks.py <target>`.

## Quick start

```bash
cp .env.example .env                 # defaults work for the local demo; add keys only if you want real integrations
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt   # or: source .venv/bin/activate && pip install -r requirements.txt
cd frontend && npm install && cd ..
python tasks.py db-up                # TimescaleDB on localhost:5433 (dev + test databases)
python tasks.py migrate
python tasks.py import DATASET_PATH=./htn_challenge_logs_2026.txt   # 180,800 rows, ~25 s, idempotent
python tasks.py dev                  # API :8000, detector worker, side-effect worker, UI :5173
```

Then open http://127.0.0.1:5173, create a run (or use `python tasks.py replay-demo`, below), press **Start**.

### Frontend console

The console uses AWS-inspired resource navigation, searchable source/execution tables, an event explorer with
resizable evidence drawers, versioned incident investigation and Cmd/Ctrl+K navigation. Motion provides restrained
transitions; all operational data comes from the real API. Frontend setup, browser tests and the shared-hosting
authentication/SSE requirements are documented in [frontend/README.md](frontend/README.md).
The research inventory is in [docs/design/frontend-direction.md](docs/design/frontend-direction.md).
Incident overviews now include a versioned investigation brief with direct proof links and a local JSON export.
See [the brief contract and migration notes](docs/case-brief.md); existing installations must run migrations through
`0004` before starting the updated API and detector.

### Model (optional but recommended)

```bash
python -m scripts.run_replay --name rules-only-full          # causal feature snapshots for Aug–Mar (~14 min)
python tasks.py train                                        # training-domain stage + forest on Sep–Dec, calibrates Jan–Feb, writes ml/artifacts/<id>/
                                                             # (--no-preprocess fits a plain forest; see reports/preprocessing.md)
python -m ml.calibrate --model-id <id> --percentile 99.9 --activate   # review burden + samples, freeze threshold
python -m ml.evaluate --model-id <id>                        # March: rules vs model vs hybrid vs baseline
```

### Demo run

```bash
python tasks.py replay-demo          # isolated run, active model, Slack preview, warmed Aug–Feb, paused at Mar 1
```

Open the run in the UI, set a speed (e.g. 600×; 0 = fast-forward) and press Resume. Expect three incidents in March:
the unfamiliar-source failed-login episode (R1 → R4 high risk), the admin transition (R3), and the access change on
line 168338 (R2 → R5 high risk).

Fault injection (labelled): `python -m scripts.inject_invalid_claim --run-id <run>` submits a fabricated AI proposal
for a real incident and shows the validator rejecting it (`explanation.state = rejected`, deterministic fallback shown).

## Commands

| make target / `python tasks.py …` | What it does |
|---|---|
| `dev` | start DB, migrate, run API + detector + side-effect worker + Vite dev server |
| `doctor` | report prerequisites, API/UI readiness, missing dataset/model; no data mutations |
| `verify` | frontend first, then protected serial backend tests; saves a human-readable report |
| `verify-frontend` / `verify-backend` | run one acceptance gate |
| `verify-live RUN_ID=…` | read-only canonical replay/evidence acceptance against the running app |
| `verify-report` | serve only verification reports on loopback port 8765 |
| `migrate` | apply Alembic migrations (dev and, if reachable, test DB) |
| `import DATASET_PATH=…` | idempotent, checkpointed import with explicit rejects |
| `train` / `calibrate` / `evaluate` | ML lifecycle (see above; `calibrate`/`evaluate` need `MODEL_ID=…`) |
| `replay-demo` | isolated warmed demo run paused at the visible boundary |
| `test` | `pytest -m "not slow"`; add `ARGS="-m slow"` for the full-file import test |
| `benchmark` | measured timings → `reports/performance_data.json` |
| `lint` / `typecheck` / `build` | ruff + oxlint / mypy + tsc / production frontend build |

Tests need the local database (`TEST_DATABASE_URL`); they fail loudly if it is missing rather than skipping.
No network credentials are required for any test. Tests marked `external` (none run by default) would need real keys.

## Configuration

See `.env.example`. Detection thresholds, route categories, partitions and playbooks live in `config/*.yaml` and are
hashed into every run (`config_hash`). Secrets stay server-side; the UI never receives them. The API binds to
loopback by default; for a shared deployment set `APP_AUTH_SECRET` (operator bearer token), `INGEST_TOKEN`
(live source), fixed CORS origins and TLS in front — the API refuses non-loopback binds without them.

## Live ingestion

`POST /api/v1/runs` with `{"mode":"live","source_id":"src"}` then `POST /api/v1/runs/{id}/events` with
`{"source_id":"src","events":[{"event_id":"…","line":"<access log line>"}]}` (≤1,000 records, ≤2 MiB). Each item is
reported as accepted / duplicate / conflict / rejected / late; late records are stored but never scored.

## Layout

`backend/app/{api,ingest,db,features,detection,incidents,investigation,notifications,observability,workers}`,
`frontend/src`, `config/`, `ml/`, `tests/{unit,integration,e2e,fixtures}`, `scripts/`, `reports/`.
