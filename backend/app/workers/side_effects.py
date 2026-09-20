"""Asynchronous side-effect worker: notification delivery, explanation jobs, queued dataset imports.

Unordered jobs are claimed with short FOR UPDATE SKIP LOCKED transactions and a lease; the provider is called outside
any transaction; the outcome is persisted only if the lease is still owned. Expired leases are reclaimable.
"""
from __future__ import annotations

import logging
import random
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

from app.config import DetectionConfig, get_config
from app.db.engine import connect_direct, jsonb
from app.notifications import outbox
from app.notifications.slack import DeliveryResult, PreviewAdapter, SlackWebhookAdapter
from app.observability import sentry
from app.settings import Settings, get_settings

log = logging.getLogger("logorder.side_effects")

LEASE_SECONDS = 30


class SideEffectWorker:
    def __init__(
        self,
        database_url: str | None = None,
        settings: Settings | None = None,
        cfg: DetectionConfig | None = None,
        slack_adapter: Any | None = None,
        explainer: Any | None = None,
        worker_id: str | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.database_url = database_url or self.settings.database_url
        self.cfg = cfg or get_config()
        self.worker_id = worker_id or self.settings.worker_id or f"side-effects-{uuid.uuid4().hex[:8]}"
        self.now = now or (lambda: datetime.now(UTC))
        if slack_adapter is not None:
            self.slack = slack_adapter
        elif self.settings.slack_live:
            self.slack = SlackWebhookAdapter(self.settings.slack_webhook_url)
        else:
            self.slack = PreviewAdapter()
        if explainer is not None:
            self._explainer = explainer
        else:
            from app.investigation.provider import build_explainer

            try:
                self._explainer = build_explainer(self.settings)
            except Exception as exc:  # noqa: BLE001 - misconfiguration must not stop deliveries
                log.warning("LLM provider not available (%s); deterministic explanations only", type(exc).__name__)
                self._explainer = None
        self._last_send: dict[str, float] = {}

    # ------------------------------------------------------------------------------------------------ notifications

    def claim_notification(self, conn: psycopg.Connection[Any]) -> dict[str, Any] | None:
        now = self.now()
        with conn.cursor() as cur:
            cur.execute(
                """SELECT * FROM notification_outbox
                   WHERE (state = 'pending' OR (state = 'leased' AND lease_expires_at < %s)) AND next_attempt_at <= %s
                   ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED""",
                (now, now),
            )
            row = cur.fetchone()
            if row is None:
                conn.commit()
                return None
            cur.execute(
                "UPDATE notification_outbox SET state='leased', lease_owner=%s, lease_expires_at=%s, updated_at=now() WHERE idempotency_key=%s",
                (self.worker_id, now + timedelta(seconds=LEASE_SECONDS), row["idempotency_key"]),
            )
        conn.commit()
        return dict(row)

    def deliver_one(self, conn: psycopg.Connection[Any]) -> str | None:
        row = self.claim_notification(conn)
        if row is None:
            return None
        ncfg = self.cfg.policy["notifications"]
        key = row["idempotency_key"]
        # Per-destination rate cap (default 1 msg/s) — sleeping outside any transaction, bounded.
        last = self._last_send.get(row["destination_key"], 0.0)
        wait = (1.0 / float(ncfg["rate_limit_per_second"])) - (time.monotonic() - last)
        if wait > 0:
            time.sleep(min(wait, 1.0))
        live_guard = self._live_guard(conn, row)
        with sentry.transaction("notify.deliver", "notification", trace_context=row.get("trace_context"), kind=row["notification_kind"], attempt=row["attempts"] + 1):
            if live_guard:
                res = DeliveryResult("failed", None, None, live_guard)
            else:
                res = self.slack.deliver(row["payload"])
        self._last_send[row["destination_key"]] = time.monotonic()
        self._persist_outcome(conn, key, row, res, ncfg)
        return res.outcome

    def _live_guard(self, conn: psycopg.Connection[Any], row: dict[str, Any]) -> str | None:
        """Live delivery is only allowed for runs explicitly opted in and under the per-run message cap."""
        if isinstance(self.slack, PreviewAdapter):
            return None
        with conn.cursor() as cur:
            cur.execute("SELECT mode, config, notifications_sent FROM runs WHERE run_id=%s", (row["run_id"],))
            run = cur.fetchone()
        conn.commit()
        if run is None:
            return "run missing"
        if run["mode"] == "replay" and not (run["config"] or {}).get("allow_live_notifications"):
            return "replay run not opted into live delivery (preview only)"
        if int(run["notifications_sent"]) >= int(self.settings.max_run_notification_count):
            return f"per-run notification cap {self.settings.max_run_notification_count} reached"
        return None

    def _persist_outcome(self, conn: psycopg.Connection[Any], key: str, row: dict[str, Any], res: DeliveryResult, ncfg: dict[str, Any]) -> None:
        now = self.now()
        with conn.cursor() as cur:
            cur.execute("SELECT lease_owner, attempts FROM notification_outbox WHERE idempotency_key=%s FOR UPDATE", (key,))
            cur_row = cur.fetchone()
            if cur_row is None or cur_row["lease_owner"] != self.worker_id:
                conn.commit()  # lease lost; another worker owns the row now
                return
            attempts = int(cur_row["attempts"]) + 1
            resp = {"outcome": res.outcome, "http_status": res.http_status, "error": res.error, "at": now.isoformat()}
            if res.outcome in ("sent", "preview"):
                cur.execute(
                    """UPDATE notification_outbox SET state=%s, attempts=%s, last_response=%s, sent_at=%s, lease_owner=NULL, lease_expires_at=NULL, updated_at=now()
                       WHERE idempotency_key=%s""",
                    (res.outcome, attempts, jsonb(resp), now, key),
                )
                if res.outcome == "sent":
                    cur.execute("UPDATE runs SET notifications_sent = notifications_sent + 1 WHERE run_id=%s", (row["run_id"],))
            elif res.outcome == "failed":
                cur.execute(
                    """UPDATE notification_outbox SET state='failed', attempts=%s, last_error=%s, last_response=%s, lease_owner=NULL, lease_expires_at=NULL, updated_at=now()
                       WHERE idempotency_key=%s""",
                    (attempts, res.error, jsonb(resp), key),
                )
                sentry.log_event("notification_failed", "error", run_id=row["run_id"], incident_id=row["incident_id"], reason=res.error, permanent=True)
            else:  # retry | ambiguous
                max_attempts = int(ncfg["max_attempts"])
                ambiguous = res.outcome == "ambiguous"
                if attempts >= max_attempts and res.retry_after_seconds is None:
                    cur.execute(
                        """UPDATE notification_outbox SET state='failed', attempts=%s, last_error=%s, last_response=%s, delivery_ambiguous = delivery_ambiguous OR %s,
                               lease_owner=NULL, lease_expires_at=NULL, updated_at=now() WHERE idempotency_key=%s""",
                        (attempts, f"exhausted {attempts} attempts: {res.error}", jsonb(resp), ambiguous, key),
                    )
                    sentry.log_event("notification_failed", "error", run_id=row["run_id"], incident_id=row["incident_id"], reason=res.error, attempts=attempts)
                else:
                    if res.retry_after_seconds is not None:
                        delay = float(res.retry_after_seconds)  # honour 429 Retry-After even beyond the cap
                    else:
                        base, cap = float(ncfg["retry_base_seconds"]), float(ncfg["retry_cap_seconds"])
                        delay = min(cap, base * (2 ** (attempts - 1))) * random.uniform(0.5, 1.5)
                        delay = min(delay, cap)
                    cur.execute(
                        """UPDATE notification_outbox SET state='pending', attempts=%s, last_error=%s, last_response=%s, next_attempt_at=%s,
                               delivery_ambiguous = delivery_ambiguous OR %s, lease_owner=NULL, lease_expires_at=NULL, updated_at=now() WHERE idempotency_key=%s""",
                        (attempts, res.error, jsonb(resp), now + timedelta(seconds=delay), ambiguous, key),
                    )
            # Allocate under the run lock: an unlocked max+1 collides with the detector's own progress update and the
            # PK error would roll back the whole outcome (lease lost → the message is delivered again).
            seq = outbox.next_update_seq(conn, row["run_id"])
            cur.execute(
                "INSERT INTO ui_updates (run_id, update_seq, type, payload) VALUES (%s, %s, 'delivery', %s)",
                (row["run_id"], seq, jsonb({"incident_id": row["incident_id"], "idempotency_key": key, "outcome": res.outcome, "attempts": attempts})),
            )
        conn.commit()

    # ------------------------------------------------------------------------------------------------ explanations

    def explain_one(self, conn: psycopg.Connection[Any]) -> str | None:
        from app.investigation.jobs import run_one_job

        return run_one_job(conn, self, self._explainer)

    # ------------------------------------------------------------------------------------------------ dataset imports

    def import_one(self, conn: psycopg.Connection[Any]) -> str | None:
        with conn.cursor() as cur:
            cur.execute("SELECT id, stats FROM datasets WHERE import_state='pending' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED")
            row = cur.fetchone()
            if row is None:
                conn.commit()
                return None
            cur.execute("UPDATE datasets SET import_state='importing', updated_at=now() WHERE id=%s", (row["id"],))
        conn.commit()
        path = (row["stats"] or {}).get("upload_path")
        from app.ingest.importer import import_dataset

        try:
            if not path:
                raise FileNotFoundError("upload path missing")
            res = import_dataset(path, self.database_url)
            return res.import_state
        except Exception as exc:  # noqa: BLE001
            with conn.cursor() as cur:
                cur.execute("UPDATE datasets SET import_state='failed', error=%s, updated_at=now() WHERE id=%s", (f"{type(exc).__name__}: {exc}"[:500], row["id"]))
            conn.commit()
            sentry.capture_exception(exc, dataset_id=row["id"])
            return "failed"

    # ------------------------------------------------------------------------------------------------ aggregate refresh

    def refresh_aggregate_one(self, conn: psycopg.Connection[Any]) -> str | None:
        """Explicit Tiger aggregate refresh for one run with new processed data (at most every 30 s per run)."""
        with conn.cursor() as cur:
            cur.execute(
                """SELECT r.run_id FROM runs r LEFT JOIN aggregate_refreshes a ON a.run_id = r.run_id
                   WHERE r.last_processed_time IS NOT NULL AND r.state IN ('warming','running','paused','completed')
                     AND (a.run_id IS NULL OR (a.refreshed_through < r.last_processed_time - interval '5 minutes' AND a.refreshed_at < now() - interval '30 seconds'))
                   ORDER BY r.updated_at DESC LIMIT 1"""
            )
            row = cur.fetchone()
        conn.commit()
        if row is None:
            return None
        from app.incidents import analytics

        res = analytics.refresh_run(self.database_url, row["run_id"])
        return "refreshed" if res.get("refreshed") else None

    # ------------------------------------------------------------------------------------------------ loop

    def tick(self, conn: psycopg.Connection[Any]) -> bool:
        busy = False
        for fn in (self.deliver_one, self.explain_one, self.import_one, self.refresh_aggregate_one):
            try:
                if fn(conn) is not None:
                    busy = True
            except psycopg.OperationalError:
                raise
            except Exception as exc:  # noqa: BLE001
                conn.rollback()
                log.exception("side-effect step failed")
                sentry.capture_exception(exc)
        return busy

    def run_forever(self, poll_seconds: float = 0.5, stop: Callable[[], bool] | None = None) -> None:
        sentry.init("side-effects", self.settings)
        log.info("side-effect worker %s started slack=%s llm=%s", self.worker_id, type(self.slack).__name__, self.settings.integration_status()["llm"])
        conn = connect_direct(self.database_url)
        try:
            while not (stop and stop()):
                try:
                    busy = self.tick(conn)
                except psycopg.OperationalError:
                    log.exception("database error; reconnecting")
                    conn.close()
                    time.sleep(2)
                    conn = connect_direct(self.database_url)
                    continue
                if not busy:
                    time.sleep(poll_seconds)
        finally:
            conn.close()
            sentry.flush()


def main() -> None:
    SideEffectWorker().run_forever()


if __name__ == "__main__":
    main()
