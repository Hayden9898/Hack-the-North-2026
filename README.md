# Log & Order

A behavioral security investigation console for HTTP access logs. It replays or ingests events in causal order,
computes history-relative features, runs independent deterministic rules (R1–R5) and a frozen Isolation Forest,
groups matches into versioned incidents with typed, provable facts, previews Slack alerts through a durable outbox,
and lets a constrained AI step *select* facts and qualified hypotheses that a validator checks before anything is shown.

Specification: `overview.md` → `architecture.md` → `plan(3).md`. Progress and decisions: `PROGRESS.md`.
Reports: `reports/investigation.md`, `reports/evaluation.md`, `reports/performance.md`, `reports/sponsor-evidence.md`.

## What is real, preview, or unverified

| Component | Status |
|---|---|
| Import, causal detector, rules, incidents, facts, evidence proofs, SSE, UI | real, tested against the supplied file and synthetic scenarios |
| Isolation Forest (`ml/artifacts/if_v1_2026-09-19`) | real, trained/calibrated/evaluated causally; active at the 99.9th percentile |
| TimescaleDB (local Docker, PG 17.11 / TimescaleDB 2.30.1) incl. continuous aggregate | real, benchmarked |
| Tiger Cloud | **unverified** — no connection string was available; the code uses only standard TimescaleDB features |
| Slack | **preview mode** (messages rendered + stored, nothing sent). Live adapter + retry semantics unit-tested with stubs; real webhook **unverified** |
| Sentry Tracing + Logs | wired (spans, structured events, trace context on jobs) and reported as disabled when `SENTRY_DSN` is empty; real project **unverified** |
| AI review (Anthropic `claude-opus-5` via the official SDK 1.7.0) | adapter + validator + pipeline tested with a scripted provider; **deterministic-only mode** without `LLM_API_KEY`; real calls **unverified** |

## Requirements

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

### Model (optional but recommended)

```bash
python -m scripts.run_replay --name rules-only-full          # causal feature snapshots for Aug–Mar (~14 min)
python tasks.py train                                        # fits Sep–Dec, calibrates Jan–Feb, writes ml/artifacts/<id>/
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
