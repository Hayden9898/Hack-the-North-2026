"""Guards that need no database: the non-loopback secret check, readiness reasons, query bounds, tasks.py argument parsing."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.api.main import create_app
from app.settings import get_settings

UNREACHABLE_DB = "postgresql://nobody:nothing@127.0.0.1:1/none"


def test_ready_is_not_ready_when_shared_bind_lacks_secrets(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "database_url", UNREACHABLE_DB)
    monkeypatch.setattr(s, "api_host", "0.0.0.0")
    monkeypatch.setattr(s, "app_auth_secret", "")
    monkeypatch.setattr(s, "ingest_token", "")
    with TestClient(create_app()) as client:
        resp = client.get("/health/ready")
    body = resp.json()
    assert resp.status_code == 503 and body["status"] == "not_ready"
    assert "auth_secrets_missing" in body["not_ready_reasons"]
    assert "database_unavailable" in body["not_ready_reasons"]
    # The auth block keeps its documented shape; secrets are never echoed.
    assert body["auth"] == {"operator_required": True, "ingest_required": True}

    monkeypatch.setattr(s, "app_auth_secret", "operator-secret-xyz")
    monkeypatch.setattr(s, "ingest_token", "ingest-token-abc")
    with TestClient(create_app()) as client:
        body = client.get("/health/ready").json()
    assert "auth_secrets_missing" not in body["not_ready_reasons"]
    assert "operator-secret" not in json.dumps(body) and "ingest-token" not in json.dumps(body)


def test_loopback_without_secrets_is_not_an_auth_readiness_failure(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "database_url", UNREACHABLE_DB)
    monkeypatch.setattr(s, "api_host", "127.0.0.1")
    monkeypatch.setattr(s, "app_auth_secret", "")
    monkeypatch.setattr(s, "ingest_token", "")
    with TestClient(create_app()) as client:
        body = client.get("/health/ready").json()
    assert "auth_secrets_missing" not in body["not_ready_reasons"]


def test_serve_api_refuses_non_loopback_bind_without_secrets(monkeypatch):
    import uvicorn
    from scripts import serve_api

    s = get_settings()
    monkeypatch.setattr(s, "api_host", "0.0.0.0")
    monkeypatch.setattr(s, "app_auth_secret", "")
    monkeypatch.setattr(s, "ingest_token", "only-one")
    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: pytest.fail("uvicorn.run must not be called"))
    with pytest.raises(SystemExit) as exc:
        serve_api.main()
    message = str(exc.value)
    assert "APP_AUTH_SECRET" in message and "non-loopback" in message
    assert "only-one" not in message


def test_serve_api_starts_on_loopback_without_secrets(monkeypatch):
    import uvicorn
    from scripts import serve_api

    s = get_settings()
    monkeypatch.setattr(s, "api_host", "127.0.0.1")
    monkeypatch.setattr(s, "app_auth_secret", "")
    monkeypatch.setattr(s, "ingest_token", "")
    calls: list[dict] = []
    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: calls.append(k))
    serve_api.main()
    assert calls and calls[0]["host"] == "127.0.0.1"


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/runs/r/late?limit=0",
        "/api/v1/runs/r/late?limit=-1",
        "/api/v1/runs/r/late?limit=201",
        "/api/v1/runs/r/events?limit=0",
        "/api/v1/runs/r/incidents?limit=0",
        "/api/v1/runs/r/incidents?offset=-1",
    ],
)
def test_pagination_bounds_are_rejected_before_reaching_postgres(path):
    app = create_app()
    app.dependency_overrides[deps.db] = lambda: None  # a request that reached the endpoint would need a connection
    with TestClient(app) as client:
        assert client.get(path).status_code == 422


def test_tasks_rejects_unknown_positional_arguments(monkeypatch, capsys):
    import tasks

    monkeypatch.setattr(tasks, "target_calibrate", lambda **kw: pytest.fail(f"target ran with {kw}"))
    assert tasks.main(["calibrate", "MODEL_ID=m", "--activate"]) == 2
    assert "ACTIVATE=1" in capsys.readouterr().err


def test_tasks_passthrough_spells_boolean_flags():
    import tasks

    assert tasks._passthrough({"MODEL_ID": "m", "ACTIVATE": "1"}) == ["--model-id", "m", "--activate"]
    assert tasks._passthrough({"ACTIVATE": "0"}) == []
