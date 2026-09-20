"""Every run scores with rules and the newest active model. Rules-only happens only when no model is active."""
from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from tests.fixtures.synth import TZ, baseline_traffic, default_world
from tests.helpers import import_world, make_config, q

from app.api.main import create_app
from app.db.engine import connect_direct, jsonb
from app.settings import get_settings
from app.workers import runs as runs_mod

pytestmark = pytest.mark.integration

D0 = date(2025, 1, 6)


def _cfg(tmp_path):
    return make_config(
        tmp_path,
        bootstrap=(D0, D0 + timedelta(days=10)),
        train=(D0 + timedelta(days=10), D0 + timedelta(days=16)),
        calibration=(D0 + timedelta(days=16), D0 + timedelta(days=22)),
        evaluation=(D0 + timedelta(days=22), D0 + timedelta(days=40)),
    )


def _dataset(db, tmp_path) -> str:
    w = default_world(start=datetime(D0.year, D0.month, D0.day, tzinfo=TZ))
    baseline_traffic(w, 5)
    return import_world(w, tmp_path, db)


def _register(db: str, model_id: str, status: str, created_at: datetime) -> None:
    with connect_direct(db) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO models (model_id, feature_version, artifact_path, artifact_sha256, threshold, manifest, status, created_at)
                   VALUES (%s, 'v1', %s, 'deadbeef', 0.5, %s, %s, %s)""",
                (model_id, f"{model_id}/isolation_forest.joblib", jsonb({"model_id": model_id}), status, created_at),
            )
        conn.commit()


def test_create_run_uses_newest_active_model_by_default(db, tmp_path):
    cfg = _cfg(tmp_path)
    ds = _dataset(db, tmp_path)
    t0 = datetime(2025, 1, 1, tzinfo=TZ)
    _register(db, "m_old_active", "active", t0)
    _register(db, "m_new_active", "active", t0 + timedelta(hours=1))
    _register(db, "m_candidate", "candidate", t0 + timedelta(hours=2))
    _register(db, "m_shadow", "shadow", t0 + timedelta(hours=3))
    with connect_direct(db) as conn:
        assert runs_mod.active_model_id(conn) == "m_new_active"
        run = runs_mod.create_run(conn, cfg, dataset_id=ds)
        explicit = runs_mod.create_run(conn, cfg, dataset_id=ds, model_id="m_candidate")
        conn.commit()
    assert (run["model_id"], run["model_health"]) == ("m_new_active", "pending_load")
    assert (explicit["model_id"], explicit["model_health"]) == ("m_candidate", "pending_load")


def test_create_run_falls_back_to_rules_only_when_no_active_model(db, tmp_path):
    cfg = _cfg(tmp_path)
    ds = _dataset(db, tmp_path)
    _register(db, "m_candidate", "candidate", datetime(2025, 1, 1, tzinfo=TZ))
    with connect_direct(db) as conn:
        assert runs_mod.active_model_id(conn) is None
        run = runs_mod.create_run(conn, cfg, dataset_id=ds)
        conn.commit()
    assert (run["model_id"], run["model_health"]) == (None, "rules_only")


@pytest.fixture
def client(db, tmp_path, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "database_url", db)
    monkeypatch.setattr(s, "config_dir", str(tmp_path / "config"))
    monkeypatch.setattr(s, "upload_dir", str(tmp_path / "uploads"))
    from app.config import get_config

    get_config.cache_clear()
    with TestClient(create_app()) as c:
        yield c
    get_config.cache_clear()


def test_api_defaults_to_active_model_and_lists_models(client, db, tmp_path):
    _cfg(tmp_path)
    ds = _dataset(db, tmp_path)
    _register(db, "m_active", "active", datetime(2025, 1, 1, tzinfo=TZ))

    models = client.get("/api/v1/models").json()
    assert [m["model_id"] for m in models] == ["m_active"]
    assert models[0]["status"] == "active" and models[0]["artifact_present"] is False

    r = client.post("/api/v1/runs", json={"dataset_id": ds, "speed": 0})
    assert r.status_code == 201, r.text
    assert (r.json()["model_id"], r.json()["model_health"]) == ("m_active", "pending_load")

    # There is no opt-out: an unknown field is ignored and the active model is still attached.
    r = client.post("/api/v1/runs", json={"dataset_id": ds, "speed": 0, "rules_only": True})
    assert r.status_code == 201, r.text
    assert (r.json()["model_id"], r.json()["model_health"]) == ("m_active", "pending_load")

    health = client.get("/health/ready").json()
    assert "no_active_model_rules_only" not in health["degraded_modes"]
    assert q(db, "select count(*) n from runs where model_id='m_active'")[0]["n"] == 2


def test_health_flags_missing_active_model(client, db):
    health = client.get("/health/ready").json()
    assert "no_active_model_rules_only" in health["degraded_modes"]
