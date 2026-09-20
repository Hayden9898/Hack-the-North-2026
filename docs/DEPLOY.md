# Deploying Log & Order on Railway

Three processes, one image, one database — the same topology as the local demo (`architecture.md` §2):

| Railway service | Start command | What it is |
|---|---|---|
| `api` | `python -m scripts.migrate && python -m scripts.serve_api` | FastAPI **and** the built React console (same-origin, no CORS) |
| `worker` | `python -m scripts.wait_for_db && python -m scripts.serve_worker` | ordered detector + asynchronous side-effect worker (two threads, one process) |
| database | — | PostgreSQL **with the TimescaleDB extension** (see below) |

No Redis, no queue broker, no object storage: every queue (ordered inbox, notification outbox, explanation jobs)
is a Postgres table with `FOR UPDATE SKIP LOCKED` leases, and the ML model is CPU-only scikit-learn loaded from
the image. Adding Redis would buy nothing here.

## 1. The database must be TimescaleDB, not plain Postgres

Migration `0001` runs `CREATE EXTENSION timescaledb` and `create_hypertable(...)`; `0003` creates a continuous
aggregate. Railway's stock PostgreSQL plugin does **not** ship the extension, so pick one of:

* **Tiger Cloud** (recommended — it is the sponsor platform this integration targets): create a free service,
  copy the `postgresql://...?sslmode=require` connection string into `DATABASE_URL`. Nothing else changes; the
  code uses only standard TimescaleDB features.
* **A TimescaleDB service inside Railway**: *New -> Docker Image ->* `timescale/timescaledb-ha:pg17`, set
  `POSTGRES_PASSWORD` / `POSTGRES_USER` / `POSTGRES_DB`, attach a volume at `/home/postgres/pgdata`, and point
  `DATABASE_URL` at the service's private URL.

Either way, `GET /health/ready` reports the detected extension version in `database.detail`.

## 2. Create the two application services

Both services deploy **the same repo and the same `Dockerfile`**. The root `railway.json` calls a role launcher;
it selects the API by default, while `SERVICE_ROLE=worker` starts the worker role on the same image.

1. *New Project -> Deploy from GitHub repo* -> this repository. Name the service `api`.
   Settings -> *Config-as-code path*: `railway.json` (already holds the build, the start command and the
   `/health/live` healthcheck). Networking -> *Generate Domain*.
2. *New -> GitHub Repo* (same repo) again. Name it `worker`. Set `SERVICE_ROLE=worker`; do **not** give it a domain.

Keep `numReplicas = 1` on the worker. More replicas are safe (run ownership is a row lock) but pointless.

## 3. Variables

Set on **both** services (Railway shared variables are easiest):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Tiger Cloud / TimescaleDB URL (`?sslmode=require` for anything off the private network) |
| `APP_AUTH_SECRET` | a long random string — **required**: the container binds `0.0.0.0`, so the API refuses unauthenticated mutations |
| `INGEST_TOKEN` | a second random string; required before `POST /runs/{id}/events` accepts live records |
| `APP_BASE_URL` | `https://<api-domain>` — the only base used to build links inside alerts |
| `TEST_DATABASE_URL` | leave empty (tests never run in the deployment; `scripts.migrate` skips an unreachable test DB) |

