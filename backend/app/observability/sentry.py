"""Sentry Tracing + Logs wiring, plus local fallbacks when Sentry is not configured.

Observability failure never rolls back a detection: every call here is best-effort and swallows errors.
Correlation keys are opaque run/incident ids; usernames, raw URLs, webhook URLs and prompts are not attached.
"""
from __future__ import annotations

import contextlib
import logging
import time
from collections.abc import Iterator
from typing import Any

import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration

from app.settings import Settings, get_settings

_log = logging.getLogger("logorder")
_initialized = False
_enabled = False

# Structured event names required by architecture.md §11.
EVENT_NAMES = {
    "parse_rejected",
    "event_late",
    "run_blocked",
    "model_degraded",
    "claim_rejected",
    "explanation_timeout",
    "notification_failed",
    "aggregate_stale",
}


def _scrub(event: Any, hint: Any) -> Any:
    # Defensive scrubbing: drop request bodies/headers that could carry tokens or webhook URLs.
    req = event.get("request")
    if isinstance(req, dict):
        req.pop("data", None)
        req.pop("cookies", None)
        headers = req.get("headers")
        if isinstance(headers, dict):
            for k in list(headers):
                if k.lower() in ("authorization", "cookie", "x-ingest-token"):
                    headers[k] = "[redacted]"
    return event


def init(process_name: str, settings: Settings | None = None) -> bool:
    """Initialise the SDK once per process. Returns whether Sentry is enabled."""
    global _initialized, _enabled
    settings = settings or get_settings()
    if _initialized:
        return _enabled
    _initialized = True
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if not settings.sentry_enabled:
        _log.info("sentry disabled (no SENTRY_DSN); using local diagnostics only process=%s", process_name)
        _enabled = False
        return False
    try:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.sentry_environment,
            release=None,
            traces_sample_rate=settings.sentry_traces_sample_rate,
            send_default_pii=False,
            before_send=_scrub,
            integrations=[LoggingIntegration(level=logging.INFO, event_level=logging.ERROR)],
            _experiments={"enable_logs": True},
        )
        sentry_sdk.set_tag("process", process_name)
        _enabled = True
        _log.info("sentry enabled process=%s env=%s", process_name, settings.sentry_environment)
    except Exception as exc:  # noqa: BLE001
        _log.warning("sentry init failed (%s); continuing without it", type(exc).__name__)
        _enabled = False
    return _enabled


def enabled() -> bool:
    return _enabled


@contextlib.contextmanager
def span(op: str, description: str | None = None, **data: Any) -> Iterator[Any]:
    """Start a span (or a transaction if none is active). Never raises."""
    started = time.perf_counter()
    if not _enabled:
        yield None
        return
    cm: Any
    try:
        current = sentry_sdk.get_current_span()
        if current is None:
            cm = sentry_sdk.start_transaction(op=op, name=description or op)
        else:
            cm = sentry_sdk.start_span(op=op, description=description or op)
    except Exception:  # noqa: BLE001
        yield None
        return
    with cm as s:
        try:
            for k, v in data.items():
                s.set_data(k, v)
        except Exception:  # noqa: BLE001
            pass
        yield s
    _ = time.perf_counter() - started


@contextlib.contextmanager
def transaction(op: str, name: str, trace_context: dict[str, Any] | None = None, **data: Any) -> Iterator[Any]:
    """Start a top-level transaction, optionally continuing a stored trace context (job records)."""
    if not _enabled:
        yield None
        return
    try:
        if trace_context:
            tx = sentry_sdk.continue_trace(trace_context, op=op, name=name)
            cm = sentry_sdk.start_transaction(tx)
        else:
            cm = sentry_sdk.start_transaction(op=op, name=name)
    except Exception:  # noqa: BLE001
        yield None
        return
    with cm as t:
        try:
            for k, v in data.items():
                t.set_data(k, v)
        except Exception:  # noqa: BLE001
            pass
        yield t


def current_trace_context() -> dict[str, Any] | None:
    """Headers that let an async worker link its transaction to the originating trace."""
    if not _enabled:
        return None
    try:
        return dict(sentry_sdk.get_traceparent() and {"sentry-trace": sentry_sdk.get_traceparent(), "baggage": sentry_sdk.get_baggage()} or {})
    except Exception:  # noqa: BLE001
        return None


def log_event(name: str, level: str = "info", **attrs: Any) -> None:
    """Structured log: local logger always; Sentry Logs when enabled."""
    line = " ".join(f"{k}={v}" for k, v in attrs.items())
    getattr(_log, level if level in ("debug", "info", "warning", "error") else "info")("%s %s", name, line)
    if not _enabled:
        return
    try:
        from sentry_sdk import logger as sentry_logger

        fn = getattr(sentry_logger, level, sentry_logger.info)
        fn(f"{name}", attributes={"event": name, **{k: _safe(v) for k, v in attrs.items()}})
    except Exception:  # noqa: BLE001
        pass


def capture_exception(exc: BaseException, **tags: Any) -> None:
    _log.exception("exception %s", type(exc).__name__)
    if not _enabled:
        return
    try:
        with sentry_sdk.new_scope() as scope:
            for k, v in tags.items():
                scope.set_tag(k, str(v))
            sentry_sdk.capture_exception(exc)
    except Exception:  # noqa: BLE001
        pass


def flush(timeout: float = 2.0) -> None:
    if _enabled:
        with contextlib.suppress(Exception):
            sentry_sdk.flush(timeout=timeout)


def _safe(v: Any) -> Any:
    if isinstance(v, str | int | float | bool) or v is None:
        return v
    return str(v)
