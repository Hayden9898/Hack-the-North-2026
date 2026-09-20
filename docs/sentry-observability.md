# Sentry: monitoring the application, not the evidence

The developer MCP/CLI connection is separate from app instrumentation. OAuth does not give the application a project DSN.
No project has been selected for this repository; external receipt remains unverified until the steps below are completed.

## Instrumentation

| Surface | What is measured |
| --- | --- |
| React console | Uncaught/caught React errors, route errors, navigation performance, same-origin API trace propagation |
| FastAPI | Request traces and application exceptions |
| Detector | Batch, causal feature queries, model scoring, independent rules, correlation; blocked-run and degraded-model logs |
| AI review worker | Provider timing, validation, rejected proposals and timeout categories; stored trace context connects jobs |
| Notification worker | Delivery attempts, duration and failed-delivery logs; no webhook or message body |
| Import / analytics | Persist timing, parse-rejection categories, aggregate refresh and staleness |

The SDK is disabled when its DSN is absent. A failed initialization does not stop the detector or console. Tracing defaults
to 10%; errors and explicit structured logs are not gated by that trace sample rate. Use 100% briefly for demonstration,
then choose an appropriate volume budget. Metrics describe software behavior—not confidence that an investigated event is malicious.

## Privacy boundary

Allowlisted metadata: operation names, durations, safe counts, exception type and stack location, opaque execution/incident IDs.
Request bodies/headers, SQL text, request URLs/query strings, account names, IPs in evidence, raw log lines, exception messages,
locals, provider outputs and AI prompts are discarded. Rejection `reason` text is replaced with `details_redacted`.
Automatic SDK integrations are restricted; no console/DOM breadcrumbs, session replay, attachments or automatic AI payload capture.
This intentionally trades detailed exception messages for evidence confidentiality. Preserve detailed investigation data in the app.

The real SDK is exercised with a memory transport in `tests/unit/test_observability.py`. The browser test uses a dummy loopback
DSN and asserts receipt of events/traces/logs, distributed headers and absence of sensitive sentinels. These are local transport tests,
not claims of external delivery. Review this boundary whenever upgrading SDKs or adding telemetry.

## Activate a chosen project

1. Choose/authorize the Sentry organization and projects. Recommended separation: `log-and-order-api` (Python/FastAPI; shared by API
   and workers) and `log-and-order-web` (React). Keep environment/release names aligned. Configure project access, retention and quotas.
2. In ignored root `.env`: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` (commit SHA), `SENTRY_TRACES_SAMPLE_RATE`.
3. In ignored `frontend/.env.local`: public `VITE_SENTRY_DSN`, matching `VITE_SENTRY_ENVIRONMENT` / `VITE_SENTRY_RELEASE`,
   `VITE_SENTRY_TRACES_SAMPLE_RATE`. Restart/rebuild the frontend and restart API **and both workers**.
4. Never put a Sentry authentication token, Slack webhook, provider key or operator secret in a `VITE_*` variable. A project DSN
   is a public ingestion identifier; use Sentry project controls to manage unwanted ingestion.
5. Open Integrations → Application observability. API and browser SDK statuses are separate. “Initialized” is not “delivery verified.”
6. Click **Send Sentry diagnostic**. This operator-authorized POST queues a synthetic API message, trace and structured log;
   the browser queues its own synthetic message/log. It never touches incidents or invokes providers. Save the returned event IDs.
7. In Sentry, locate the exact IDs in their projects. Find `observability.check` and `observability_check`; inspect trace/log correlation
   and scrubbed payloads. Record project, environment, release, event IDs and time in a private acceptance record. A queued ID alone is insufficient.
8. Run a disposable replay and inspect `detector.batch` → `features`, `model.score`, `rules.evaluate`, `correlate`. Trigger the
   existing **labelled** invalid-proposal demo and find `claim_rejected`. Slack failure and blocked-run demonstrations must use
   explicitly controlled test scenarios—do not break a real integration just to manufacture prize evidence.

The configured MCP uses the official hosted server; reopen the coding-client session if tools are not yet present. CLI/MCP project
read access helps inspect receipt but does not authorize creating a project in an unrelated organization. Project creation needs write scope.

## Production release gate

Upload browser source maps privately using Sentry's release/source-map tooling and a CI-only auth token; keep the release SHA aligned.
This repository does not yet configure that upload or publish source maps. Until then browser stacks retain built asset/line locations
but are not source-mapped. Verify proxy/CORS support for `sentry-trace` and `baggage`, inspect actual end-to-end trace correlation,
and configure alerts for application errors, blocked runs, rejected claims and failed notifications in the selected Sentry project.
Project alerts, external delivery and source-map upload cannot be marked complete without the target project/deployment.

References: [Sentry React](https://docs.sentry.io/platforms/javascript/guides/react/),
[Python structured logs](https://docs.sentry.io/platforms/python/logs/),
[FastAPI integration](https://docs.sentry.io/platforms/python/integrations/fastapi/).
