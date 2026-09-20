"""Exercise real SDK envelopes with a memory transport: no external Sentry project needed."""

import json
from unittest.mock import MagicMock

import pytest
import sentry_sdk
from fastapi.testclient import TestClient
from sentry_sdk.transport import Transport

from app.api.deps import settings as api_settings
from app.api.main import create_app
from app.observability import sentry
from app.settings import Settings

SECRET = "EVIDENCE_DO_NOT_EXPORT_92f3"
RUN_ID = "ad14c5ca-315b-4515-8e3a-92f36074a3a0"


class MemoryTransport(Transport):
    def __init__(self):
        super().__init__()
        self.envelopes = []

    def capture_envelope(self, envelope):
        self.envelopes.append(envelope)


def test_real_sdk_errors_traces_and_logs_are_scrubbed(monkeypatch):
    transport = MemoryTransport()
    initialize = sentry_sdk.init
    previous = sentry_sdk.get_client()
    monkeypatch.setattr(sentry, "_initialized", False)
    monkeypatch.setattr(sentry, "_enabled", False)
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: initialize(**kwargs, transport=transport))
    try:
        assert sentry.init(
            "diagnostic",
            Settings(
                _env_file=None, sentry_dsn="https://public@example.invalid/1", sentry_traces_sample_rate=1
            ),
        )
        with sentry_sdk.new_scope() as scope:
            scope.set_user({"email": SECRET})
            scope.set_extra("evidence", SECRET)
            sentry_sdk.add_breadcrumb(message=SECRET, data={"raw_log": SECRET})
            with sentry.transaction("detector.batch", "detector.batch", run_id=RUN_ID, username=SECRET):
                with sentry.span("features", description=SECRET, raw_log=SECRET, run_seq=7):
                    sentry.log_event("run_blocked", "error", run_id=RUN_ID, reason=SECRET, prompt=SECRET)
                    try:
                        raise ValueError(SECRET)
                    except ValueError as exc:
                        sentry.capture_exception(exc, run_id=RUN_ID, username=SECRET)
            diagnostic = sentry.diagnostic()
            assert diagnostic["status"] == "queued" and diagnostic["event_id"]
        sentry.flush()
        payloads = [
            (item.headers["type"], item.payload.json) for e in transport.envelopes for item in e.items
        ]
        serialized = json.dumps(payloads)
        assert SECRET not in serialized
        assert RUN_ID in serialized and "features" in serialized and "ValueError" in serialized
        assert {"event", "transaction", "log"}.issubset({kind for kind, _ in payloads})
        assert "run_blocked" in serialized and "observability_check" in serialized
    finally:
        sentry_sdk.get_client().close()
        sentry_sdk.get_global_scope().set_client(previous)


def test_request_sql_and_future_sdk_fields_are_not_exported():
    payload = {
        "event_id": "a" * 32,
        "request": {"url": SECRET, "data": SECRET, "headers": {"authorization": SECRET}},
        "user": {"username": SECRET},
        "extra": {"raw_log": SECRET},
        "future_sdk_field": SECRET,
        "transaction": SECRET,
        "spans": [{"op": "db", "description": SECRET, "data": {"db.statement": SECRET}}],
        "exception": {
            "values": [
                {
                    "type": "ValueError",
                    "value": SECRET,
                    "stacktrace": {
                        "frames": [
                            {
                                "filename": f"/home/{SECRET}/detector.py",
                                "function": "detect",
                                "lineno": 42,
                                "vars": {"raw": SECRET},
                                "context_line": SECRET,
                            }
                        ]
                    },
                }
            ]
        },
    }
    assert SECRET not in json.dumps(sentry._scrub(payload, {}))
    assert sentry._scrub_log({"body": SECRET}, {}) is None


def test_telemetry_failure_cannot_change_business_outcome(monkeypatch):
    monkeypatch.setattr(sentry, "_enabled", True)
    context = MagicMock()
    context.__enter__.side_effect = RuntimeError("transport failed")
    with sentry._safe_context(context, {}) as span:
        assert span is None
    context.__enter__.side_effect = None
    context.__exit__.side_effect = RuntimeError("transport failed")
    with pytest.raises(ValueError, match="business failure"), sentry._safe_context(context, {}):
        raise ValueError("business failure")
    with sentry._safe_context(context, {}):
        pass


def test_diagnostic_requires_operator_and_never_claims_delivery(monkeypatch):
    app = create_app()
    app.dependency_overrides[api_settings] = lambda: Settings(
        _env_file=None, app_auth_secret="test-only", api_host="0.0.0.0"
    )
    monkeypatch.setattr(sentry, "_enabled", False)
    client = TestClient(app)
    assert client.post("/api/v1/observability/check").status_code == 401
    response = client.post("/api/v1/observability/check", headers={"Authorization": "Bearer test-only"})
    assert response.status_code == 200
    assert response.json() == {
        "status": "disabled",
        "event_id": None,
        "check_id": None,
        "delivery_verified": False,
    }


def test_trace_sample_rate_is_bounded():
    with pytest.raises(ValueError):
        Settings(_env_file=None, sentry_traces_sample_rate=2)


def test_safe_endpoint_names_preserve_route_templates_not_resource_values():
    assert sentry._transaction_name("/api/v1/runs/{run_id}/events") == "/api/v1/runs/{run_id}/events"
    assert sentry._transaction_name("/api/v1/runs/" + SECRET) == "application"
    assert sentry._transaction_name("/api/v1/runs?account=" + SECRET) == "application"
