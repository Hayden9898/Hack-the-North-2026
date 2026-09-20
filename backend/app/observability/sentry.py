"""Observe our software, never the evidence being investigated.

Outgoing payloads are allowlisted: no bodies, SQL, accounts, prompts, exception
messages/locals, breadcrumbs, or provider responses. Telemetry is best-effort.
"""

from __future__ import annotations

import contextlib
import logging
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from uuid import uuid4

import sentry_sdk
from sentry_sdk import logger as sentry_logger
from sentry_sdk.integrations.dedupe import DedupeIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from app.settings import Settings, get_settings

_log = logging.getLogger("logorder")
_initialized = False
_enabled = False
EVENT_NAMES = {
    "parse_rejected",
    "event_late",
    "run_blocked",
    "model_degraded",
    "claim_rejected",
    "explanation_timeout",
    "notification_failed",
    "aggregate_stale",
    "run_phase_visible",
    "observability_check",
}
_OPS = {
    "analytics.query",
    "analytics.benchmark",
    "analytics.refresh",
    "explanation.call",
    "explanation.validate",
    "explanation",
    "explanation_job",
    "ingest.import",
    "import_dataset",
    "ingest.persist",
    "notify.deliver",
    "notification",
    "detector.batch",
    "features",
    "model.score",
    "rules.evaluate",
    "correlate",
    "observability.check",
}
_COUNTS = {
    "bucket_minutes",
    "repeats",
    "run_seq",
    "version",
    "attempt",
    "attempts",
    "rows",
    "rejects",
    "line_number",
    "request_index",
    "lag_seconds",
    "warmup_admitted",
    "size",
    "matches",
    "permanent",
    "http.response.status_code",
}
_IDS = {"run_id", "incident_id", "dataset_id", "check_id"}
_TRACE_KEYS = {"trace_id", "span_id", "parent_span_id", "status", "sampled", "origin"}


def safe_attributes(attrs: dict[str, Any]) -> dict[str, Any]:
    safe: dict[str, Any] = {}
    for key, value in attrs.items():
        if key in _COUNTS and isinstance(value, int | float | bool):
            safe[key] = value
        elif key in _IDS and re.fullmatch(r"[a-fA-F0-9-]{16,36}", str(value)):
            safe[key] = str(value)
        elif key == "event" and isinstance(value, str) and value in EVENT_NAMES:
            safe[key] = value
        elif (
            key == "process"
            and isinstance(value, str)
            and value in {"api", "detector", "side-effects", "side_effects", "diagnostic"}
        ):
            safe[key] = value
        elif key == "error" and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,79}", str(value)):
            safe[key] = str(value)
        elif key == "reason":
            safe[key] = "details_redacted"
    return safe


def _operation(value: Any) -> str:
    value = str(value or "application")
    if value in _OPS or value in {"http.server", "http.client", "db", "db.sql.query", "middleware.starlette"}:
        return value
    return "application"


def _transaction_name(value: Any) -> str:
    # FastAPI route templates, not request paths/values. Keep endpoints useful in Performance.
    name = str(value or "")
    if re.fullmatch(
        r"/(?:health/(?:live|ready)|api/v1/(?:datasets|runs|observability)(?:/(?:\{(?:dataset_id|run_id|incident_id|seq|fact_id)\}|incidents|events|facts|evidence|replay|updates|analytics|timeseries|benchmark|feedback|check))*)",
        name,
    ):
        return name
    return _operation(name)


def _scrub(event: Any, hint: Any) -> Any:
    """New SDK fields fail closed. Stack locations are useful; their contents are not."""
    safe = {
        k: event[k]
        for k in (
            "event_id",
            "timestamp",
            "start_timestamp",
            "type",
            "level",
            "platform",
            "release",
            "environment",
            "sdk",
            "transaction_info",
            "measurements",
            "breakdowns",
        )
        if k in event
    }
    safe["tags"] = safe_attributes(event.get("tags") or {})
    trace = (event.get("contexts") or {}).get("trace") or {}
    safe["contexts"] = {"trace": {k: v for k, v in trace.items() if k in _TRACE_KEYS}}
    safe["contexts"]["trace"]["op"] = _operation(trace.get("op"))
    safe["contexts"]["trace"]["data"] = safe_attributes(trace.get("data") or {})
    if "transaction" in event:
        safe["transaction"] = _transaction_name(event["transaction"])
    if "message" in event or "logentry" in event:
        safe["message"] = (
            "logorder.observability_check"
            if (event.get("tags") or {}).get("check_id")
            else "Application diagnostic"
        )
    values = []
    for exc in (event.get("exception") or {}).get("values", []):
        frames = []
        for frame in (exc.get("stacktrace") or {}).get("frames", []):
            frames.append(
                {
                    **{
                        k: frame[k] for k in ("function", "module", "lineno", "colno", "in_app") if k in frame
                    },
                    "filename": Path(frame.get("filename") or "unknown").name,
                }
            )
        values.append(
            {
                "type": exc.get("type", "Error"),
                "value": "Exception details withheld by privacy policy",
                "stacktrace": {"frames": frames},
            }
        )
    if values:
        safe["exception"] = {"values": values}
    if "spans" in event:
        safe["spans"] = [_scrub_span(s, {}) for s in event["spans"]]
    return safe


