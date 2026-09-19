# Log & Order — product overview and design decisions

**Specification version:** 1.0, 2026-09-19. **Status:** implementation-ready design; the application has not been built or benchmarked. Read this file, then `architecture.md`, then execute `plan.md`. These three files supersede both earlier design proposals. `architecture.md` owns technical contracts; `plan.md` owns build gates. Do not combine incompatible alternatives from the old handoffs.

## Product

Build a behavioral security investigation console for the supplied CSE HTTP access logs. It must answer who/what/when/how with inspectable evidence, and apply the same detector to incoming records. It learns historical patterns, assigns **normal / suspicious / high risk**, connects related observations into incidents, and sends grouped Slack alerts. Tiger Data stores and analyzes event history. Sentry Tracing and Logs expose the reliability and performance of our own pipeline.

The differentiator is **a reproducible explanation of why an ordinary-looking action became suspicious in context**, coupled with an explicit test of whether the AI explanation is supported. Judges should be able to open a claim, inspect the original evidence, replay the sequence and see the same decision.

“Normal” means no configured detector flagged the record. “High risk” means urgently investigate, not established guilt. Account names and IPs identify recorded actors/sources, not the humans controlling them.

## What is actually known

Inputs inspected: `cse-log-order-design-handoff.md`, the earlier Log-and-Order-Agent-Build-Plan.md, the supplied prize sheet, and the entire `htn_challenge_logs_2026.txt` file.

| Property | Verified finding |
|---|---|
| Records | 180,800; all parsed; chronological |
| Time range | Aug 1, 2025 08:00:57 through Mar 31, 2026 18:00:26, displayed at recorded -0400 offset |
| Accounts | 10 |
| Fields | Source IP text, username, timestamp with offset, method, request target, HTTP version, status, byte field |
| Status counts | 200: 140,069; 302: 34,506; 403: 5,324; 401: 899; 500: 1; 400: 1 |
| Missing | Destination hosts/ports, packet payloads, session IDs, request bodies, user agents, role-change contents, authoritative attack labels |
| Special parsing case | `10.0.9.05` must be preserved; do not reject it through strict IPv4 validation |
| File SHA-256 | `9f773643335352d8aa8cc9f07c5f92614b65c806f84c84790f56e4c652970575` |

The byte field is interpreted as HTTP response size under the apparent access-log convention. It is not evidence of outbound exfiltration. A GET returning 200 is an observed successful HTTP response, not proof a document was read by a particular person.

At roughly 1,036 records on the median recorded day, 30-second per-account buckets would often be empty or almost empty. This is another reason to use per-event historical context and longer trailing windows, rather than only short volume buckets.

### Preliminary investigation anchor

All dates below are in 2026. Line numbers refer to the original file, starting at 1.

| Lines | Recorded time (-0400) | Observed fact |
|---|---|---|
| 168311–168314 | Mar 13, 23:10:19–23:10:32 | Four login 401s for sarah_j from 10.0.8.45. |
| 168321–168326 | Mar 14, 22:11:26–22:11:39 | Six more login 401s for that pair. |
| 168330–168332 | Mar 15, 09:20:20–10:18:52 | david_m makes forum POSTs with unusual query keys/values, including csrf_test, csrf_role_update and script=success. Responses: 500, 400, 302. |
| 168333 | Mar 15, 10:18:55 | david_m views forum post 1042. The create request does not identify which post was created. |
| 168335–168337 | Mar 15, 11:07:56–11:07:59 | sarah_j views post 1042, makes a role-update POST one second later with response 200, then requests an avatar. |
| 168338 | Mar 15, 11:26:59 | david_m receives a 200 response for a confidential ZIP, with 8,459,200 response bytes, after 77 previous 403s for that account/resource. |
| 168339 | Mar 15, 11:48:01 | david_m edits post 1042; the changed contents are unavailable. |
| 168343–168346 | Mar 15, 22:29:43–22:33:40 | sarah_j receives a successful login response from 10.0.8.45, requests the dashboard and confidential ZIP, then logs out. |

All 18,021 david_m records use 10.0.8.45. Sarah has 17,942 records at 10.0.5.12 and 14 at 10.0.8.45. This supports investigating account misuse and possible privilege abuse. Exact CSRF/XSS mechanism, credential compromise, actual role mutation and external transfer remain unproven. The known sequence is an analyst finding, not organizer-supplied ground truth or a claim that every hidden incident has been found.

## Decisions and tradeoffs

