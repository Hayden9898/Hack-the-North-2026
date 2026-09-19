"""M01–M04: train/inference parity with a pinned artifact, familiarity never from failures, degraded mode, cold start."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path

import joblib
import numpy as np
import pytest
import sklearn
from ml.common import sha256_file
from sklearn.ensemble import IsolationForest
from tests.fixtures.synth import TZ, baseline_traffic, default_world, scenario_auth_burst
from tests.helpers import drive, import_world, make_config, q, start_run

from app.db.engine import connect_direct, jsonb
from app.detection.model import ModelLoadError, load_model
from app.features.reference import build_reference
from app.features.vector import FEATURE_NAMES, FEATURE_VERSION
from app.settings import get_settings

pytestmark = pytest.mark.integration
D0 = date(2025, 1, 6)


def _cfg(tmp_path):
    return make_config(tmp_path, bootstrap=(D0, D0 + timedelta(days=10)), train=(D0 + timedelta(days=10), D0 + timedelta(days=16)),
                       calibration=(D0 + timedelta(days=16), D0 + timedelta(days=22)), evaluation=(D0 + timedelta(days=22), D0 + timedelta(days=40)))


def _write_artifact(model_dir: Path, model_id: str, est, cal_scores, reference_hash, threshold, *, corrupt=False, wrong_schema=False) -> dict:
    d = model_dir / model_id
    d.mkdir(parents=True)
    art = d / "isolation_forest.joblib"
    joblib.dump(est, art)
    (d / "calibration_scores.json").write_text(json.dumps([float(x) for x in cal_scores]))
    manifest = {
        "generator": "logorder.ml.train", "model_id": model_id, "feature_version": FEATURE_VERSION,
        "feature_names": list(FEATURE_NAMES) if not wrong_schema else list(FEATURE_NAMES)[:-1],
        "artifact_file": art.name, "artifact_sha256": sha256_file(art), "calibration_scores_file": "calibration_scores.json",
        "threshold": threshold, "reference_hash": reference_hash, "dependencies": {"scikit-learn": sklearn.__version__},
    }
    if corrupt:
        art.write_bytes(b"not a model")
    (d / "manifest.json").write_text(json.dumps(manifest))
    return manifest


def _register(db, manifest, status="active"):
    with connect_direct(db) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO models (model_id, feature_version, artifact_path, artifact_sha256, reference_hash, threshold, manifest, status) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (manifest["model_id"], FEATURE_VERSION, manifest["artifact_file"], manifest["artifact_sha256"], manifest["reference_hash"], manifest["threshold"], jsonb(manifest), status),
        )
        conn.commit()


@pytest.fixture
def model_dir(tmp_path, monkeypatch):
    d = tmp_path / "models"
    d.mkdir()
    monkeypatch.setattr(get_settings(), "model_dir", str(d))
    return d


def test_m01_m03_parity_shadow_and_degraded_modes(db, tmp_path, model_dir):
    cfg = _cfg(tmp_path)
    w = default_world(start=datetime(D0.year, D0.month, D0.day, tzinfo=TZ))
    baseline_traffic(w, 30)
    burst_t = datetime(D0.year, D0.month, D0.day, tzinfo=TZ) + timedelta(days=23, hours=23)
    scenario_auth_burst(w, burst_t, victim=w.accounts[0], source_ip="192.168.10.200", n=4)
    ds = import_world(w, tmp_path, db)

    # Rules-only causal pass provides training snapshots (exactly what ml.train does).
    r0 = start_run(db, cfg, ds)
    drive(db, cfg, r0)
    ref_hash = q(db, "select config->>'reference_hash' h from runs where run_id=%s", r0)[0]["h"]
    train = np.asarray([r["numeric_vector"] for r in q(db, "select numeric_vector from feature_snapshots where run_id=%s and event_time >= %s and event_time < %s order by run_seq", r0, cfg.partitions["train"].start, cfg.partitions["train"].end_exclusive)])
    cal = np.asarray([r["numeric_vector"] for r in q(db, "select numeric_vector from feature_snapshots where run_id=%s and event_time >= %s and event_time < %s order by run_seq", r0, cfg.partitions["calibration"].start, cfg.partitions["calibration"].end_exclusive)])
    est = IsolationForest(n_estimators=50, random_state=42).fit(train)
    cal_scores = -est.score_samples(cal)
    threshold = float(np.percentile(cal_scores, 99.5))

    good = _write_artifact(model_dir, "m_good", est, cal_scores, ref_hash, threshold)
    _register(db, good)
    r1 = start_run(db, cfg, ds, model_id="m_good")
    run1 = drive(db, cfg, r1)
    assert run1["model_health"] == "active" and run1["state"] == "completed"
    # M01: stored scores equal re-scoring the stored vectors with the pinned artifact; identical across runs.
    rows = q(db, "select d.run_seq, d.model_score, d.anomaly_percentile, f.numeric_vector from detections d join feature_snapshots f using (run_id, run_seq) where d.run_id=%s order by d.run_seq limit 500", r1)
    loaded = load_model(model_dir, "m_good", expected_reference_hash=ref_hash)
    for r in rows:
        assert r["model_score"] == pytest.approx(loaded.score(r["numeric_vector"]), abs=1e-9)
        assert 0 <= r["anomaly_percentile"] <= 100
    vec0 = q(db, "select numeric_vector from feature_snapshots where run_id=%s order by run_seq", r0)
    vec1 = q(db, "select numeric_vector from feature_snapshots where run_id=%s order by run_seq", r1)
    assert vec0 == vec1  # training features == inference features, event by event
    # Independence: the R1 rule fires regardless of the score; model flags are at most 'suspicious'.
    assert q(db, "select count(*) n from rule_matches where run_id=%s and rule_id='R1'", r1)[0]["n"] == 1
    assert q(db, "select count(*) n from detections where run_id=%s and model_flagged and threat_class='high_risk' and cardinality(rule_ids)=0", r1)[0]["n"] == 0
    flagged = q(db, "select count(*) n from detections where run_id=%s and model_flagged", r1)[0]["n"]
    assert flagged > 0
    assert q(db, "select count(*) n from detections where run_id=%s and model_flagged and cardinality(rule_ids)=0 and threat_class<>'suspicious'", r1)[0]["n"] == 0
    assert all("model:anomaly_above_threshold" in r["reason_codes"] for r in q(db, "select reason_codes from detections where run_id=%s and model_flagged", r1))

    # Shadow mode: scored and stored but never classifies.
    with connect_direct(db) as conn, conn.cursor() as cur:
        cur.execute("UPDATE models SET status='shadow' WHERE model_id='m_good'")
        conn.commit()
    r2 = start_run(db, cfg, ds, model_id="m_good")
    run2 = drive(db, cfg, r2)
    assert run2["model_health"] == "shadow"
    assert q(db, "select count(*) n from detections where run_id=%s and model_score is not null", r2)[0]["n"] == run2["processed_seq"]
    assert q(db, "select count(*) n from detections where run_id=%s and model_flagged", r2)[0]["n"] == 0
    assert q(db, "select count(*) n from detections where run_id=%s and threat_class='suspicious'", r2)[0]["n"] == 1  # the rule still fires

    # M03: corrupted artifact → degraded, scores null, rules still fire; schema mismatch is refused at load.
    bad = _write_artifact(model_dir, "m_bad", est, cal_scores, ref_hash, threshold, corrupt=True)
    _register(db, bad)
    r3 = start_run(db, cfg, ds, model_id="m_bad")
    run3 = drive(db, cfg, r3)
    assert run3["state"] == "completed" and run3["model_health"] == "degraded"
    assert q(db, "select count(*) n from detections where run_id=%s and model_score is not null", r3)[0]["n"] == 0
    assert q(db, "select count(*) n from detections where run_id=%s and model_health<>'degraded'", r3)[0]["n"] == 0
    assert q(db, "select count(*) n from rule_matches where run_id=%s and rule_id='R1'", r3)[0]["n"] == 1
    wrong = _write_artifact(model_dir, "m_schema", est, cal_scores, ref_hash, threshold, wrong_schema=True)
    with pytest.raises(ModelLoadError):
        load_model(model_dir, "m_schema")
    with pytest.raises(ModelLoadError):
        load_model(model_dir, "m_good", expected_reference_hash="different-reference")
    with pytest.raises(ModelLoadError):
        load_model(model_dir, "../m_good")
    assert wrong["feature_names"] != list(FEATURE_NAMES)


def test_m02_repeated_failures_never_become_familiar(db, tmp_path):
    cfg = _cfg(tmp_path)
    w = default_world(start=datetime(D0.year, D0.month, D0.day, tzinfo=TZ))
    baseline_traffic(w, 12)
    # During bootstrap an attacker IP fails 40 times over 6 dates against acct_1; one success from acct_1's home IP.
    for d in range(6):
        for i in range(7):
            w.emit(w.start + timedelta(days=d, hours=2, minutes=i), "192.168.10.250", w.accounts[0], "POST", "/api/auth/login", 401, 88)
    ds = import_world(w, tmp_path, db)
    with connect_direct(db) as conn:
        ref = build_reference(conn, ds, cfg)
    assert "192.168.10.250" not in ref.familiar_pairs.get(w.accounts[0], [])
    assert ref.pair_familiar(w.accounts[0], w.ips[w.accounts[0]])
    assert ref.familiarity(w.accounts[0], "192.168.10.250") == "unfamiliar"
    assert f"{w.accounts[0]}|192.168.10.250" not in ref.pair_support  # only login 200s count as support


def test_m04_new_account_without_bootstrap_is_unknown_not_high_risk(db, tmp_path):
    cfg = _cfg(tmp_path)
    w = default_world(start=datetime(D0.year, D0.month, D0.day, tzinfo=TZ))
    baseline_traffic(w, 30)
    newcomer, nip = "acct_new", "192.168.10.99"
    t0 = datetime(D0.year, D0.month, D0.day, tzinfo=TZ) + timedelta(days=24, hours=9)
    w.emit(t0, nip, newcomer, "POST", "/api/auth/login", 200, 128)
    w.emit(t0 + timedelta(seconds=3), nip, newcomer, "GET", "/dashboard", 200, 2048)
    w.emit(t0 + timedelta(minutes=2), nip, newcomer, "GET", w.sensitive_paths[0], 200, 8459200)
    ds = import_world(w, tmp_path, db)
    rid = start_run(db, cfg, ds)
    drive(db, cfg, rid)
    rows = q(db, "select d.threat_class, f.observed_context from detections d join feature_snapshots f using (run_id, run_seq) join processed_events p using (run_id, run_seq) where d.run_id=%s and p.username=%s order by d.run_seq", rid, newcomer)
    assert len(rows) == 3
    assert all(r["observed_context"]["familiarity"] == "reference_unknown" and r["observed_context"]["cold_start"] for r in rows)
    assert all(r["threat_class"] != "high_risk" for r in rows)
    assert q(db, "select count(*) n from rule_matches where run_id=%s and rule_id in ('R4','R2')", rid)[0]["n"] == 0
