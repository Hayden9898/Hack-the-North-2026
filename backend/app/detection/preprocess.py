"""Preprocessing stage in front of the Isolation Forest: a *training domain* fitted on the training partition only.

Why this exists. An Isolation Forest isolates points by drawing random split values between the minimum and maximum a
feature takes in the training sample. A feature that is constant across the whole training partition therefore never
receives a split: the forest is blind to it, whatever value it takes at inference. On the supplied dataset eight of the
thirty v1 features are constant on Sep–Dec — and they are precisely the attack indicators (`pair_unfamiliar`,
`first_200_after_denials`, `is_admin`, `unusual_query_key_count`, ...). Rescaling cannot help (the forest is invariant
to per-feature monotone linear maps, and a constant column stays constant), so the stage does two things instead:

1. It removes the blind-spot columns from the forest input, so random feature draws are not wasted on them and the
   manifest states exactly which features the forest can act on.
2. It records the constant each blind-spot feature held in training and, at inference, counts how many of them an
   incoming vector departs from. A departure is a value with **zero training support**: the strongest possible rarity
   evidence. The combined anomaly score is the forest score plus `BLIND_SPOT_PENALTY` per departure, which ranks every
   never-seen vector above every in-domain one (plain forest scores live in [0, 1]).

Out-of-range values on *varying* features are deliberately left to the forest: it handles them natively, and on this
dataset several rarity features drift monotonically as history accumulates, so a general range guard would fire on
every calibration row. The stage is a pure function of the training matrix, is pickled inside the artifact so training
and inference share one object (parity), and is described in the manifest for review. Percentiles derived from the
combined score remain rarity, never attack probability.
"""
from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.pipeline import Pipeline

PREPROCESSING_VERSION = "domain_v1"
BLIND_SPOT_PENALTY = 1.0  # per departed blind-spot feature; > max plain forest score, so never-seen always outranks seen
DOMAIN_STEP = "domain"
FOREST_STEP = "forest"


class TrainingDomain(BaseEstimator, TransformerMixin):  # type: ignore[misc]
    """Per-feature training support; drops constant (unlearnable) features and counts departures from them."""

    def __init__(self, feature_names: Sequence[str] | None = None, atol: float = 1e-12) -> None:
        self.feature_names = feature_names
        self.atol = atol

    # ------------------------------------------------------------------------------------------------- sklearn API
    def fit(self, X: Any, y: Any = None) -> TrainingDomain:
        X = self._as_matrix(X, check_width=False)
        names = tuple(self.feature_names) if self.feature_names is not None else tuple(f"f{i}" for i in range(X.shape[1]))
        if len(names) != X.shape[1]:
            raise ValueError(f"{len(names)} feature names for a matrix of width {X.shape[1]}")
        self.feature_names_in_ = names
        self.n_train_ = int(X.shape[0])
        self.lo_ = X.min(axis=0)
        self.hi_ = X.max(axis=0)
        self.blind_mask_ = (self.hi_ - self.lo_) <= self.atol
        self.blind_values_ = self.lo_[self.blind_mask_].copy()
        self.kept_idx_ = np.flatnonzero(~self.blind_mask_)
        self.blind_idx_ = np.flatnonzero(self.blind_mask_)
        if len(self.kept_idx_) == 0:
            raise ValueError("every feature is constant on the training matrix; nothing for the forest to learn")
        return self

    def transform(self, X: Any) -> np.ndarray:
        X = self._as_matrix(X)
        return X[:, self.kept_idx_]

    # ---------------------------------------------------------------------------------------------------- inference
    def violations(self, X: Any) -> np.ndarray:
        """Number of blind-spot features each row departs from (0 for every training and in-domain row)."""
        X = self._as_matrix(X)
        if len(self.blind_idx_) == 0:
            return np.zeros(X.shape[0], dtype=int)
        departed = np.abs(X[:, self.blind_idx_] - self.blind_values_) > self.atol
        return departed.sum(axis=1).astype(int)

    # -------------------------------------------------------------------------------------------------- description
    @property
    def kept_names(self) -> tuple[str, ...]:
        return tuple(self.feature_names_in_[i] for i in self.kept_idx_)

    @property
    def blind_names(self) -> tuple[str, ...]:
        return tuple(self.feature_names_in_[i] for i in self.blind_idx_)

    def describe(self) -> dict[str, Any]:
        """JSON-serialisable account of the fitted stage for the model manifest."""
        return {
            "version": PREPROCESSING_VERSION,
            "n_train_rows": self.n_train_,
            "atol": self.atol,
            "penalty_per_violation": BLIND_SPOT_PENALTY,
            "blind_spots": {n: float(v) for n, v in zip(self.blind_names, self.blind_values_.tolist(), strict=True)},
            "forest_features": list(self.kept_names),
            "training_support": {n: [float(self.lo_[i]), float(self.hi_[i])] for i, n in enumerate(self.feature_names_in_)},
        }

    # ------------------------------------------------------------------------------------------------------ helpers
    def _as_matrix(self, X: Any, check_width: bool = True) -> np.ndarray:
        M = np.asarray(X, dtype=float)
        if M.ndim == 1:
            M = M[None, :]
        if M.ndim != 2:
            raise ValueError("expected a vector or a 2-D matrix")
        if check_width and M.shape[1] != len(self.feature_names_in_):
            raise ValueError(f"vector width {M.shape[1]} does not match fitted width {len(self.feature_names_in_)}")
        if not np.all(np.isfinite(M)):
            raise ValueError("feature matrix contains NaN or inf")
        return M


def build_pipeline(forest: Any, feature_names: Sequence[str]) -> Pipeline:
    """Training domain followed by the forest; `score_samples` on the pipeline scores the pruned vector."""
    return Pipeline([(DOMAIN_STEP, TrainingDomain(feature_names=tuple(feature_names))), (FOREST_STEP, forest)])


def domain_of(estimator: Any) -> TrainingDomain | None:
    """The fitted preprocessing stage of an artifact, or None for a legacy plain-forest artifact."""
    if isinstance(estimator, Pipeline):
        step = estimator.named_steps.get(DOMAIN_STEP)
        if isinstance(step, TrainingDomain):
            return step
    return None


def anomaly_scores(estimator: Any, X: Any) -> np.ndarray:
    """Higher = rarer. Forest score (`-score_samples`) plus the blind-spot penalty when the artifact carries a domain.
    Accepts a single vector or a matrix; always returns a 1-D array with one score per row."""
    M = np.asarray(X, dtype=float)
    if M.ndim == 1:
        M = M[None, :]
    base = -estimator.score_samples(M)
    dom = domain_of(estimator)
    if dom is None:
        return np.asarray(base, dtype=float)
    return np.asarray(base, dtype=float) + BLIND_SPOT_PENALTY * dom.violations(M)
