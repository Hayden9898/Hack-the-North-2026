import pytest
from fastapi.testclient import TestClient

from app.api.main import create_app
from app.settings import get_settings


def test_live_is_always_ok():
    with TestClient(create_app()) as client:
        assert client.get("/health/live").json() == {"status": "ok"}


@pytest.mark.integration
def test_ready_reports_db_and_optional_integrations_separately(db, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "database_url", db)
    with TestClient(create_app()) as client:
        body = client.get("/health/ready").json()
    assert body["status"] == "ready"
    assert body["database"]["ok"] is True
    assert body["migrations"]["ok"] is True
    # Optional integrations show up as degraded modes, never as a failure to be ready.
    assert "slack_preview" in body["degraded_modes"] or body["integrations"]["slack"] == "live"
    for value in body["integrations"].values():
        assert "http" not in value  # no webhook URL / DSN echoed


def test_ready_is_503_when_database_missing(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "database_url", "postgresql://nobody:nothing@127.0.0.1:1/none")
    with TestClient(create_app()) as client:
        resp = client.get("/health/ready")
    assert resp.status_code == 503
    assert resp.json()["database"]["ok"] is False
    assert "nothing" not in resp.text  # password never returned


def test_model_artifacts_report_resource_ids_not_manifest_filenames(tmp_path, monkeypatch):
    artifact = tmp_path / "reviewed-model-v1"
    artifact.mkdir()
    (artifact / "manifest.json").write_text("{}")
    settings = get_settings()
    monkeypatch.setattr(settings, "model_dir", str(tmp_path))
    monkeypatch.setattr(settings, "database_url", "postgresql://nobody:nothing@127.0.0.1:1/none")
    with TestClient(create_app()) as client:
        body = client.get("/health/ready").json()
    assert body["models"]["artifacts"] == ["reviewed-model-v1"]
