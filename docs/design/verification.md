# Frontend verification — September 19, 2026

## Current checkout — September 20, 2026

- `python3 tasks.py verify-frontend` passed: TypeScript, Oxlint, production build, one Chromium multipart-upload
  workflow and one Chromium Sentry diagnostic/local-transport workflow. No test was skipped, retried, or flaky. Report:
  `reports/verification/20260920T034601.365603Z-frontend/index.html`.
- The upload workflow asserts the browser preserves the multipart boundary and renders the queued import state. The
  monitoring workflow uses a loopback DSN, intercepts the envelope, and asserts the synthetic diagnostic is emitted
  without a raw-log field. No external Sentry event is sent.
- This is deliberately narrower than the historical UI records below. Treat those records as history, not evidence that
  the corresponding browser suites are present in this checkout. Broader frontend interaction coverage is a remaining
  release task.

## Latest follow-up: investigation brief and evidence-version isolation

- `python3 tasks.py verify-frontend`: types/lint/build, **25 UI checks + 1 real SDK transport/privacy check**, all passed,
  zero skipped, flaky or retried tests. Report: `reports/verification/20260920T013932.252622Z-frontend/index.html`.
- `python3 tasks.py verify-backend`: lint/types, **61 non-DB + 40 database tests**, all passed. Report:
  `reports/verification/20260920T013836.953603Z-backend/index.html`. Isolated RAM-backed TimescaleDB, no external providers.
- New coverage includes version-pinned JSON download, exact proof navigation/focus restoration, mobile/reduced-motion
  layout, untrusted text, missing/truncated evidence, same-event R2/R5 isolation, later R4 matches, reverse relationships,
  versioned reviews, and migration 0004's legacy-link backfill. The mobile accessibility check caught and fixed the
  global-search button's missing accessible name when visible text is hidden.
- Desktop/mobile investigation screenshots were visually inspected. The overview now contains the brief, timeline and
  baseline; AI/analyst actions are in Review & response. Exports omit final event classifications that combine later
  same-sequence rules. `git diff --check` passed.
- See [the case-brief contract](../case-brief.md) and [the commit-pinned product comparison](../competitive-review.md).
  Canonical replay, real Sentry receipt, persistent DB and deployment limitations below remain unchanged.

## Previous follow-up: frontend, observability and operator acceptance

- Combined `python3 tasks.py verify` passed: TypeScript, lint, production build, **22 browser workflow/accessibility/layout
  tests + 1 real Sentry SDK transport/privacy test**, Python lint/types, **61 non-database + 39 database tests**.
- Backend tests used an isolated TimescaleDB on loopback port 5434, with disposable RAM-backed storage. The normal Docker
  disk is full; no existing containers, volumes or caches were pruned. The temporary test DB is removed after verification.
- Combined report: `reports/verification/20260920T012451.034686Z-full/index.html`.
- The final startup-loading fix was additionally reverified with all 23 browser checks:
  `reports/verification/20260920T012745.576121Z-frontend/index.html`.
- `npm audit --omit=dev`: zero reported vulnerabilities. Python dependency compatibility and `git diff --check` passed.
- Desktop/mobile welcome screens were visually inspected; clipping was corrected. Automated coverage includes 320px.
- Human HTML/JSON reports, failure artifacts, serial DB protection, separate read-only canonical replay acceptance,
  and GitHub Actions configuration are implemented. CI itself has not been run remotely.

The welcome page is `/welcome`; `/` remains the AWS-inspired working console. The real Python/React SDKs emit errors,
traces and structured logs when configured. Local tests capture genuine SDK envelopes without external transmission.
No Sentry project/DSN has been selected, so **external Sentry receipt is still unverified**. Session Replay is not installed.

`doctor` correctly reports the unavailable persistent DB/API. `verify-live` correctly refuses to pass without a selected
completed real replay. The original dataset and frozen model artifacts are absent from this checkout. Production hosting,
authentication, private source-map upload, provider credentials and live-source performance remain separate release gates.

Use [the operator guide](../verification-guide.md), [Sentry acceptance](../sentry-observability.md), and
[sponsor evidence mapping](../sponsor-fit.md). Passing local tests is not a guarantee of defect-free production software.

## Initial frontend pass (historical record)

The following records the earlier UI-only pass, before the follow-up above.

## Passed locally

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run test:e2e`: 11 Chromium tests passed.
- `npm audit --omit=dev`: zero reported vulnerabilities.
- `git diff --check`

The production build uses lazy resource routes and locally served fonts. The largest JavaScript chunk is approximately 414 kB / 132 kB gzip; this is a chunk measurement, not a total page transfer or performance benchmark.

## Browser coverage

Tests use isolated synthetic API fixtures, not a running backend. The fixtures are confined to `frontend/e2e/` and do not appear in the application bundle.

1. Overview renders measured execution data and links to real resource routes.
2. Event filters, historical cursor pagination, URL restoration, drawer close and focus restoration.
3. Cmd/Ctrl+K navigation and execution creation with the expected API payload.
4. Multipart source upload and source-detail navigation.
5. Resume/pause control and replay-speed configuration; mutation responses without aggregates preserve the last measured counters.
6. Incident facts, recomputed evidence proofs and historical versions; historical views cannot submit a disposition against the current version.
7. Empty-workspace onboarding.
8. HTTP 503 state without fabricated metrics or a healthy connection indicator.
9. Mobile navigation at 390px, horizontally contained tables and reduced motion.
10. Append-only analyst disposition submission and refreshed review history.
11. Automated WCAG A/AA axe checks on resource pages, command palette and evidence drawer; keyboard drawer resizing.

Overview, evidence drawer, incident facts and mobile screenshots were visually inspected. Reproducible screenshots are generated in `frontend/e2e/screenshots/` (git-ignored). The stable drawer state is captured after its entrance transition completes. Low-contrast status colors and an incident-version URL update issue found during testing were corrected.

## Not verified / release gates

- Live API/database integration, realistic large-file upload, actual detector execution, real model artifacts and end-to-end side effects. No local backend/database was running during this pass.
- Target-host behavior, TLS, access control, authenticated gateway, static-route rewrites, durable storage and SSE forwarding. Manus deployment is not configured.
- Browser error collection or live backend Sentry reporting. Developer MCP/CLI OAuth is connected, but no target application project has been chosen. No user evidence was sent to Sentry.
- Full manual screen-reader audit, additional browser engines, realistic load/performance budgets and deployment security review. Automated accessibility checks are not certification.

See [frontend/README.md](../../frontend/README.md) for the hosting and authentication contract. The existing backend requires a server-side operator bearer token on shared-deployment mutations; it does not supply a browser login/session system.
