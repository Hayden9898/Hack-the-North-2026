# Sponsor fit and honest demo evidence

Checked September 19, 2026 against the [official prize page](https://hackthenorth2026.devpost.com/)
and [rules](https://hackthenorth2026.devpost.com/rules). This is an implementation/evidence assessment,
not an eligibility guarantee or a change to the team's Devpost submission.

**Deadline:** sponsor selections were due September 19 at 2:00 PM EDT; the rules say late additions do not count.
Final edits close September 20 at 8:00 AM EDT. Confirm what the team actually selected. Only organizers can resolve exceptions.

| Category | Fit for this project | Evidence still required |
| --- | --- | --- |
| CSE: Log & Order | Core project: causal investigation, attributable facts, incoming-event detection | Original dataset/model available locally, canonical replay acceptance, clear who/what/when/how with uncertainty retained |
| Sentry | Errors **plus Logs and Tracing**, with MCP as additional developer tooling | Chosen project/DSNs, actual received worker/API/browser telemetry, and a genuine diagnosis → change → measured result |
| Tiger Data | TimescaleDB, continuous aggregates, measured raw/aggregate parity | Rerun real dataset benchmarks; distinguish local TimescaleDB from unverified Tiger Cloud; confirm local use qualifies with sponsor |
| Warp | Operational developer tool and inspectable verification workflow; no Warp API requirement | Demonstrate a real developer investigation/debugging benefit, not just the existence of tests |
| Rox | Grounded, validated AI review is relevant to messy operational data | A real LLM-enabled run and meaningful bounded actions; deterministic fallback alone is not a working LLM-agent demo |
| OpenAI | Codex-assisted implementation/testing is documented | The app currently has an Anthropic adapter, not an OpenAI API integration. Codex use alone does not satisfy the stated API criterion |

Other product-specific prizes need meaningful use of their products. Styling inspired by Cloudflare/AWS, installing an MCP,
or listing a sponsor logo does not establish usage. Adding a financial-research harness, Elasticsearch layer, alternate cloud
runtime, or another provider would be a separate scope decision, not a cosmetic prize checkbox. No such integrations were added.

## Sentry demo acceptance

Use [the Sentry runbook](sentry-observability.md). Logs and Tracing are the two additional products; Session Replay is deliberately
excluded from this evidence-heavy console. Show both correlated to application operations. Do not send investigated logs to Sentry.

The compelling proof is a reproducible **real** problem: open its trace/log, explain the cause, show the corrective change,
repeat the same workload, and compare results. If demonstrating a fault injection, label it as an injection—not a naturally discovered bug.
Existing historical database benchmarks were not measured through live Sentry and must not be relabelled as Sentry findings.

Record the following only after observing it:

- Project, environment, release and timestamp.
- Received issue/event ID, trace ID and relevant structured log.
- Symptom and workload (no raw evidence in public screenshots).
- Actual diagnosis supported by that telemetry.
- Code/configuration change and before/after measurements under comparable conditions.
- What remains unverified.

Judging is a live demonstration. Keep the evidence-first investigation as the main narrative; sponsor detail should strengthen
that story, not turn the console into a collection of unrelated integrations.
