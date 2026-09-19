# Evaluation — rules, model and hybrid on the supplied dataset

**Scope and honesty statement.** All numbers come from `python -m ml.evaluate --model-id if_v1_2026-09-19`
(`reports/evaluation_data.json`) and `python -m ml.calibrate` (`reports/calibration.json`, `reports/calibration_999.json`)
run against the causal replay `rules-only-full` (run `0ca0d531-…`) of the supplied file
(SHA-256 `9f7736…0575`). There is **no organizer ground truth**. The only labelled events are the 20-line provisional
analyst inventory in `tests/fixtures/known_sequence.json`, and that sequence was inspected *before* the rules were
written, so March is a chronological evaluation partition, **not a blind holdout**. Synthetic-scenario results
(generic entities) are reported separately in §6. No ROC/AUC/accuracy is reported because no labels exist.

## 1. Protocol

| Partition (recorded -04:00 dates) | Rows | Use |
|---|---|---|
| Bootstrap, Aug 2025 | 21,845 | observed history + frozen familiar-login reference; not evaluated |
| Train, Sep–Dec 2025 | 92,001 | Isolation Forest fit (`IsolationForest(n_estimators=200, contamination='auto', random_state=42)`) |
| Calibration, Jan–Feb 2026 | 43,972 | threshold percentile + reviewed samples; no refit |
| Evaluation, Mar 2026 | 22,982 | frozen model + threshold; rules run causally throughout |

Features are the 30-dimensional v1 vector computed by the detector itself during the causal replay (train and
inference share `app/features/vector.py`; parity is asserted by `tests/integration/test_model_integration.py`).
Anomaly score = `-score_samples`, higher = rarer. Percentiles are rarity, never attack probability.

## 2. Threshold choice (made on calibration data only)

| Percentile | Threshold | Calibration alerts (59 days) | Per day | What the reviewed samples were |
|---|---|---|---|---|
| 99.0 | 0.5937 | 440 | 7.46 | not reviewed individually (burden too high) |
| 99.5 | 0.6062 | 220 | 3.73 | 14 sampled: 08:00 first-request-of-day document fetches, routine 403 denials, the finance audience's usual 8.4 MB ZIP download (`bytes_delta` + `acct_hour_rarity`) — all routine |
| **99.9 (chosen)** | **0.6338** | **44** | **0.75** | 20 sampled: off-hours activity by *familiar* pairs (forum edits at 01–06, downloads at 21–23), 08:00 denials — routine but at least individually unusual for the account |

Ties at the chosen threshold: 0. The 99.9 value was frozen as `active` in the model manifest before March was scored.
Rationale: at 99.5 the model adds ~3.7 routine events/day with no security content in the sample; at 99.9 the burden
is under one event/day and every flagged calibration event *is* a genuine rarity for that account (usually hour).
The model therefore runs **active at 99.9**, and — by design decision D-006 — model-only flags mark the event
`suspicious` in the feed (with measured deviations) but do **not** create incidents or Slack messages; only rules do.

Naive baseline (sum of the three `-log` rarity features + 3×unfamiliar flag) at the same burden overlaps the model on
only 16/44 calibration events, i.e. the forest is not just re-ranking the rarity sum.

## 3. March results (evaluation partition, 31 recorded days, 22,982 events)

| Detector | Event alerts | Per day | After grouping | High-risk events | Notes |
|---|---|---|---|---|---|
| Rules only | 7 | 0.23 | 3 incidents, 8 versions, 5 Slack payloads (2 high-risk, 3 digests) | 2 | zero rule matches outside the known sequence |
| Model only @99.9 | 36 | 1.16 | 25 account-days | 1 of 2 | flags 5 of the 7 rule events |
| Model only @99.5 | 140 | 4.52 | 99 account-days | 2 of 2 | flags 6 of the 7 rule events |
| Hybrid (rules ∪ model@99.9) | 38 | 1.23 | 3 incidents + 31 ML-only suspicious events | 2 | the operating configuration |
| Naive rarity baseline @99.9 | 23 | 0.74 | — | — | overlaps 6/7 rule events, 15/36 model flags |

Known provisional sequence (20 lines), all rule expectations met (`known_sequence.expectations_met = true`):

