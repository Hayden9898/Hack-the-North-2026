"""Ranking metrics with uncertainty, for a detector scored against a named, provisional label set.

Every function here takes the positives as an explicit argument and none of them knows where those
positives came from. That separation is deliberate: the caller is required to emit a `ground_truth`
provenance record next to any number produced here (who derived the labels, when, from what, and how
many negatives are merely *presumed* benign rather than verified). A metric without that record is a
claim about an answer key, not about a detector.

Accuracy is not offered. At a 0.087% base rate a detector that never alerts scores 99.913%.
"""
from __future__ import annotations

from collections.abc import Callable

import numpy as np
from sklearn.metrics import average_precision_score, roc_auc_score


def rank_auc(scores: np.ndarray, y: np.ndarray) -> float:
    """P(a random positive outranks a random negative). Insensitive to the base rate."""
    return float(roc_auc_score(y, scores))


def average_precision(scores: np.ndarray, y: np.ndarray) -> float:
    """Area under precision-recall. Base-rate sensitive, so it is the honest headline here."""
    return float(average_precision_score(y, scores))


def precision_at_k(scores: np.ndarray, y: np.ndarray, k: int) -> float:
    k = min(k, len(y))
    return float(y[np.argsort(-scores)][:k].sum() / k)


def recall_at_k(scores: np.ndarray, y: np.ndarray, k: int) -> float:
    k = min(k, len(y))
    n = int(y.sum())
    return float(y[np.argsort(-scores)][:k].sum() / n) if n else float("nan")


def confusion(flagged: np.ndarray, y: np.ndarray) -> dict[str, int | float]:
    tp = int((flagged & (y == 1)).sum())
    fp = int((flagged & (y == 0)).sum())
    fn = int((~flagged & (y == 1)).sum())
    tn = int((~flagged & (y == 0)).sum())
    return {
        "alerts": tp + fp, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": round(tp / (tp + fp), 4) if tp + fp else float("nan"),
        "recall": round(tp / (tp + fn), 4) if tp + fn else float("nan"),
    }


def bootstrap_ci(metric: Callable[[np.ndarray, np.ndarray], float], scores: np.ndarray, y: np.ndarray,
                 resamples: int = 2000, seed: int = 42) -> dict[str, float]:
    """Percentile bootstrap over events. Resamples that lose every positive are skipped, not counted.

    With 20 positives the interval is wide by construction; that is the point of reporting it.
    """
    rng = np.random.default_rng(seed)
    n = len(y)
    vals: list[float] = []
    for _ in range(resamples):
        idx = rng.integers(0, n, n)
        yy = y[idx]
        if yy.sum() == 0 or yy.sum() == n:
            continue
        vals.append(metric(scores[idx], yy))
    if not vals:
        return {"point": float("nan"), "ci_lo": float("nan"), "ci_hi": float("nan"), "resamples": 0}
    lo, hi = np.percentile(vals, [2.5, 97.5])
    return {"point": round(metric(scores, y), 4), "ci_lo": round(float(lo), 4), "ci_hi": round(float(hi), 4),
            "resamples": len(vals)}


def paired_bootstrap_diff(metric: Callable[[np.ndarray, np.ndarray], float], a: np.ndarray, b: np.ndarray,
                          y: np.ndarray, resamples: int = 2000, seed: int = 42) -> dict[str, float | bool]:
    """CI on metric(a) - metric(b) using identical resample indices for both scorers.

    Comparing two marginal intervals by eye is the standard way to claim a difference that is not there:
    with few positives the marginals overlap even when the paired difference is consistently one-signed.
    Only this interval licenses a "beats" claim, so only this one is reported.
    """
    rng = np.random.default_rng(seed)
    n = len(y)
    diffs: list[float] = []
    for _ in range(resamples):
        idx = rng.integers(0, n, n)
        yy = y[idx]
        if yy.sum() == 0 or yy.sum() == n:
            continue
        diffs.append(metric(a[idx], yy) - metric(b[idx], yy))
    if not diffs:
        return {"point": float("nan"), "ci_lo": float("nan"), "ci_hi": float("nan"), "significant": False, "resamples": 0}
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    return {"point": round(metric(a, y) - metric(b, y), 4), "ci_lo": round(float(lo), 4),
            "ci_hi": round(float(hi), 4), "significant": bool(lo > 0 or hi < 0), "resamples": len(diffs)}


def rule_of_three_upper_bound(observed_false_positives: int, negatives: int) -> float | None:
    """95% upper bound on a rate after observing zero events in `negatives` trials (3/n).

    Only defined for a zero observation; returns None otherwise so a non-zero count cannot be dressed
    up as a bound. The negatives it is computed over are presumed benign, not verified benign.
    """
    if observed_false_positives != 0 or negatives <= 0:
        return None
    return 3.0 / negatives


def summarise(scores: np.ndarray, y: np.ndarray, budgets: tuple[int, ...] = (10, 20, 50, 100),
              resamples: int = 2000, seed: int = 42) -> dict:
    return {
        "rank_auc": bootstrap_ci(rank_auc, scores, y, resamples, seed),
        "average_precision": bootstrap_ci(average_precision, scores, y, resamples, seed),
        "precision_at_k": {str(k): round(precision_at_k(scores, y, k), 4) for k in budgets},
        "recall_at_k": {str(k): round(recall_at_k(scores, y, k), 4) for k in budgets},
    }
