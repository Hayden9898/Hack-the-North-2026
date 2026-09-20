# Log & Order console

AWS-inspired resource navigation and evidence-first investigation UI. The design inventory and references are in [frontend-direction.md](../docs/design/frontend-direction.md).

## Run locally

```sh
cd frontend
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Start the actual API, database and workers using the root [README](../README.md). The browser requests same-origin `/api/v1/*` and `/health/*`; Vite proxies them to `http://127.0.0.1:8000`. For a different development API, copy `.env.example` to `.env.local` and set `API_PROXY_TARGET`. That value is server-only, not a browser variable.

Without an API, the application shows a connection error. It never substitutes demo records. To inspect representative populated screens without a backend, run the isolated browser tests; their screenshots are written to `e2e/screenshots/`.

## Interface

| Route | Purpose |
| --- | --- |
| `/` | Execution-scoped overview, activity and incidents |
| `/welcome` | Monochrome product introduction with a draggable, keyboard-operable badge |
| `/sources`, `/sources/:id` | Upload HTTP logs, inspect import status and related executions |
| `/runs`, `/runs/:id` | Create, start, pause, resume and configure executions |
| `/events`, `/findings` | Account/risk/phase filters, cursor pagination and raw-evidence drawer |
| `/incidents`, `/runs/:id/incidents/:id` | Versioned investigation, provable facts and analyst review |
| `/runs/:id/events/:seq` | Deep-linked event detail |
| `/analytics` | Measured time series, source/fallback details and benchmark inspection |
| `/detection`, `/integrations`, `/settings` | Read-only configuration, integration modes and readiness |

Filters, selected execution, tabs, historical versions and evidence drawers use URL state. Cmd/Ctrl+K opens grouped navigation and contextual commands. Drawers support Escape, focus restoration, pointer resizing and arrow-key resizing. Animation follows the system reduced-motion preference. Timestamps are UTC.

## Code organization

- `App.tsx`: persistent shell and shared workspace queries.
- `api.ts`: typed backend contract and request handling; no embedded credentials.
- `useFetch.ts`, `useRunUpdates.ts`: stale-response protection, explicit fetch states, durable SSE reconnection and polling fallback.
- `components/`: one reusable layer for page primitives, charts, dialogs and command navigation.
- `pages/`: resource-specific rendering and actions; no generic dashboard schema or deeply nested component framework.
- `index.css`: shared tokens, table density, component styles and responsive layouts.

Motion handles navigation layout and dialog/drawer motion. The command surface adapts Kokonut's action-search pattern using cmdk + Radix for keyboard and focus behavior. The activity chart adapts Bklit's Visx/Motion approach; it plots actual timestamp spacing with linear interpolation and provides an accessible data table. Neither upstream component catalog was imported wholesale. Inter and JetBrains Mono are bundled locally.

## Verify

```sh
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright uses deterministic API fixtures from `e2e/fixtures.ts`; these are never imported by the application. Tests exercise actual browser interactions and mutation payloads, not a live database. They cover resource navigation, filters, creation/upload, replay actions, evidence proofs, historical versions, analyst review, keyboard behavior, mobile containment, reduced motion, failure/empty states and automated accessibility checks. Screenshots and failure traces are ignored by git. Automated axe checks supplement, not replace, manual accessibility testing.

## Hosting contract — including Manus

`npm run build` produces `dist/`. A shared deployment must provide all of the following:

1. Serve static assets and rewrite non-API resource routes to `index.html` so deep links work.
2. Route `/api/*` and `/health/*` to the backend without the SPA rewrite. Vite's development/preview proxy is **not** production infrastructure.
3. Preserve streaming responses on `/api/v1/runs/:id/updates`, disable buffering for that route and allow long-lived SSE connections.
4. Protect the console **and all API reads** with operator authentication. The existing backend only authenticates mutations with `Authorization: Bearer APP_AUTH_SECRET`; it does not implement browser login/cookie sessions. A trusted gateway must authenticate the user before adding the server-side operator credential to mutation requests. Never expose that credential in a `VITE_*` variable, JavaScript bundle, URL or browser storage. Do not publish an unauthenticated token-injecting proxy.
5. Configure TLS, access control, server-side secrets, database migrations, durable source storage, model artifacts and detector/side-effect workers. Validate upload limits/timeouts with realistic files; frontend requests currently time out after 30 seconds.
6. Verify a real upload → import → replay → finding → evidence → disposition workflow, SSE reconnect and degraded operation in the target environment before release.

Manus remains the requested hosting destination. No Manus project or deployment configuration was available for this change, so deployment and production authentication are not verified or represented as complete.

## Sentry

Developer tooling and application instrumentation are separate. The official Sentry MCP and developer CLI were connected on the local developer machine. OAuth credentials are outside this repository; do not commit them. MCP changes may require a new client session before tools appear.

The backend uses server-side `SENTRY_DSN`; the lazy-loaded React SDK uses public `VITE_SENTRY_DSN`. Both remain disabled without
a DSN. Errors, navigation/API/worker traces and structured application logs are scrubbed before export. No session replay or raw
evidence is collected. Integrations contains an explicit synthetic diagnostic; a queued event is not confirmed delivery.
See [Sentry setup and privacy](../docs/sentry-observability.md) and the [human acceptance pipeline](../docs/verification-guide.md).
