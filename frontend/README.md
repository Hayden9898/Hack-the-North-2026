# Log & Order console

The React console is the operator surface for importing Apache access logs, starting isolated replays, inspecting
causal detections, and opening version-pinned incident evidence. It talks only to the same-origin FastAPI API.

## Run locally

```sh
npm ci
npm run dev
```

The development server runs at `http://127.0.0.1:5173` and proxies `/api` and `/health` to the local API. Start the
backend and workers separately with `python3 tasks.py dev` from the repository root if the local database is available.

The first screen supports streamed `.log`/`.txt` upload (the server default is 200 MiB). Import is asynchronous: a
dataset becomes selectable for a replay only after the worker reports it ready. Rejected-line samples remain visible;
the console never silently treats a partial import as clean.

## Quality gates

```sh
npm run typecheck
npm run lint
npm run build
npm run test:e2e
npm run test:monitoring
```

The browser tests run against the production preview build with mocked same-origin API responses. They verify multipart
upload framing and the visible queued-import state. The monitoring test uses a dummy loopback Sentry DSN and intercepts
the envelope; it verifies that the explicit synthetic diagnostic is emitted without sending anything externally.

For the complete reproducible gate, run `python3 tasks.py verify-frontend` at the repository root. It stores a
human-readable report in ignored `reports/verification/` and rejects skipped, flaky, or failed browser tests.

## Sentry and privacy

Browser monitoring is disabled until `frontend/.env.local` provides `VITE_SENTRY_DSN`. Optional environment/release and
sample-rate variables are listed in `.env.example`. The UI's **Send Sentry diagnostic** control sends only a synthetic
browser event and invokes the operator-only API diagnostic; it displays queued IDs but never claims external delivery.
Confirm event receipt in the chosen Sentry project.

Browser telemetry is scrubbed before delivery: log lines, account names, IPs, request URLs/bodies, exception messages,
breadcrumbs, and arbitrary context are not exported. Do not put secret tokens or Slack/LLM credentials in `VITE_*`
variables; a public Sentry DSN is an ingestion identifier, not an authentication secret.

## Deployment boundary

The console assumes same-origin API routing. In a shared deployment, configure server-side authentication, fixed CORS
origins, TLS, durable storage, and proxy support for `sentry-trace`/`baggage` before exposing the app. The browser does
not implement a login or store an operator token.
