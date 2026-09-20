# Operator acceptance guide

The goal is repeatable, inspectable evidence—not a promise that finite tests can prove defect-free software.
Every gate saves its commands, results and limitations. Failed prerequisites are **BLOCKED**, never green.

## One command, then human review

Use Python 3.12 (`python3` on macOS; this machine's `python` is Python 2). The task runner automatically uses `.venv`.

```sh
python3 tasks.py doctor
python3 tasks.py verify
python3 tasks.py verify-report
```

Open **http://127.0.0.1:8765**. The server exposes only generated verification reports, not the repository or `.env`.
Expand a check to see its command/output; open the browser report for named steps, screenshots, accessibility results,
and failure traces/video. Each run has its own timestamped directory under `reports/verification/`, plus JSON results
and Python JUnit XML. Generated reports are git-ignored. Download CI artifacts to inspect the same evidence.

`verify` runs the frontend gate **before** the backend gate. It stops on a failure. It does not import logs, train a model,
start/resume an execution, deploy, send Slack, or call an AI provider. It disables external credentials in its child processes.

| Gate | Command | What a pass proves |
| --- | --- | --- |
| Environment | `python3 tasks.py doctor` | Dependency, Docker, test-DB, API and UI readiness; artifact presence is separately labelled |
| Frontend | `python3 tasks.py verify-frontend` | Types, lint, production build, Chromium multipart-upload workflow, plus a local Sentry SDK privacy/transport check |
| Backend | `python3 tasks.py verify-backend` | Python types/lint, non-DB tests, serial API/worker/detector tests against dedicated TimescaleDB |
| Canonical replay | `python3 tasks.py verify-live RUN_ID=<completed-id>` | Read-only checks of the actual running app, original dataset, model-active result and evidence proof |
| External Sentry | Follow [Sentry acceptance](sentry-observability.md) | Events, traces and logs actually received in the chosen project, not merely queued |

The frontend gate runs a fresh production preview on **4173**, not a potentially stale dev server. Monitoring runs
sequentially with a dummy loopback DSN and an intercepted local collector. No real Sentry events are sent.
Zero skipped tests, retries or flaky passes are accepted. Synthetic fixtures stay in test directories; the app never uses them.
To watch the interactions: `python3 tasks.py verify-frontend HEADED=1`; for interactive debugging use `cd frontend && npm run test:ui`.

## Database safety

Install requirements into a Python 3.12 environment, then run `python3 tasks.py db-up` and `python3 tasks.py migrate`.
Tests **truncate only the configured dedicated test database**, whose explicit name must end in `_test` and differ from
the application database. Remote targets require explicit opt-in. A session advisory lock rejects a second test process
before migration or truncation. Do not run competing pytest processes against the same DB.

If Docker reports “No space left on device,” review Docker Desktop disk capacity with its owner. Do not automatically
prune volumes, images or caches. The September 19 local verification used an isolated tmpfs-backed TimescaleDB on port
5434 because the normal Docker disk was full. That verifies the database-backed code, **not** persistent dev-server readiness.

## Canonical data acceptance

Supply the original file and reviewed frozen model artifact. Import it, complete a model-active replay, start the app, then
pass that execution ID to `verify-live`. This gate makes no application mutations. It checks:

- Source SHA-256 `9f773643335352d8aa8cc9f07c5f92614b65c806f84c84790f56e4c652970575`, 180,800 valid events, zero rejects.
- Completed execution: 180,800 admitted and processed, zero backlog, active model; March has 2 high-risk and 36 suspicious events.
- Exactly three incidents with rule groups R1+R4, R2+R5 and R3; two high-risk incidents.
- Exact expected rule source lines from `tests/fixtures/known_sequence.json`; model-only flags do not become incidents.
- The prior-denial fact is 77, its recomputed proof matches, and the actual evidence drawer renders it.
- Real SSE heartbeat and browser connection, no JS exceptions, no application writes.

The full-file import test is separate: `python3 tasks.py test ARGS="-m slow"`. Missing source/model is a missing release
prerequisite, not permission to substitute fixtures. Historical evaluation claims are not fresh verification of this machine.
Real replay screenshots may contain account names, IPs and raw evidence: keep them local/private. Never upload them to public CI.

## Human sign-off (record reviewer, commit, date and report directory)

1. Inspect the desktop, tablet and mobile screenshot galleries: density, clipping, labels, empty/loading/error states.
2. Use only the keyboard: skip link, navigation, Cmd/Ctrl+K, filters, drawer open/resize/Escape, focus return. Try reduced motion.
3. Visit `/welcome`; drag or keyboard-tilt the badge, reset it, enter the workspace. No model statistics are fabricated there.
4. In the real app: upload a source, check rejects, create/start/pause/resume a replay, refresh a deep link and use Back/Forward.
5. Inspect a finding and incident: source/account/time remain visible, URL filters persist, historical versions cannot submit current reviews.
   Read the investigation brief, open a proof, and download its JSON. Check the version, cutoff, source fingerprint,
   explicit unknowns and truncation flag. Later R5 relationships must not appear in the earlier R2 evidence version.
6. Verify the 77-denial proof. Review qualified hypotheses separately from deterministic facts. Submit an explicit analyst disposition.
7. Stop/restart **only the app's own** detector process during a disposable run. Verify no skipped/duplicate processing. Temporarily
   interrupt the API and restore it: the console must show stale/disconnected state and reconnect without inventing success.
8. Run the opt-in Sentry diagnostic; inspect receipt in Sentry and ensure no raw evidence or prompts appear. Worker traces require worker activity.
9. Before deployment: test authenticated gateway, TLS, upload limits, durable storage, migrations, worker restart and unbuffered SSE on Manus.

Not covered by a green local gate: all browsers, full screen-reader audit, real-provider reliability, live-source p95 latency,
load testing, security review, production authentication/hosting, or a blind ML holdout evaluation.