| Question | Selected decision | Why; what we give up |
|---|---|---|
| Generic network detector or dataset-specific detector? | HTTP account/resource behavior | Ports, destinations and session durations are absent. Remove port scanning, C2 and exfiltration claims from the MVP. |
| 30-second aggregates or per-event scoring? | Each event carries 5-minute/1-hour context plus long-term history | Preserves single consequential requests and multi-day patterns; requires ordered state. Aggregates remain useful for charts. |
| ML or rules? | Independent rules AND Isolation Forest feeding one policy | Known high-risk patterns must fire even if ML misses them. ML-only anomalies remain suspicious. |
| Which model? | One pooled Isolation Forest on numeric, history-relative features | Appropriate unlabeled baseline, fast to implement. Not proven the best model; promotion requires comparison with simple rarity/rule baselines. |
| Online learning? | Streaming inference; frozen model per run | Reproducible, harder to poison, simpler to debug. Adaptation needs reviewed retraining, not automatic learning from every request. |
| Per-account models? | Per-account statistics; pooled model | Avoids ten models and sparse-account instability while retaining personal context. |
| Three-class ML? | Three product classes from deterministic policy | No trusted three-class training labels. No fabricated threat probability or weighted risk percentage. |
| Database? | Tiger Cloud target; local TimescaleDB development | One relational store, meaningful time-series analytics. Plain Postgres could handle this dataset; Tiger is not necessary merely for its size. |
| Compute features entirely with DB aggregation? | Run-scoped counters plus indexed event queries | Exact causal semantics; continuous-aggregate freshness cannot change a security decision. More state than a single GROUP BY. |
| Distributed pipeline? | Modular monolith: API, serial detector worker, enrichment/delivery worker | Fewer operational failures. Horizontal detector scaling is explicitly deferred. |
| Graph reasoning? | Bounded typed links and temporal sequence rules | Auditable, simpler than a graph database/GNN. A graph is an optional view, not the detector. |
| LLM? | Deterministic facts first; bounded AI evidence selection and hypothesis suggestions | Less expressive than unrestricted prose but much safer to validate. Product works during provider outage. |
| Frontend? | React + TypeScript + Vite, REST and SSE | FastAPI owns all backend logic; no need for SSR. Preserve an existing working Next.js frontend if supplied. |
| Incident confidence? | Evidence strength and missing evidence, separately from model rarity | Avoids unsupported percentages such as “96% malicious.” |
| Remediation? | Reviewed catalog plus optional sandbox simulation | Useful next steps without pretending access logs identify an exact code patch. |
| MITRE mapping? | Optional curated annotations after core gates | Technique IDs do not establish an attack; omit unsupported mappings. |
| Model ensemble? | Excluded from this build | Uncalibrated weighted model scores add failure modes without demonstrated benefit. Spend time on evaluation instead. |

A “top deviation” is a measured baseline difference, not an Isolation Forest feature attribution. Do not label it SHAP or a causal explanation of the model.

## Scope and priorities

**Required complete submission:** reproducible dataset investigation; idempotent ingestion; causal history; rules plus evaluated ML; three categories; correlated incident/evidence view; accelerated replay; durable Slack delivery with preview; Tiger event history and one measured aggregate use; Sentry Tracing + Logs; deterministic explanation fallback; constrained AI investigation; remediation recommendations; tests and measured limitations.

**Optional after required gates:** evidence relationship graph, curated ATT&CK labels, sandbox remediation, report styling. Exclude Kafka, Redis, graph DB, vector DB, multi-agent runtime, autoencoders, automatic baseline retraining and production account changes.

CSE is the primary fit. According to the provided prize sheet, Sentry requires at least two products beyond error monitoring and evidence that observability improved the project. Tiger rewards meaningful real-time/analytical use. These are alignment choices, not promises of eligibility or winning. Verify rules on reused code with organizers; no prior winning repository was supplied or audited.

## User experience

1. Select a run; see dataset, replay/live mode, detection readiness, model version and stream health.
2. Watch incoming events; filter normal, suspicious and high risk. Pending/unscored is a processing state, never a fourth threat class or a green verdict.
3. Open an incident: account/IP, time, measured reasons, linked timeline and baseline comparison.
4. Open a fact to see exact log lines or a reproducible aggregate calculation.
5. Inspect “possible explanations,” “counterevidence,” and “what we cannot establish.” AI suggestions cannot change the detector verdict.
6. Review a remediation playbook or record analyst disposition. Closing an incident does not erase detections.
7. Inspect the Slack message and delivery status; in preview mode no message leaves the application.

## Three-minute demo

Show a routine download, an unusual failed-login burst, and escalation through the March sequence. The key moment is David's previously denied resource returning 200 with connected context. Show the later cross-account source activity as additional evidence. Open a factual claim and its original lines. Inject an invalid explanation proposal; show rejection, fallback and a Sentry log/trace. Finally show one real measured query improvement and the corresponding Tiger aggregate. Fault injection and historical replay must be labeled.

No fabricated throughput, precision, attack labels or sponsor integrations. The unit of success is an inspectable working flow, including how it behaves when a component fails.

## Read next

- `architecture.md`: schemas, time semantics, feature definitions, rules, workers, API, evidence validation and failure behavior.
- `plan.md`: ordered implementation tasks, tests, commands, milestones and completion criteria for the coding agent.
