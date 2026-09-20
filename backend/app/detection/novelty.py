"""Support-novelty channel: the signal a density model fit on normal-only data structurally cannot carry.

Why this exists
---------------
An Isolation Forest partitions the training distribution. A feature that never varies in the training
window therefore receives no split in any tree, and no value it takes at inference can move the score —
the dimension is not weakly used, it is *unreachable*. Measured on the v1 vector over the Sep–Dec train
partition, 8 of 30 features had zero variance and accordingly zero splits across all 200 trees at every
subsample size tried: `pair_unfamiliar`, `reference_unknown`, `first_200_after_denials`, `is_admin`,
`status_other`, `unusual_query_key_count`, `bytes_reference_missing`, `cold_start`.

Those are precisely the forensic indicators. "This account has never been seen from this address",
"this is the first success on a resource that has only ever been denied", "this request carries a query
key no route has ever used" — each is, by construction, absent from a clean training window, so the
density channel is blind to exactly the evidence that matters most.

This module scores those dimensions directly: how far outside the *observed training support* does this
value lie? Zero inside the support, weighted outside. Because the score decomposes into one term per
feature, every alert carries its own explanation, which the density channel's scalar cannot provide.

Why only bounded dimensions
---------------------------
Range-based novelty is meaningless for a monotone counter. `acct_history_log1p` and `pair_rarity` grow
as history accumulates, so *every* future event sits above the training maximum: applied naively, the
channel fired on 100% of the evaluation partition (741 alerts/day) — that is temporal drift, not
anomaly. The channel is therefore restricted to dimensions whose training distribution is a small finite
value set (indicator-like, `max_cardinality` distinct values or fewer). For those, "outside support"
means "a value that never occurred", which does not drift. Unbounded dimensions stay with the density
channel, where relative position is the meaningful quantity.

The envelope is fitted on the training partition only and frozen into the model artifact, exactly like
the density estimator's threshold. It never sees calibration or evaluation data.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from math import log
from typing import Any

import numpy as np

# Values are compared after rounding to this many decimals so that float round-trips through JSON and
# through the numeric_vector column cannot manufacture a spurious "never observed" verdict.
QUANTUM = 9


@dataclass(frozen=True)
class SupportEnvelope:
    """Observed training support for the bounded dimensions of one feature schema."""

    feature_version: str
    feature_names: tuple[str, ...]
    train_rows: int
    max_cardinality: int
    # feature name -> sorted list of the distinct values observed in training
    bounded_values: dict[str, list[float]] = field(default_factory=dict)

    @property
    def weight(self) -> float:
        """Information content of a value not observed in `train_rows` draws.

        A value absent from n independent observations has rate at most ~3/n at 95% confidence
        (rule of three), so -log of a Laplace-smoothed rate of 1/(n+2) is the natural per-dimension
        weight. It is identical across dimensions by design: this channel asserts "never seen", and
        one never-seen indicator is not more surprising than another.
        """
        return log(self.train_rows + 2.0)

    @property
    def bounded_indices(self) -> tuple[int, ...]:
        idx = {n: i for i, n in enumerate(self.feature_names)}
        return tuple(idx[n] for n in self.bounded_values if n in idx)

    def terms(self, vector: list[float] | np.ndarray) -> dict[str, float]:
        """Per-feature novelty contributions, non-zero entries only. This is the explanation."""
        out: dict[str, float] = {}
        w = self.weight
        for i, name in enumerate(self.feature_names):
            observed = self.bounded_values.get(name)
            if observed is None:
                continue
            if round(float(vector[i]), QUANTUM) not in observed:
                out[name] = w
        return out

    def score(self, vector: list[float] | np.ndarray) -> float:
        return float(sum(self.terms(vector).values()))

    def score_matrix(self, X: np.ndarray) -> np.ndarray:
        """Vectorised scoring for a whole partition; matches `score` row for row."""
        total = np.zeros(X.shape[0], dtype=float)
        idx = {n: i for i, n in enumerate(self.feature_names)}
        for name, observed in self.bounded_values.items():
            i = idx.get(name)
            if i is None:
                continue
            allowed = np.asarray(observed, dtype=float)
            col = np.round(X[:, i].astype(float), QUANTUM)
            total += self.weight * (~np.isin(col, allowed)).astype(float)
        return total

    def to_dict(self) -> dict[str, Any]:
        return {
            "feature_version": self.feature_version,
            "feature_names": list(self.feature_names),
            "train_rows": self.train_rows,
            "max_cardinality": self.max_cardinality,
            "bounded_values": {k: list(v) for k, v in self.bounded_values.items()},
            "weight": self.weight,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> SupportEnvelope:
        return cls(
            feature_version=str(d["feature_version"]),
            feature_names=tuple(d["feature_names"]),
            train_rows=int(d["train_rows"]),
            max_cardinality=int(d["max_cardinality"]),
            bounded_values={k: [float(x) for x in v] for k, v in d["bounded_values"].items()},
        )


def fit_envelope(X: np.ndarray, feature_names: tuple[str, ...], feature_version: str, max_cardinality: int) -> SupportEnvelope:
    """Record the observed value set of every bounded dimension of the training matrix.

    A dimension is *bounded* when it takes at most `max_cardinality` distinct values in training. That
    test deliberately selects indicator-like features and rejects counters and continuous magnitudes,
    for which "outside the observed range" is a statement about elapsed time rather than about the event.
    """
    if X.ndim != 2 or X.shape[1] != len(feature_names):
        raise ValueError("matrix width does not match the feature schema")
    bounded: dict[str, list[float]] = {}
    for i, name in enumerate(feature_names):
        vals = np.unique(np.round(X[:, i].astype(float), QUANTUM))
        if len(vals) <= max_cardinality:
            bounded[name] = [float(v) for v in vals]
    return SupportEnvelope(
        feature_version=feature_version,
        feature_names=tuple(feature_names),
        train_rows=int(X.shape[0]),
        max_cardinality=int(max_cardinality),
        bounded_values=bounded,
    )
