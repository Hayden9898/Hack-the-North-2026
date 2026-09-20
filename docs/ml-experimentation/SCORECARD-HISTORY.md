# Scorecard history

Self-assessment of the detection layer against a fixed rubric, one row per iteration, so we can see
whether changes are actually buying evidence — and whether we are drifting away from what makes this
system what it is.

Scores are 0–10 per axis, assigned by an independent reviewer agent that reads the tree at that commit
and is instructed to be harsh. They are our own judgement of our own work; they are a steering
instrument, not a claim.

**Rubric.** `depth` technical substance · `rigor` protocol soundness (leakage, selection, blindness,
statistics) · `evidence` can we show how well it works, with numbers · `demo` what is visible in three
minutes · `orig` is the approach thoughtful or a standard recipe · `honest` calibrated claims and
stated limits.

| # | Date | depth | rigor | evidence | demo | orig | honest | **total** | Headline change |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 2026-09-19 | 7.0 | 6.5 | 4.5 | 7.0 | 8.0 | 8.0 | **41.0** | Baseline. `ml/artifacts/` empty; no ranking metric of any kind reported. |
| 1 | 2026-09-19 | — | — | — | — | — | — | — | Two-channel detector + ranking metrics with paired bootstrap. *(scoring pending)* |

## Drift check

The thing that makes this system distinctive is that it is a **causal streaming investigation console**:
every verdict is a provable function of the events that preceded it, incidents are versioned, facts are
typed and evidenced, and the AI layer can only select from facts a validator has already checked.

Each iteration is checked against that identity. An improvement that makes the numbers better by making
the system more like an offline batch scorer is a regression, however good the number looks.

| # | Identity-preserving? | Note |
|---|---|---|
| 0 | — | Baseline. |
| 1 | yes | The novelty channel is per-event, causal, and decomposes into per-feature terms that feed the existing typed-fact layer. It adds an explanation surface rather than a second opaque score. Risk noted: it lives in the ML layer only and is not yet wired into the detector, so the gap between "what we measure" and "what runs" widened this iteration and must close in #2. |

## Iteration log

### Iteration 0 — baseline (commit prior to `ML-experimentation`)

State: causal replay, rules R1–R5, incidents, typed facts, constrained-AI validator, TimescaleDB
continuous aggregates all working and tested. `ml/artifacts/` empty — no model in the tree. Evaluation
reported alert counts and burden only, and explicitly declined to report precision, recall or AUC on
the grounds that no organizer labels exist.

Weakest axis: **evidence (4.5)**. A reader could not tell whether the detector worked. The report also
understated the system, describing the pivotal escalation event as "missed" when it in fact ranks 79th
of 22,982.

### Iteration 1 — two-channel detection and ranking metrics

Changed:
- `fix(ml)` `max_samples: auto` → `1.0`. 256 rows per tree out of 92,001 was starving the forest.
  March rank-AUC 0.9501 → 0.9974; bootstrap interval tightened ~4×.
- `feat(detection)` support-novelty channel for the 8 of 30 features with zero training variance, which
  received zero splits across all 200 trees and were therefore unreachable by the density model.
- `feat(ml)` ranking metrics with percentile bootstrap and **paired** bootstrap on identical resample
  indices; label-provenance record emitted beside every figure.
- `test` 11 unit tests, including the guard against the drift failure that made the naive version fire
  on 100% of the partition.

Measured: two-channel AP 0.8561 [0.6878, 0.9853] vs density 0.6710; paired Δ +0.1851 [+0.0480, +0.3565],
significant. Novelty channel: 0 alerts across 136,000 train+calibration events, 19 in March,
17/20 inventory hits, 2 non-inventory alerts (retained as false positives; inventory not widened).

Reported against us: on average precision the Isolation Forest does **not** significantly beat the naive
four-term rarity baseline (Δ +0.0335 [−0.0882, +0.1299]). Stated first in the report.

Still open: the model has never scored an event inside the live pipeline; every run is
`model_health='rules_only'`. Cited model and run ids in the committed report do not resolve on disk.
