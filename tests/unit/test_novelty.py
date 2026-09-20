"""Support-novelty channel: eligibility, silence on the fitted window, attribution, serialisation.

The two properties that make this channel safe to run next to the density model are that it is silent
on the distribution it was fitted to, and that it refuses to look at unbounded dimensions (where
"outside the observed range" means time has passed, not that something happened). Both are asserted.
"""
import numpy as np

from app.detection.novelty import SupportEnvelope, fit_envelope

NAMES = ("indicator", "status_flag", "counter", "magnitude")
VERSION = "vtest"


def _train() -> np.ndarray:
    """400 rows: two bounded dimensions, one monotone counter, one continuous magnitude."""
    n = 400
    return np.column_stack([
        np.zeros(n),                          # indicator: never fires in training
        np.tile([0.0, 1.0], n // 2),          # status_flag: both values observed
        np.arange(n, dtype=float),            # counter: monotone, 400 distinct values
        np.linspace(0.0, 10.0, n),            # magnitude: continuous
    ])


def _fit(max_cardinality: int = 4) -> SupportEnvelope:
    return fit_envelope(_train(), NAMES, VERSION, max_cardinality)


def test_only_bounded_dimensions_are_eligible():
    env = _fit()
    assert set(env.bounded_values) == {"indicator", "status_flag"}
    assert env.bounded_values["indicator"] == [0.0]
    assert env.bounded_values["status_flag"] == [0.0, 1.0]


def test_silent_on_every_row_of_the_window_it_was_fitted_to():
    """A channel that fires on its own training data is measuring drift, not novelty."""
    X = _train()
    env = fit_envelope(X, NAMES, VERSION, 4)
    assert env.score_matrix(X).sum() == 0.0
    assert all(env.score(row) == 0.0 for row in X)


def test_unseen_value_in_a_bounded_dimension_fires_with_attribution():
    env = _fit()
    row = [1.0, 0.0, 12.0, 3.0]  # indicator takes a value absent from training
    terms = env.terms(row)
    assert set(terms) == {"indicator"}
    assert terms["indicator"] == env.weight
    assert env.score(row) == env.weight


def test_observed_value_in_a_bounded_dimension_stays_silent():
    env = _fit()
    assert env.terms([0.0, 1.0, 9_999.0, 500.0]) == {}


def test_unbounded_dimensions_never_fire_however_far_out_of_range():
    """The monotone counter runs to 399 in training; 10**9 must still not be an alert.

    This is the guard for the failure mode that made the naive version useless: range-based novelty on
    a counter fires on every future event, because the counter only ever goes up.
    """
    env = _fit()
    assert env.score([0.0, 0.0, 1e9, 1e9]) == 0.0


def test_several_violated_dimensions_sum_and_each_is_attributed():
    env = _fit()
    terms = env.terms([1.0, 7.0, 0.0, 0.0])
    assert set(terms) == {"indicator", "status_flag"}
    assert env.score([1.0, 7.0, 0.0, 0.0]) == 2 * env.weight


def test_score_matrix_agrees_with_score_row_by_row():
    env = _fit()
    X = np.array([[0.0, 0.0, 1.0, 1.0], [1.0, 0.0, 2.0, 2.0], [1.0, 5.0, 3.0, 3.0]])
    assert list(env.score_matrix(X)) == [env.score(r) for r in X]


def test_cardinality_threshold_is_respected():
    """Raising the threshold admits more dimensions; lowering it admits fewer."""
    assert set(_fit(max_cardinality=1).bounded_values) == {"indicator"}
    assert set(_fit(max_cardinality=1000).bounded_values) == set(NAMES)


def test_weight_is_the_information_content_of_an_unobserved_value():
    env = _fit()
    assert env.weight == np.log(env.train_rows + 2.0)


def test_round_trip_through_dict_preserves_scoring():
    env = _fit()
    back = SupportEnvelope.from_dict(env.to_dict())
    assert back.bounded_values == env.bounded_values
    assert back.weight == env.weight
    row = [1.0, 0.0, 5.0, 5.0]
    assert back.score(row) == env.score(row)


def test_width_mismatch_is_rejected():
    try:
        fit_envelope(np.zeros((10, 3)), NAMES, VERSION, 4)
    except ValueError:
        return
    raise AssertionError("expected a ValueError when the matrix width does not match the schema")
