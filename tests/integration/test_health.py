import json

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


def test_ready_declares_whether_a_browser_needs_an_operator_token(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "api_host", "127.0.0.1")
    monkeypatch.setattr(settings, "app_auth_secret", "")
    with TestClient(create_app()) as client:
        body = client.get("/health/ready").json()
    assert body["auth"] == {"operator_required": False, "ingest_required": False}
    # A shared (non-loopback) deployment always requires both, whether or not the secrets are set yet.
    monkeypatch.setattr(settings, "api_host", "0.0.0.0")
    monkeypatch.setattr(settings, "app_auth_secret", "operator-secret-xyz")
    with TestClient(create_app()) as client:
        body = client.get("/health/ready").json()
    assert body["auth"] == {"operator_required": True, "ingest_required": True}
    assert "operator-secret-xyz" not in json.dumps(body)


def test_built_frontend_is_served_same_origin_without_shadowing_the_api(monkeypatch, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>console</title>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("export default 1\n", encoding="utf-8")
    monkeypatch.setattr(get_settings(), "static_dir", str(dist))
    with TestClient(create_app()) as client:
        assert client.get("/").text.startswith("<!doctype html>")
        assert client.get("/runs/abc/incidents/x").text.startswith("<!doctype html>")  # SPA route, not a 404
        assert client.get("/assets/app.js").status_code == 200
        # API and health paths keep their own responses; unknown ones stay JSON 404s, never index.html.
        assert client.get("/health/live").json() == {"status": "ok"}
        missing = client.get("/api/v1/nope")
        assert missing.status_code == 404 and "doctype" not in missing.text


def test_frontend_mount_is_absent_when_nothing_is_built(monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), "static_dir", str(tmp_path / "never-built"))
    with TestClient(create_app()) as client:
        assert client.get("/").status_code == 404


def test_ready_is_503_when_database_missing(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "database_url", "postgresql://nobody:nothing@127.0.0.1:1/none")
    with TestClient(create_app()) as client:
        resp = client.get("/health/ready")
    assert resp.status_code == 503
    assert resp.json()["database"]["ok"] is False
    assert "nothing" not in resp.text  # password never returned
