# ML experimentation — detector design review

Working notes for the `ML-experimentation` branch. This is an internal review of our anomaly-detection
layer: what we measured, what we found wrong, what we changed, and what the numbers are afterwards.

It is written to be read by someone who is going to challenge it. Every figure names the data it came
from, and the label provenance travels with the number rather than sitting in a footnote.

---

## 1. Why this review happened

Our evaluation report was scrupulous about what it would not claim — no precision, no recall, no AUC,
on the grounds that the challenge ships no labels. That stance is correct about the data and wrong
about the consequence. Refusing to divide does not make a detector honest; it makes it unmeasured.
A reader cannot tell a detector that works from one that does not, and neither can we.

Worse, the report contained a self-criticism that turned out to be false in our own favour: it stated
that the pivotal privilege-escalation event was *missed* by the model. It is not missed. It ranks 79th
of 22,982 — the top 0.34%. We were understating our own system because we had never computed a rank.

So the review had two goals: find out whether the model actually works, and find out why it behaved
the way it did on the events we care about.

## 2. What we found: the density channel is blind to our best features

The finding is structural, not a tuning problem.

An Isolation Forest partitions the training distribution. A feature that has **zero variance in the
training window gets no split in any tree**, and therefore no value it takes at inference can move the
score. The dimension is not weakly weighted — it is unreachable.

Measured on the v1 vector over the Sep–Dec train partition (92,001 rows), **8 of 30 features had zero
variance and accordingly zero splits across all 200 trees**:

```
pair_unfamiliar          reference_unknown        first_200_after_denials   is_admin
status_other             unusual_query_key_count  bytes_reference_missing   cold_start
```

Those are exactly the forensic indicators — the ones that encode *"this account has never been seen
from this address"*, *"this is the first success on a resource that has only ever been denied"*,
*"this request carries a query key no route has ever used"*. By construction they are absent from a
clean training window, which is precisely why they matter, and precisely why a density model fit on
normal-only data cannot use them.

This explains every event the model missed, and it is verifiable per event:

| Line | What it is | Blind feature that fired | Density verdict |
|---|---|---|---|
| 168336 | admin role-update | `is_admin` — fires on **1** of 22,982 March events | 0.578 < 0.648, missed |
| 168338 | confidential ZIP served after 77 prior denials | `first_200_after_denials` — fires on **1** of 22,982 | 0.618 < 0.648, missed |
| 168330–2 | CSRF probes | `unusual_query_key_count`, `status_other` | all three missed |

A feature that fires on one event in 22,982 is the most discriminative signal in the corpus. The model
could not see it.

We also confirmed a subsample defect in the same pass: `max_samples: auto` draws **256 rows per tree
out of 92,001**. At that subsample even features that do vary are rarely present in a tree's own
sample. Fixing it was a one-line change with a large effect.

And two features are redundant: `acct_req_5m_log1p` and `ip_req_5m_log1p` are identical on all 180,800
rows (Pearson r = 1.0000), because in this corpus each account maps to one address in normal traffic.
Effective rank of the 30-dimensional matrix is 18.

## 3. What we changed

**(a) Fit on the full partition.** `max_samples: auto` → `1.0` in `config/policy.yaml`. Fit cost went
from 0.14 s to 2.8 s.

**(b) A second detection channel: support novelty** — `backend/app/detection/novelty.py`.

For dimensions the density channel cannot reach, we score the thing that actually matters about them:
*did this value ever occur in training?* Zero inside the observed support, weighted outside, with the
weight set to the information content of a value unobserved in n draws, `log(n+2)`.

The score decomposes into one term per feature, so **every alert carries its own explanation** — which
the density channel's single scalar structurally cannot provide, and which feeds our existing typed-fact
provenance layer directly.

**The failure we hit on the way, because it is the interesting part.** The first version applied
range-based novelty to every dimension. It fired on **100% of the evaluation partition — 741 alerts per
day**. The cause: `acct_history_log1p` and `pair_rarity` are monotone counters. They grow as history
accumulates, so every future event sits above the training maximum. That is elapsed time, not anomaly.

The channel is therefore restricted to dimensions whose training distribution is a small finite value
set (`max_cardinality: 4`, which selects the binary indicators and rejects every counter and continuous
magnitude in the v1 vector). For those, "outside support" means "a value that never occurred", which
does not drift. The guard is asserted in `tests/unit/test_novelty.py`.

The two channels are thresholded independently and neither vetoes the other, matching how rules and the
model already coexist.

## 4. Results

March 2026 evaluation partition: 22,982 events, 20 positives from the frozen provisional inventory,
22,962 presumed-benign negatives. 2,000-resample bootstrap.

| Scorer | rank-AUC [95% CI] | AP [95% CI] | P@10 | P@20 | R@50 |
|---|---|---|---|---|---|
| naive rarity baseline | 0.8708 [0.7475, 0.9720] | 0.6375 [0.4089, 0.8344] | 1.00 | 0.65 | 0.65 |
| density (Isolation Forest) | 0.9974 [0.9945, 0.9993] | 0.6710 [0.4546, 0.8451] | 1.00 | 0.60 | 0.70 |
| support novelty | 0.9250 [0.8333, 1.0000] | 0.8080 [0.6165, 0.9566] | 0.90 | 0.85 | 0.85 |
| **two-channel sum** | **0.9985 [0.9959, 1.0000]** | **0.8561 [0.6878, 0.9853]** | **1.00** | **0.85** | **0.85** |

