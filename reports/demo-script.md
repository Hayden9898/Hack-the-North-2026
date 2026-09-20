# Three-minute demo script

Everything shown is a **historical replay** of the supplied file (labelled as such in every Slack preview and in the
run header). Fault injection is labelled. Configuration badges are not delivery evidence: confirm receipt in the actual sponsor
service before describing an integration as externally verified. See `docs/sentry-observability.md`.

## Reset / start (before the demo)

```bash
python tasks.py dev                                  # DB, migrations, API, detector, side-effect worker, UI
python tasks.py replay-demo                          # new isolated run "demo": warms Aug–Feb (~12–15 min), pauses at Mar 1
```

The warmup is a real causal pass; nothing is preloaded. Repeating `replay-demo` creates another isolated run.

## 0:00 — Routine traffic (run console)

Open the `demo` run. Point at the header: phase *visible replay*, model **active** (`if_v1_2026-09-19`, threshold at the
99.9th calibration percentile), integrations *Slack preview / Sentry disabled / AI deterministic-only*, cursor.
Set speed to 600 and press **Resume**. Show the feed: normal rows, a routine confidential ZIP download by its usual
audience (nicole_h / sarah_j) staying *normal* — filename and 8 MB size are not evidence on their own.

## 0:40 — Unusual failed-login burst

Set speed to 0 (fast-forward) until Mar 13 23:10, then pause (or filter *suspicious*). Show the four 401s for
`sarah_j@10.0.8.45`: first three normal (model rarity percentile already > 99.9), fourth fires **R1** → incident v1,
Slack digest *debounced*. Open the incident: headline, qualifier ("attempts, not who made them"), facts (4 failures
in 60 s, source *unfamiliar* relative to the frozen August reference), unknowns (session identity, credential source).

## 1:20 — Escalation through the March sequence

Fast-forward to Mar 15 11:27. The key moment: line **168338**, david_m's 78th request for the ZIP returns 200.
Open the R2/R5 incident (high risk): 77 prior denials (counted fact) → click **Show evidence** → the aggregate proof
recomputes 77 = 77 ✓ and pages through the original lines; linked context: sarah_j viewed post 1042 (line 168335)
one second before the only `/api/admin/role_update` in the dataset (168336, R3 incident, related episode); david_m
viewed 1042 at 168333. Qualifier: does not assert who created the object or whose role changed.
The overview's **Investigation brief** answers who is recorded, which request triggered this version, when, and why.
Its measured-condition buttons open that same evidence drawer. Select version 1: R2 is still suspicious, without the
R5-added evidence and relationship—even though the versions share a processing sequence. Download the local JSON brief
if the judge wants a version-pinned artifact; it includes unknowns and source/config provenance, not a claim of guilt.
Then Mar 15 22:29: sarah_j's login 200 from 10.0.8.45 and the ZIP download → **R4** escalates the R1 episode to high
risk; the Slack preview shows the immediate high-risk escalation (debounce bypassed).

## 2:20 — Invalid AI proposal rejected (labelled fault injection)

```bash
python -m scripts.inject_invalid_claim --run-id <demo run id>
```

Reload the incident and open **Review & response**: *AI proposal rejected by validator* with the schema-level reasons (fabricated fact ids, an
unknown "confirmed" hypothesis code) on both the first attempt and the single repair; the deterministic summary
remains and the incident class, deliveries and detections are untouched. With a
`SENTRY_DSN` configured the rejection produces a `claim_rejected` structured log on the `explanation` trace; full rejection
text is deliberately scrubbed from telemetry. Versioned details remain in the incident UI.

## 2:45 — Tiger aggregate, measured

Execution Overview → activity chart → **Data and query details**: freshness and raw-tail state, then **Measure query performance**:
raw GROUP BY vs aggregate on this database, identical results and measured milliseconds.
Close by opening a normal event's detail: raw line, features, measured deviations — the same decision is reproducible
from the run's evidence.