def _scrub_span(span: Any, hint: Any) -> Any:
    safe = {k: span[k] for k in (*_TRACE_KEYS, "timestamp", "start_timestamp") if k in span}
    safe["op"] = _operation(span.get("op"))
    safe["description"] = safe["op"]
    safe["data"] = safe_attributes(span.get("data") or {})
    return safe


def _scrub_log(log: Any, hint: Any) -> Any:
    if log.get("body") not in EVENT_NAMES:
        return None
    log["attributes"] = safe_attributes(log.get("attributes") or {})
    return log


def init(process_name: str, settings: Settings | None = None) -> bool:
    global _initialized, _enabled
    settings = settings or get_settings()
    if _initialized:
        return _enabled
    _initialized = True
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if not settings.sentry_enabled:
        _log.info("sentry disabled (no SENTRY_DSN); local diagnostics only process=%s", process_name)
        return False
    try:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.sentry_environment,
            release=settings.sentry_release or None,
            traces_sample_rate=settings.sentry_traces_sample_rate,
            send_default_pii=False,
            include_local_variables=False,
            max_request_body_size="never",
            server_name="logorder",
            before_send=_scrub,
            before_send_transaction=_scrub,
            before_send_log=_scrub_log,
            default_integrations=False,
            auto_enabling_integrations=False,
            integrations=[FastApiIntegration(), StarletteIntegration(), DedupeIntegration()],
            enable_logs=True,
        )
        sentry_sdk.set_tag("process", process_name)
        _enabled = True
        _log.info("sentry initialized process=%s (delivery not yet verified)", process_name)
    except Exception as exc:  # noqa: BLE001
        _log.warning("sentry init failed (%s); continuing without it", type(exc).__name__)
    return _enabled


def enabled() -> bool:
    return _enabled


@contextlib.contextmanager
def _safe_context(cm: Any, data: dict[str, Any]) -> Iterator[Any]:
    try:
        current = cm.__enter__()
    except Exception:  # noqa: BLE001
        yield None
        return
    try:
        with contextlib.suppress(Exception):
            for k, v in safe_attributes(data).items():
                current.set_data(k, v)
        yield current
    except BaseException as exc:
        with contextlib.suppress(Exception):
            cm.__exit__(type(exc), exc, exc.__traceback__)
        raise
    else:
        with contextlib.suppress(Exception):
            cm.__exit__(None, None, None)


@contextlib.contextmanager
def span(op: str, description: str | None = None, **data: Any) -> Iterator[Any]:
    if not _enabled:
        yield None
        return
    try:
        cm = (
            sentry_sdk.start_transaction(op=op, name=description or op)
            if sentry_sdk.get_current_span() is None
            else sentry_sdk.start_span(op=op, description=description or op)
        )
    except Exception:  # noqa: BLE001
        yield None
        return
    with _safe_context(cm, data) as current:
        yield current


@contextlib.contextmanager
def transaction(
    op: str, name: str, trace_context: dict[str, Any] | None = None, **data: Any
) -> Iterator[Any]:
    if not _enabled:
        yield None
        return
    try:
        cm = (
            sentry_sdk.start_transaction(sentry_sdk.continue_trace(trace_context, op=op, name=name))
            if trace_context
            else sentry_sdk.start_transaction(op=op, name=name)
        )
    except Exception:  # noqa: BLE001
        yield None
        return
    with _safe_context(cm, data) as current:
        yield current


def current_trace_context() -> dict[str, Any] | None:
    if _enabled:
        with contextlib.suppress(Exception):
            return {"sentry-trace": sentry_sdk.get_traceparent(), "baggage": sentry_sdk.get_baggage()}
    return None


def log_event(name: str, level: str = "info", **attrs: Any) -> None:
    if name not in EVENT_NAMES:
        return
    attrs = safe_attributes(attrs)
    getattr(_log, level if level in ("debug", "info", "warning", "error") else "info")("%s %s", name, attrs)
    if _enabled:
        with contextlib.suppress(Exception):
            getattr(sentry_logger, level, sentry_logger.info)(name, attributes={"event": name, **attrs})


def capture_exception(exc: BaseException, **tags: Any) -> None:
    _log.error("application exception type=%s", type(exc).__name__)
    if _enabled:
        with contextlib.suppress(Exception), sentry_sdk.new_scope() as scope:
            for k, v in safe_attributes(tags).items():
                scope.set_tag(k, v)
            sentry_sdk.capture_exception(exc)


def diagnostic() -> dict[str, Any]:
    """Opt-in synthetic event + trace + log. No source, incident or provider is touched."""
    if not _enabled:
        return {"status": "disabled", "event_id": None, "check_id": None}
    check_id = uuid4().hex
    event_id = None
    with contextlib.suppress(Exception), sentry_sdk.new_scope() as scope:
        scope.set_tag("check_id", check_id)
        with sentry_sdk.start_transaction(name="observability.check", op="observability.check", sampled=True):
            log_event("observability_check", check_id=check_id)
            event_id = sentry_sdk.capture_message("logorder.observability_check", level="info")
    flush()
    return {"status": "queued" if event_id else "not_queued", "event_id": event_id, "check_id": check_id}


def flush(timeout: float = 2.0) -> None:
    if _enabled:
        with contextlib.suppress(Exception):
            sentry_sdk.flush(timeout=timeout)
