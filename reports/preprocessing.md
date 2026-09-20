# Preprocessing stage — training domain in front of the Isolation Forest

**Scope and honesty statement.** Candidate model `if_v1_domain_2026-09-19` was fitted, calibrated and evaluated with
exactly the protocol of `reports/evaluation.md`: same causal source run `rules-only-full` (`0ca0d531-…`), same
partitions, same forest parameters (`n_estimators=200, contamination='auto', random_state=42`), threshold frozen at
the 99.9th calibration percentile. Numbers: `reports/calibration_domain.json`, `reports/evaluation_domain_data.json`
(`python -m ml.evaluate --model-id if_v1_domain_2026-09-19 --out reports/evaluation_domain_data.json`). March is
still a chronological evaluation partition that informed the design, not a blind holdout, and no organizer labels
exist. The candidate is registered as **candidate**; the active model is unchanged until someone runs
`python -m ml.calibrate --model-id if_v1_domain_2026-09-19 --percentile 99.9 --activate`.

## 1. What was wrong

An Isolation Forest isolates a point by drawing random split values between the minimum and maximum a feature takes
in the training sample. A feature that is constant across the whole training partition never receives a split, so
the forest is blind to it at inference no matter what value arrives. Measured on the Sep–Dec training matrix
(92,001 rows):