`max_samples` alone moved density rank-AUC from 0.9501 [0.9055, 0.9840] to 0.9974, and tightened the
interval by roughly 4×.

**Paired bootstrap on identical resample indices** — the only comparison that licenses a "beats" claim,
since with 20 positives the marginal intervals overlap even when the paired difference is one-signed:

| Comparison | Δ [95% CI] | Significant |
|---|---|---|
| two-channel − density, AP | **+0.1851 [+0.0480, +0.3565]** | **yes** |
| density − baseline, rank-AUC | +0.1266 [+0.0262, +0.2489] | yes |
| density − baseline, AP | +0.0335 [−0.0882, +0.1299] | **no** |

**We state the losing verdict first:** on average precision, the Isolation Forest does **not**
significantly beat a four-line sum of rarity features. It wins on ranking, not on top-of-list
precision. The two-channel detector is the only configuration whose improvement survives a paired test.

### Operating point

| Channel | Alerts | TP | FP | Precision | Recall | Burden |
|---|---|---|---|---|---|---|
| density @99.9 | 40 | 13/20 | 27 | 0.325 | 0.65 | 1.29/day |
| support novelty | 19 | 17/20 | 2 | 0.895 | 0.85 | 0.61/day |
| either channel | 44 | 17/20 | 27 | 0.386 | 0.85 | 1.42/day |

The novelty channel fired **0 times across the 59-day calibration window and 0 times across the 92,001
training rows** — it is completely silent on 136,000 events it was not meant to fire on, and produces
0.61 alerts/day during the month containing the intrusion.

### The two non-inventory alerts

The novelty channel raised 2 alerts not in our inventory: lines 168344 (`GET /dashboard` → 200) and
168346 (`GET /logout` → 302), both `sarah_j` from `10.0.8.45`, inside the takeover burst, within four
minutes of inventory lines on either side.

They look like attacker session activity our hand-built inventory omitted. **They are counted as false
positives in every figure above and the inventory was not widened.** Selecting labels from detector
output is how a self-graded exam becomes a fabricated one. If the inventory is ever widened it will be
by a rule written and committed first, with both label sets reported.

## 5. Ground truth — read this before using any number above

- The 20 positives are a **provisional analyst inventory** authored by this team
  (`tests/fixtures/known_sequence.json`), by forensic reading, **before** the rules were written.
- **There are no organizer labels.** These are a human judgement, not data that shipped with the corpus.
- March is a **chronological** partition that already informed rule design. It is **not a blind holdout**
  and we say so unprompted, in the emitted JSON, not only in prose.
- The 22,962 negatives are **presumed** benign, not verified benign.
- The same team authored the labels and the detector. Read the paired comparisons, not the marginals.

Label sensitivity is published rather than hidden: under the narrower 7-positive "rule-bearing lines
only" definition, two-channel AP is 0.4872 and rank-AUC 0.9998. The headline moves a lot with the label
definition, and a reader is entitled to see that.

## 6. Reproduction

The pipeline is deterministic. Retraining on a different OS from the one the original report was written
on reproduced every metric bit-identically (only row UUIDs differ).

```bash
python tasks.py db-up && python tasks.py migrate
python tasks.py import DATASET_PATH=./htn_challenge_logs_2026.txt
python -m scripts.run_replay --name causal-full          # causal feature snapshots, Aug–Mar
python -m ml.train --source-run <run-id> --model-id <id> # fits Sep–Dec, envelope + forest
python -m ml.calibrate --model-id <id> --percentile 99.9 --activate
python -m ml.evaluate  --model-id <id>                   # writes reports/evaluation_data.json
```

Note: `config_hash` covers model hyperparameters, so changing them stops `ml/train.py` from
auto-selecting a prior run. Pass `--source-run` explicitly. The feature schema is unchanged (`v1`), and
`pick_source_run` still asserts snapshot/feature-version agreement, which is the check that actually
protects correctness here.

## 7. Open items

Ranked by evidence gained per hour, carried forward into the next iteration:

1. **Wire the novelty channel into the live detector.** It currently exists in the ML layer only. Every
   run in the database is `model_health='rules_only'` with `model_score` NULL — the model has never
   scored an event inside the pipeline, while the demo script implies it has. This is the largest gap
   between what we claim and what runs.
2. **Provenance repair.** The committed report cites a model id and run ids that do not exist on disk.
   Every cited id must resolve, and `make reproduce` should regenerate the report from the committed
   artifact.
3. **Time-to-detection as the headline.** First alert at +13 s of event time; first high-risk at
   +36 h 17 m; 47.34 h of lead time before the confidential file was served. A batch scorer cannot
   define these, because it has no notion of a causal cutoff. This is our strongest axis and we do not
   currently lead with it.
4. **False-positive rate with a real denominator.** `tests/fixtures/synth.py` already generates fully
   labelled synthetic worlds; running 30 benign-only seeds gives a rate with a Wilson interval instead
   of an anecdote.
5. **Drop the duplicate dimension** (`ip_req_5m_log1p`) and re-measure. Requires a feature-version bump
   and a fresh replay, so it is sequenced after the items above.

## 8. What we are deliberately not doing

- No detector zoo. With 20 positives, average precision quantises to k/20 and a leaderboard of many
  scorers is entirely inside its own bootstrap interval. Two scorers plus the rules, compared with a
  paired test, is the most a corpus this size supports.
- No metric without a `ground_truth` record emitted beside it in the same JSON object.
- No relocating or softening the not-a-blind-holdout disclosure.
- No threshold, feature set, or scorer selected on the March partition.
- No operating point chosen by maximising against the labels being reported.
