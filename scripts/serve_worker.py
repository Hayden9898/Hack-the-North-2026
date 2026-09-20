"""Background worker entrypoint: the ordered detector and the asynchronous side-effect worker in one process.

Locally `python tasks.py dev` runs them as separate processes. A single hosted worker service runs both here as
two threads with independent database connections; ordering guarantees are unchanged because they come from the
per-run row lock in the database, not from process topology. SIGTERM stops both loops and drains.

Set WORKER_ROLES=detector or WORKER_ROLES=side_effects to run only one of them (e.g. two scaled services).
"""
from __future__ import annotations

import logging
import os
import signal
import sys
import threading
from types import FrameType

from app.observability import sentry
from app.settings import get_settings
from app.workers.detector import Detector
from app.workers.side_effects import SideEffectWorker

log = logging.getLogger("logorder.worker")

_stop = threading.Event()


def _stopping() -> bool:
    return _stop.is_set()


def _run_detector() -> None:
    try:
        Detector().run_forever(stop=_stopping)
    except BaseException as exc:  # noqa: BLE001 - a dead loop must take the process down, not hide
        log.exception("detector loop exited")
        sentry.capture_exception(exc, process="detector")
        _stop.set()


def _run_side_effects() -> None:
    try:
        SideEffectWorker().run_forever(stop=_stopping)
    except BaseException as exc:  # noqa: BLE001
        log.exception("side-effect loop exited")
        sentry.capture_exception(exc, process="side-effects")
        _stop.set()


def main() -> int:
    settings = get_settings()
    sentry.init("worker", settings)
    roles = {r.strip() for r in os.environ.get("WORKER_ROLES", "detector,side_effects").split(",") if r.strip()}
    targets = {"detector": _run_detector, "side_effects": _run_side_effects}
    unknown = roles - targets.keys()
    if unknown:
        print(f"unknown WORKER_ROLES: {sorted(unknown)}", file=sys.stderr)
        return 2

    def _handle(signum: int, _frame: FrameType | None) -> None:
        log.info("signal %s received; stopping worker loops", signum)
        _stop.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, _handle)

    threads = [threading.Thread(target=targets[r], name=r, daemon=True) for r in sorted(roles)]
    log.info("worker starting roles=%s db=%s", sorted(roles), settings.database_url.rsplit("@", 1)[-1])
    for t in threads:
        t.start()
    try:
        while not _stop.is_set() and any(t.is_alive() for t in threads):
            _stop.wait(1.0)
    except KeyboardInterrupt:
        _stop.set()
    _stop.set()
    for t in threads:
        t.join(timeout=30)
    sentry.flush()
    log.info("worker stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