| Feature | Training value | March rows with a different value |
|---|---|---|
| `pair_unfamiliar` | always 0 | 14 |
| `first_200_after_denials` | always 0 | 1 (line 168338, the pivotal ZIP download) |
| `is_admin` | always 0 | 1 (line 168336, the victim's admin request) |
| `unusual_query_key_count` | always 0 | 3 (lines 168330–168332, the forum posts) |
| `status_other` | always 0 | 2 |
| `bytes_reference_missing` | always 0 | 3 |
| `reference_unknown`, `cold_start` | always 0 | 0 |

Eight of the thirty v1 features are constant in training, and six of them are the attack indicators. Standardising
or rescaling cannot help: the forest is invariant to per-feature monotone linear maps, and a constant column stays
constant. Calibration (Jan–Feb, 43,972 rows) contains **zero** rows that depart from any of these constants.

## 2. The stage (`backend/app/detection/preprocess.py`, `domain_v1`)

`TrainingDomain` is a scikit-learn transformer fitted on the training matrix only and pickled inside the artifact as
the first step of a `Pipeline`, so training and inference share one object:

1. **Prune blind spots.** Constant training features are removed from the forest input (30 → 22 columns), so random
   feature draws are not wasted on them and the manifest states which features the forest can act on.
2. **Never-seen guard.** The constant each blind spot held in training is recorded. At inference the stage counts
   how many blind spots a vector departs from; each departure has zero training support, the strongest rarity
   evidence available. Combined score = forest score (`-score_samples`, in [0, 1]) + 1.0 per departure, so every
   never-seen vector outranks every in-domain vector and lands at rarity percentile 100.

Out-of-range values on *varying* features are left to the forest on purpose: it handles them natively, and on this
dataset `pair_rarity`/`acct_history_log1p` drift monotonically as history accumulates (every calibration row is out of
the training range on them), so a general range guard would fire on everything.

Integrity: `load_model` refuses an artifact whose pipeline was fitted on a different feature schema, whose pruned
feature list differs from the manifest, or whose manifest and artifact disagree about whether a stage exists. Legacy
plain-forest artifacts (including the active `if_v1_2026-09-19`) load and score exactly as before.
`python -m ml.train --no-preprocess` reproduces the old behaviour.

## 3. Calibration (Jan–Feb, decision made before March was scored)

| Percentile | Old threshold | New threshold | Alerts / per day (old → new) |
|---|---|---|---|
| 99.0 | 0.5937 | 0.5908 | 440 / 7.46 → 440 / 7.46 |
| 99.5 | 0.6062 | 0.6018 | 220 / 3.73 → 219 / 3.71 |
| **99.9 (chosen)** | 0.6338 | **0.6296** | 44 / 0.75 → **44 / 0.75** |

Blind-spot departures on calibration: 0, ties at the threshold: 0. The burden is unchanged by construction; the small
threshold shift is the re-fitted forest's different random draws over 22 instead of 30 columns.

## 4. March (evaluation partition, 22,982 events), model at 99.9

| | Old `if_v1_2026-09-19` | New `if_v1_domain_2026-09-19` |
|---|---|---|
| Model-only event alerts | 36 (1.16/day) | 50 (1.61/day) = 31 forest flags + 19 never-seen departures |
| Grouped account-days | 25 | 32 |
| Rule events flagged (of 7) | 5 | **7** |
| High-risk events flagged (of 2) | 1 | **2** |
| Hybrid (rules ∪ model) | 38 | 50 |
| Known sequence lines flagged (of 20) | 12 | **17** |
| Model first flag vs first anchor event | +0 s | +0 s |

Known provisional sequence, lines whose outcome changed:

| Line | Role | Rules | Old score | New score |
|---|---|---|---|---|
| 168330 / 168331 / 168332 | forum posts with unusual query keys (500 / 400 / 302) | none | 0.56 / 0.55 / 0.53, not flagged | 3.56 / 3.54 / 1.54, **flagged** |
| 168336 | victim admin request | R3 suspicious | 0.518, not flagged | 2.52, **flagged** |
| 168338 | actor ZIP 200 after 77 denials (pivotal) | R2 + R5 high risk | 0.618, not flagged | 1.63, **flagged** |
| 168333 / 168335 / 168339 | actor/victim object view, actor edit | none | 0.49 / 0.52 / 0.54 | 0.48 / 0.54 / 0.55, still not flagged (ordinary requests, no never-seen value) |

All other known lines were already flagged by the old model and remain flagged (scores shift by +1.0 because the
unfamiliar pair is itself a blind-spot departure). `known_sequence.expectations_met` stays true; rule timings are
untouched (rules and model remain independent, D-006 still holds: model-only flags are `suspicious` markers, never
incidents).

Cost: of the 14 additional March alerts, 5 are the known-sequence lines above, 7 are other never-seen departures
(2 non-standard statuses, 3 requests with no byte reference for their route family/status, 2 unfamiliar-pair
requests around the victim's login), and the remainder come from the re-fitted forest ranking 08:00–09:00
first-request-of-day denials slightly differently (08:00 flags 10 → 14, 09:00 1 → 4). The forest-only part of the
new model produces 31 flags against the old model's 36.

## 5. Verification

- `tests/unit/test_preprocess.py` (8 tests): blind-spot detection, pruning, input validation, departure counting on
  blind spots only, score = forest + penalty, never-seen outranks in-domain, legacy plain forest unchanged, joblib
  round trip, manifest description.
- `tests/integration/test_model_integration.py::test_m05_…`: synthetic world, pipeline artifact driven through the
  real detector — stored scores equal re-scoring (M01 parity holds through the stage), calibration departures 0,
  admin request and unfamiliar-pair burst flagged at percentile 100 and classified `suspicious`, artifact/manifest
  disagreement refused both ways. Existing M01–M04 tests pass unchanged.
- `mypy` clean, `ruff` clean.

## 6. Limitations

- The guard learns "never seen" from one four-month training window of ten accounts; a route or status that first
  appears legitimately after training will be flagged as suspicious (never as an incident) until the model is refit.
  That is the intended semantics — a rarity marker — but it will be noisier on a livelier site.
- A departure costs a flat +1.0 per feature; the score is no longer bounded by 1 and departures dominate the forest's
  ranking among themselves. Percentiles stay rarity, never attack probability.
- The choice to add the guard was informed by knowing which March features the attack exercised (the same caveat as
  the rules); the burden check on calibration is the only decision made blind.
