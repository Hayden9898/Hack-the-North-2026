# Sponsor integration evidence

Honest status per integration. "Verified" means exercised against the real service in this repository's history;
"unverified" means the code exists and is tested locally with stubs, but no credentials were available to confirm it.

## Tiger Data / TimescaleDB — real (local), cloud unverified

- Local development target: `timescale/timescaledb:latest-pg17` pinned by digest (PostgreSQL 17.11, TimescaleDB
  2.30.1). Two hypertables (`raw_events`, `processed_events`, monthly chunks) and one continuous aggregate
  (`processed_events_5m`, `materialized_only = true`, explicit `refresh_continuous_aggregate` over the run's range,
  watermark stored in `aggregate_refreshes`).
- Meaningful use: the dashboard time series reads complete materialized buckets plus a non-overlapping raw tail and
  reports freshness; pinned as-of views deliberately bypass the aggregate. Measured on the 180,800-event run:
  raw 716 ms → aggregate 402 ms for all 5-minute buckets, 72 ms → 37 ms for daily totals, identical results
  (`reports/performance.md`, endpoint `GET /api/v1/runs/{id}/analytics/benchmark`).
- Tiger Cloud: **unverified**. No connection string was supplied. Only standard TimescaleDB SQL is used; `DATABASE_URL`
  with `sslmode=require` is the intended switch. Smoke test against the cloud service has not been run.

## Sentry Tracing + Logs — wired, project unverified

- SDK `sentry-sdk[fastapi]` 2.69.2, initialised per process (`api`, `detector`, `side-effects`, CLIs) with
  `traces_sample_rate` from config and Logs enabled (`enable_logs=True`). Disabled visibly when `SENTRY_DSN`
  is empty (`/health/ready` → `integrations.sentry = disabled_no_dsn`).
- Spans: `ingest.import`, `ingest.persist`, `detector.batch`, `features`, `model.score`, `rules.evaluate`, `correlate`,
  `notify.deliver`, `explanation`, `explanation.call`, `explanation.validate`, `analytics.refresh`. Trace context is
  stored on outbox rows and explanation jobs and continued in the side-effect worker.
- Structured log events: `parse_rejected`, `event_late`, `run_blocked`, `model_degraded`, `claim_rejected`,
  `explanation_timeout`, `notification_failed`, `aggregate_stale`, `run_phase_visible`. Correlation keys are opaque
  run/incident ids; usernames, raw URLs, webhook URLs and prompts are not attached; request bodies/cookies/auth headers
  are scrubbed in `before_send`.
- The slow events page query (79.7 ms → 2.9 ms) was found through UI review, **not Sentry**; with a DSN the same span
  (`GET /api/v1/runs/{id}/events`) would make comparable behavior observable. Labelled fault injection for the demo:
  `python -m scripts.inject_invalid_claim --run-id <run>` emits `claim_rejected` for each validator reason.
- **Unverified**: no DSN was available, so no trace or log has actually been sent to Sentry. Installing the SDK is not
  claimed as completion.

## Slack — preview mode real, live delivery unverified

- Durable outbox inside the detector transaction; high-risk first escalation bypasses the 5-minute debounce;
  suspicious digests are debounced and flushed at replay completion; same-severity repeats send nothing new.
- Delivery worker: `FOR UPDATE SKIP LOCKED` leases, jittered exponential retry (base 2 s, cap 60 s, 5 attempts),
  `429 Retry-After` honoured beyond the cap, permanent 4xx → `failed`, timeouts → `delivery_ambiguous` (duplicate
  possible), one sender per destination at ≤ 1 msg/s, per-run cap `MAX_RUN_NOTIFICATION_COUNT`, replay runs are
  preview-only unless a run is explicitly opted in (`config.allow_live_notifications`).
- Tests: `tests/integration/test_side_effects.py` (9) with a stub adapter and `httpx.MockTransport` for the HTTP
  classification.
- **Unverified**: no webhook URL was supplied; no message has left the application.

## Anthropic (AI review) — adapter real, calls unverified

- Official `anthropic` SDK 1.7.0, model `claude-opus-5`, strict client tools, structured `submit_selections` tool,
  bounded loop (≤ 6 tool calls, ≤ 200 rows, 15 s attempt deadline, one repair, 30 s job budget), cache by packet hash.
- **Unverified**: no `LLM_API_KEY`; every pipeline test uses a scripted provider. The system runs in
  deterministic-only mode without it and says so in the UI.

## How to turn each on

Set the variable in `.env`, restart `python tasks.py dev`: `DATABASE_URL` (Tiger Cloud), `SENTRY_DSN`,
`SLACK_MODE=live` + `SLACK_WEBHOOK_URL` (then opt a specific run in), `LLM_API_KEY`. Each is reported in
`/health/ready` and in the run header.
