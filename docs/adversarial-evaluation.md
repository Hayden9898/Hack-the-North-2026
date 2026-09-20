# Adversarial evaluation gate

This repository includes a seeded, generic behavior matrix that exercises the **same importer, replay controller,
detector, rules, correlation and incident persistence** used by the application. It is an engineering regression gate;
it is not a measure of CSE-dataset detection accuracy, real-world recall, precision, or model performance.

## What it guards

The current matrix covers a routine control plus policy boundaries for:

- R1 rapid unfamiliar credential guessing;
- R6 slow credential guessing, including its one-hour boundary and non-duplication with R1;
- R2 denial-to-first-success access change and the prior-success counterfactual;
- R3 forum-view-to-admin transition and its 60-second boundary;
- R4 escalation after a rapid or slow authentication episode, and the login-window boundary.
- R5 cross-account, object-linked escalation without a single over-merged incident.

Every case uses generic account names, IP ranges, dates, objects and synthetic background traffic. The detector has no
knowledge of these fixtures. A case passes only if rule-match counts, grouped-incident count, high-risk count and
time-to-first-alert equal the specified contract. This catches both missed detections and unwanted alert burden in the
control/boundary cases.

## Run it safely

The evaluator truncates only the dedicated database target. It refuses any target that is not a loopback `*_test`
database distinct from `DATABASE_URL`.

```bash
TEST_DATABASE_URL=postgresql://logorder:logorder@127.0.0.1:5433/logorder_test \
  python tasks.py adversarial-evaluate OUT=reports/adversarial_evaluation.json
```

The test suite runs the identical matrix as `tests/integration/test_adversarial_matrix.py`. The JSON receipt is
generated only after an actual run; it is intentionally ignored from source control. It records expectations,
observations and pass/fail per scenario so a demo never needs to substitute a screenshot or an unexecuted claim.

## Interpretation

This gate complements—but never replaces—the source-dataset acceptance run. It does not use organizer labels,
competitor cases, or the known CSE sequence. A green result establishes only that this policy behaves as specified on
these declared generic mutations. Before claiming model quality or real alert burden, recover the full authorized
dataset and run a sealed chronological evaluation with its source hash, code commit, policy/model hashes and reviewed
outcomes recorded.