| Line | Role | Rules | Model score | Flagged at |
|---|---|---|---|---|
| 168311–168313 | failures 1–3, unfamiliar pair | normal (below R1 threshold) | 0.699–0.705 | 99.0/99.5/**99.9** |
| 168314 | failure 4 | **R1 suspicious** | 0.712 | all |
| 168321–168326 | night-2 failures 1–6 | R1 on 4th–6th | 0.707–0.721 | all |
| 168330–168332 | forum posts with unusual keys (500/400/302) | normal | 0.53–0.56 | none |
| 168333 / 168335 | actor / victim view object | normal | 0.49 / 0.52 | none |
| 168336 | victim admin request | **R3 suspicious** | 0.518 | none |
| 168338 | actor ZIP 200 after 77 denials | **R2 + R5 high risk** | 0.618 | 99.0/99.5 only |
| 168339 | actor edits object | normal | 0.541 | none |
| 168343 | victim login 200, unfamiliar source | normal | 0.667 | all |
| 168345 | victim ZIP 200, unfamiliar source | **R4 high risk** | 0.701 | all |

Timing (event time, relative to the first anchor event at 23:10:19 on Mar 13): rules' first warning **+13 s**
(4th failure), rules' first high-risk **+36 h 17 min** (line 168338); model's first flag **+0 s** (1st failure).

Observations:
- Rules and model are complementary. The model sees the *source* anomaly immediately (unfamiliar pair + rare hour +
  pair rarity); rules see *sequences* (denials→success, view→admin, login→sensitive) that the model scores as ordinary
  (0.49–0.62). Line 168338, the pivotal event, is **not** in the model's top 0.1 %: without rules it is missed.
- ML-only March flags at 99.9 (31 events): sarah_j's off-hours ZIP download at 00:19 on Mar 6 (line 162048, familiar
  pair, unusual hour), david_m's off-hours 403 on the same ZIP at 20:27 on Mar 6 (line 163097), and the unfamiliar-pair
  `/logout` at line 168346; the rest are 08:00 denials and off-hours activity by familiar pairs. None is a false
  *incident* (they create no incident), but as suspicious feed markers they are mostly noise.
- False positives (rules): none observed in 180,800 events. Misses (rules): the three forum posts with unusual query
  keys and the actor's object view/edit produce no rule; they appear only as context facts on the R5 incident.

### 3.1 Confirmation with the model active in the detector

A second full causal replay (`hybrid-full`, run `273433b4-…`) with the model loaded and active produced the same
three incidents and, in March, 2 high-risk + 36 suspicious events = 38 alerts — exactly the hybrid@99.9 figure
derived from snapshots above (7 rule events + 31 model-only markers). Warmup carried 237 model-only suspicious
markers over Aug–Feb (never alerted; warmup produces no notifications).

## 4. Alert burden and grouping

Before grouping, rules produced 7 event alerts in March; after grouping, 3 incidents. Slack payloads: 2 high-risk
escalations (bypassing debounce) and 3 debounced digests (flushed at replay completion). Over the full 8 months the
rules fired on exactly the 8 rule-match rows listed in `reports/investigation.md`; the warmup period produced 0.

## 5. Analyst-reviewed sample (documented method)

Sampled: the 14 (99.5) + 20 (99.9) calibration alerts above, chosen by seeded random sampling
(`random_state=42`) from the flagged sets, plus the 31 ML-only March flags. Reviewer: the implementing analyst (AI
assisted, no independent human review yet). Disposition: 0 of 34 calibration samples looked like security events;
of the 31 March ML-only flags, 3 were judged "worth a glance" (listed above), 28 routine, 0 confirmed incidents. These
are provisional dispositions, not labels.

## 6. Synthetic scenarios (generality of implementation, not real-world generalization)

`tests/integration/test_detector_rules.py` and `test_model_integration.py` regenerate a bootstrap with generic
accounts (`acct_1…6`, `192.168.10.x`), then inject: an unfamiliar-pair burst (R1 fires on the 4th failure with exact
legs), first sensitive success after 6 denials (R2, suspicious, counter == SQL recount), forum view → admin POST (R3),
the full linked analogue (R5 escalates on the ZIP success; R4 escalates on the later unfamiliar login + download),
two unrelated bursts in the same /24 (two incidents, no relation), equal-timestamp ties, a newcomer account
(`reference_unknown`, `cold_start`, never high risk) and repeated failures that never become familiar. All pass.

## 7. Limitations

- One dataset, ten accounts, one incident family; the March pattern informed the rules.
- The model's strongest signal (`pair_unfamiliar`/`pair_rarity`) is trivially available to a rule; its marginal value
  is early warning on failures 1–3 and off-hours rarity, at ~1 flagged event/day.
- Response bytes are constant per path, so size features carry no information beyond path identity here.
- No labels ⇒ no precision/recall claims. Known-incident recall applies only to the 20-line provisional inventory.
