"""Preprocessing contract: the training domain is fitted on the training matrix only, drops features the forest
cannot learn (constant in training), counts departures from those blind spots at inference, and the combined score
ranks any never-seen value above every in-domain score. Legacy plain-forest artifacts keep working."""
from __future__ import annotations

import json

import joblib
import numpy as np
import pytest
from sklearn.ensemble import IsolationForest

from app.detection.preprocess import (
    BLIND_SPOT_PENALTY,
    PREPROCESSING_VERSION,
    TrainingDomain,
    anomaly_scores,
    build_pipeline,
    domain_of,
)

NAMES = ("varying_a", "varying_b", "flag_zero", "flag_one", "varying_c")


def _train(n: int = 400, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    X = np.zeros((n, 5))
    X[:, 0] = rng.normal(size=n)
    X[:, 1] = rng.exponential(size=n)
    X[:, 2] = 0.0  # blind spot: never non-zero in training
    X[:, 3] = 1.0  # blind spot with a non-zero constant
    X[:, 4] = rng.integers(0, 3, size=n)
    return X


def test_fit_identifies_blind_spots_and_keeps_varying_features():
    dom = TrainingDomain(feature_names=NAMES).fit(_train())
    assert dom.blind_names == ("flag_zero", "flag_one")
    assert dom.kept_names == ("varying_a", "varying_b", "varying_c")
    assert dom.n_train_ == 400
    assert dom.blind_values_.tolist() == [0.0, 1.0]


def test_transform_drops_blind_columns_and_validates_input():
    dom = TrainingDomain(feature_names=NAMES).fit(_train())
    Xt = dom.transform(_train(10, seed=1))
    assert Xt.shape == (10, 3)
    with pytest.raises(ValueError):
        dom.transform(np.zeros((2, 4)))  # wrong width
    bad = _train(3)
    bad[1, 0] = np.nan
    with pytest.raises(ValueError):
        dom.transform(bad)
    bad[1, 0] = np.inf
    with pytest.raises(ValueError):
        dom.transform(bad)


def test_violations_count_only_departures_from_blind_spots():
    dom = TrainingDomain(feature_names=NAMES).fit(_train())
    rows = _train(4, seed=2)
    rows[0, 0] = 50.0  # far outside the training range on a VARYING feature: the forest handles this, not the guard
    rows[1, 2] = 1.0  # one blind spot departs
    rows[2, 2] = 1.0
    rows[2, 3] = 0.0  # two blind spots depart
    assert dom.violations(rows).tolist() == [0, 1, 2, 0]
    assert dom.violations(rows[1]).tolist() == [1]  # single vector accepted


def test_fit_refuses_matrix_with_no_learnable_feature():
    with pytest.raises(ValueError):
        TrainingDomain(feature_names=("a", "b")).fit(np.ones((20, 2)))


def test_pipeline_score_is_forest_score_plus_penalty_per_violation():
    X = _train()
    pipe = build_pipeline(IsolationForest(n_estimators=50, random_state=1), NAMES).fit(X)
    dom = domain_of(pipe)
    assert dom is not None and dom.kept_names == ("varying_a", "varying_b", "varying_c")
    plain = IsolationForest(n_estimators=50, random_state=1).fit(X[:, [0, 1, 4]])
    probe = _train(50, seed=3)
    np.testing.assert_allclose(anomaly_scores(pipe, probe), -plain.score_samples(probe[:, [0, 1, 4]]))
    viol = probe.copy()
    viol[:, 2] = 1.0
    base = anomaly_scores(pipe, probe)
    got = anomaly_scores(pipe, viol)
    np.testing.assert_allclose(got, base + BLIND_SPOT_PENALTY)
    # Any never-seen value outranks every in-domain score (plain forest scores live in [0, 1]).
    assert got.min() > anomaly_scores(pipe, X).max()
    assert anomaly_scores(pipe, viol[0]).shape == (1,)


def test_anomaly_scores_accepts_legacy_plain_forest():
    X = _train()
    est = IsolationForest(n_estimators=20, random_state=0).fit(X)
    np.testing.assert_allclose(anomaly_scores(est, X[:5]), -est.score_samples(X[:5]))
    assert domain_of(est) is None


def test_pipeline_round_trips_through_joblib(tmp_path):
    X = _train()
    pipe = build_pipeline(IsolationForest(n_estimators=20, random_state=0), NAMES).fit(X)
    p = tmp_path / "pipe.joblib"
    joblib.dump(pipe, p)
    loaded = joblib.load(p)
    probe = _train(20, seed=4)
    probe[3, 3] = 0.0
    np.testing.assert_allclose(anomaly_scores(loaded, probe), anomaly_scores(pipe, probe))
    assert domain_of(loaded).blind_names == ("flag_zero", "flag_one")


def test_describe_is_json_serialisable_and_complete():
    dom = TrainingDomain(feature_names=NAMES).fit(_train())
    d = json.loads(json.dumps(dom.describe()))
    assert d["version"] == PREPROCESSING_VERSION
    assert d["penalty_per_violation"] == BLIND_SPOT_PENALTY
    assert d["blind_spots"] == {"flag_zero": 0.0, "flag_one": 1.0}
    assert d["forest_features"] == ["varying_a", "varying_b", "varying_c"]
    assert set(d["training_support"]) == set(NAMES) and d["n_train_rows"] == 400


# ----------------------------------------------------------------------------------------------- model adapter loading
# Every way an artifact can be unusable must surface as ModelLoadError: the detector catches exactly that and degrades
# to rules-only instead of blocking the run.

import pickle  # noqa: E402

import sklearn  # noqa: E402

from app.config import load_config  # noqa: E402
from app.detection.model import ModelLoadError, feature_config_hash, load_model, sha256_path  # noqa: E402
from app.features.vector import FEATURE_NAMES, FEATURE_VERSION  # noqa: E402
from app.settings import REPO_ROOT  # noqa: E402


class _Plain:
    """Picklable stand-in whose module name we corrupt to make the pickle reference a module that does not exist."""


def _write_artifact(tmp_path, model_id: str, payload: bytes, **manifest_overrides):
    d = tmp_path / model_id
    d.mkdir()
    art = d / "isolation_forest.joblib"
    art.write_bytes(payload)
    (d / "calibration_scores.json").write_text(json.dumps([0.1, 0.2, 0.3]))
    manifest = {
        "generator": "logorder.ml.train", "model_id": model_id, "feature_version": FEATURE_VERSION, "feature_names": list(FEATURE_NAMES),
        "artifact_file": art.name, "artifact_sha256": sha256_path(art), "calibration_scores_file": "calibration_scores.json",
        "threshold": 0.25, "dependencies": {"scikit-learn": sklearn.__version__},
    }
    manifest.update(manifest_overrides)
    for k in [k for k, v in manifest.items() if v is _DROP]:
        del manifest[k]
    (d / "manifest.json").write_text(json.dumps(manifest))
    return manifest


_DROP = object()


def _forest_bytes() -> bytes:
    rng = np.random.default_rng(0)
    est = IsolationForest(n_estimators=5, random_state=0).fit(rng.normal(size=(30, len(FEATURE_NAMES))))
    return pickle.dumps(est)


def _unloadable_bytes() -> bytes:
    payload = pickle.dumps(_Plain())
    assert b"test_preprocess" in payload
    return payload.replace(b"test_preprocess", b"test_missingmod")  # same length keeps the pickle frame valid


def test_load_model_hash_valid_but_unpicklable_artifact_is_a_load_error(tmp_path):
    _write_artifact(tmp_path, "m_bad_pickle", _unloadable_bytes())
    with pytest.raises(ModelLoadError, match="artifact unloadable: ModuleNotFoundError"):
        load_model(tmp_path, "m_bad_pickle")


def test_load_model_manifest_missing_key_is_a_load_error(tmp_path):
    _write_artifact(tmp_path, "m_no_file_key", _forest_bytes(), artifact_file=_DROP)
    with pytest.raises(ModelLoadError, match="artifact_file"):
        load_model(tmp_path, "m_no_file_key")
    _write_artifact(tmp_path, "m_no_cal_key", _forest_bytes(), calibration_scores_file=_DROP)
    with pytest.raises(ModelLoadError, match="calibration_scores_file"):
        load_model(tmp_path, "m_no_cal_key")
    (tmp_path / "m_garbage").mkdir()
    (tmp_path / "m_garbage" / "manifest.json").write_text("{not json")
    with pytest.raises(ModelLoadError, match="manifest unreadable"):
        load_model(tmp_path, "m_garbage")


def test_load_model_numpy_version_checked_only_when_declared(tmp_path):
    _write_artifact(tmp_path, "m_np_ok", _forest_bytes(), dependencies={"scikit-learn": sklearn.__version__, "numpy": np.__version__})
    assert load_model(tmp_path, "m_np_ok").threshold == 0.25
    _write_artifact(tmp_path, "m_np_old", _forest_bytes(), dependencies={"scikit-learn": sklearn.__version__, "numpy": "0.0.1"})
    with pytest.raises(ModelLoadError, match="numpy version mismatch"):
        load_model(tmp_path, "m_np_old")
    _write_artifact(tmp_path, "m_np_absent", _forest_bytes())  # older manifests: no numpy key, no check
    assert load_model(tmp_path, "m_np_absent").model_id == "m_np_absent"


def test_load_model_refuses_different_feature_configuration(tmp_path):
    cfg = load_config(REPO_ROOT / "config")
    _write_artifact(tmp_path, "m_fch_ok", _forest_bytes(), feature_config_hash=feature_config_hash(cfg))
    assert load_model(tmp_path, "m_fch_ok", cfg=cfg).model_id == "m_fch_ok"
    _write_artifact(tmp_path, "m_fch_other", _forest_bytes(), feature_config_hash="0" * 64)
    with pytest.raises(ModelLoadError, match="different feature configuration"):
        load_model(tmp_path, "m_fch_other", cfg=cfg)
    _write_artifact(tmp_path, "m_fch_absent", _forest_bytes())  # older artifacts carry no hash: skip the check
    assert load_model(tmp_path, "m_fch_absent", cfg=cfg).model_id == "m_fch_absent"


def test_feature_config_hash_tracks_only_feature_relevant_config():
    import copy
    from dataclasses import replace

    cfg = load_config(REPO_ROOT / "config")
    base = feature_config_hash(cfg)
    rules_tweak = copy.deepcopy(cfg.policy)
    rules_tweak["rules"]["R1"]["window_seconds"] = int(rules_tweak["rules"]["R1"]["window_seconds"]) + 1
    assert feature_config_hash(replace(cfg, policy=rules_tweak)) == base  # rule thresholds do not change the vector
    feat_tweak = copy.deepcopy(cfg.policy)
    feat_tweak["features"]["cold_start_events"] = int(feat_tweak["features"]["cold_start_events"]) + 1
    assert feature_config_hash(replace(cfg, policy=feat_tweak)) != base
    routes_tweak = replace(cfg.routes, raw={**cfg.routes.raw, "version": cfg.routes.version + 1})
    assert feature_config_hash(replace(cfg, routes=routes_tweak)) != base