Optional, same meaning as locally: `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, `LLM_API_KEY` (constrained AI
review; deterministic-only without it), `SLACK_MODE` / `SLACK_WEBHOOK_URL` (**leave `preview` unless you have
explicitly chosen a destination**), `MAX_RUN_NOTIFICATION_COUNT`.

`PORT` is injected by Railway and wins over `API_PORT`. `API_HOST`, `STATIC_DIR`, `MODEL_DIR`, `CONFIG_DIR` and
`UPLOAD_DIR` already have container defaults from the `Dockerfile`.

Generating secrets:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## 4. Seed the database (one-off, from your machine)

The 17 MB dataset is not in git. You can upload it from the console: the API stores a completed upload in the
database and the worker materialises a short-lived private copy while importing, so this works when API and worker
are separate Railway services. For a repeatable seeded deployment, import it over the network against the deployed
database using the **public** connection string (Tiger Cloud's, or Railway's TCP proxy URL from the database
service's *Connect* tab):

```bash
export DATABASE_URL='postgresql://...'           # PowerShell: $env:DATABASE_URL='...'
python -m scripts.migrate                        # no-op if the api service already migrated
python -m scripts.import_dataset --path ~/Downloads/htn_challenge_logs_2026.txt
```

The import is idempotent and checkpointed: re-running resumes rather than duplicating (~25 s locally, longer
over the internet). Then create a run from the console, or warm one headlessly:

```bash
python -m scripts.run_replay --name demo --pause-at-visible-start --speed 0 --no-drive
```

`--no-drive` leaves the processing to the deployed worker, so you can watch the console fill live.

### Upload handoff across two Railway services

`POST /api/v1/datasets` streams the request to a temporary API-local file only while it validates the size and
SHA-256. It then stores the completed payload in `dataset_uploads`; the side-effect worker reads that durable row,
writes a short-lived private file for the streaming importer, and deletes the file afterwards. Once an import is
ready, the database payload is removed too; failed imports retain it for diagnosis/retry. This avoids shared
container filesystems and does not require object storage. Do not use the public deployment for real logs without
read authentication.

## 5. The model artifact

`ml/artifacts/` is gitignored, so a GitHub deploy ships **without a model** and the API reports
`no_model_artifacts_rules_only` in `degraded_modes` — rules R1–R5 still run, unchanged. To deploy with the frozen
Isolation Forest, train locally (`README.md` -> *Model*) and force-add exactly the artifact you activated:

```bash
git add -f ml/artifacts/<model-id>          # manifest.json + model.joblib + calibration
git commit -m "Deploy: include <model-id> artifact"
```

The `models` row lives in the database (written by `ml.train` / `ml.calibrate` against `DATABASE_URL`), and the
artifact is verified on load by SHA-256: a mismatch degrades the run to rules-only instead of scoring silently.

## 6. Verify

```bash
curl -s https://<api-domain>/health/live
curl -s https://<api-domain>/health/ready | python -m json.tool
```

`status: ready` needs database + migrations + config. `degraded_modes` lists the integrations that are off.
Then open `https://<api-domain>/`, click **operator token required** in the header, paste `APP_AUTH_SECRET`
(kept in that tab's sessionStorage, sent only as an `Authorization` header), and create or resume a run.

Reads — incidents, evidence, raw log lines, the SSE feed — are **not** authenticated, matching the local console.
The deployed dataset is synthetic; do not point a public deployment at real logs without adding read auth.

## 7. Operating notes

* **Logs**: `railway logs -s api` / `-s worker`. The worker prints `worker starting roles=['detector', 'side_effects']`.
* **Migrations** run at `api` start-up. A failed migration fails the deploy and Railway keeps the previous version.
* **SSE** (`/runs/{id}/updates`) works through Railway's proxy; the UI falls back to polling if a proxy buffers it.
* **Scaling**: split the worker with `WORKER_ROLES=detector` and `WORKER_ROLES=side_effects` on two services.
* **Cost/sleep**: `sleepApplication` is false on both — a sleeping worker would stall an in-flight replay.
* **Shutdown**: SIGTERM stops both loops after the current microbatch; an interrupted batch is rolled back whole
  and retried by the next container (`replay.max_attempts`, then a visibly blocked run).

## Local parity

The same image runs the whole stack on your machine, which is the fastest way to reproduce a deployment problem:

```bash
docker compose --profile app up --build       # db + api (console on :8000) + worker, from the deploy image
```

The profile is opt-in, so `python tasks.py db-up` and the normal dev loop are unaffected. It uses
`APP_AUTH_SECRET=local-operator-secret` unless you set one, which is also what the console asks for. To run a
single role against a cloud database instead:

```bash
docker build -t logorder .
docker run --rm -p 8000:8000 --env-file .env -e APP_AUTH_SECRET=dev-secret logorder
docker run --rm --env-file .env logorder python -m scripts.serve_worker
```

(`--env-file .env` needs a `DATABASE_URL` the container can reach: the Tiger Cloud URL, or
`host.docker.internal:5433` for the Compose TimescaleDB.)
