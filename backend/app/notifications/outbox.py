"""Durable notification outbox written inside the detector transaction (architecture.md §9).

High-risk first escalation → immediate pending row. Suspicious → one debounced digest per incident (5 minutes of
event time in replay; wall time for live), updated in place while the window is open. Same-severity repeats never
create new messages. Delivery happens in the side-effect worker; this module never touches the network.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

from app.db.engine import jsonb
from app.notifications.templates import build_payload

DESTINATION = "slack:default"


def enqueue_for_version(
    conn: psycopg.Connection[Any],
    *,
    run: dict[str, Any],
    incident: dict[str, Any],
    version: int,
    previous_class: str | None,
    threat_class: str,
    rule_ids: list[str],
    summary: dict[str, Any],
    event_time: datetime,
    event_count: int,
    app_base_url: str,
    debounce_seconds: int,
    trace_context: dict[str, Any] | None,
) -> str | None:
    """Returns the notification kind enqueued/updated, or None when nothing material happened."""
    run_id, incident_id = run["run_id"], incident["incident_id"]
    replay = run["mode"] == "replay"
    common = dict(
        run_id=run_id, incident_id=incident_id, version=version, threat_class=threat_class, account=incident.get("account"),
        ip=incident.get("ip_raw"), first_time=incident["first_event_time"].isoformat(), last_time=event_time.isoformat(),
        rule_ids=rule_ids, summary=summary, app_base_url=app_base_url, event_count=event_count, replay=replay,
    )
    with conn.cursor() as cur:
        if threat_class == "high_risk" and previous_class != "high_risk":
            key = f"{run_id}:{incident_id}:high_risk_escalation"
            payload = build_payload(kind="high_risk_escalation", **common)
            cur.execute(
                """INSERT INTO notification_outbox (idempotency_key, run_id, incident_id, version, notification_kind, destination_key,
                       payload, state, ready_event_time, trace_context)
                   VALUES (%s, %s, %s, %s, 'high_risk_escalation', %s, %s, 'pending', %s, %s)
                   ON CONFLICT (idempotency_key) DO NOTHING""",
                (key, run_id, incident_id, version, DESTINATION, jsonb(payload), event_time, jsonb(trace_context) if trace_context else None),
            )
            return "high_risk_escalation"
        if threat_class == "suspicious":
            # Open digest for this incident?
            cur.execute(
                """SELECT idempotency_key, payload FROM notification_outbox
                   WHERE run_id=%s AND incident_id=%s AND notification_kind='suspicious_digest' AND state='debounce'
                   ORDER BY created_at DESC LIMIT 1 FOR UPDATE""",
                (run_id, incident_id),
            )
            open_row = cur.fetchone()
            if open_row:
                payload = build_payload(kind="suspicious_digest", **common)
                cur.execute(
                    "UPDATE notification_outbox SET payload=%s, version=%s, updated_at=now() WHERE idempotency_key=%s",
                    (jsonb(payload), version, open_row["idempotency_key"]),
                )
                return "suspicious_digest_updated"
            if previous_class is None:
                key = f"{run_id}:{incident_id}:suspicious_digest:{version}"
                payload = build_payload(kind="suspicious_digest", **common)
                ready = event_time + timedelta(seconds=debounce_seconds)
                cur.execute(
                    """INSERT INTO notification_outbox (idempotency_key, run_id, incident_id, version, notification_kind, destination_key,
                           payload, state, ready_event_time, next_attempt_at, trace_context)
                       VALUES (%s, %s, %s, %s, 'suspicious_digest', %s, %s, 'debounce', %s, %s, %s)
                       ON CONFLICT (idempotency_key) DO NOTHING""",
                    (key, run_id, incident_id, version, DESTINATION, jsonb(payload), ready,
                     datetime.now(UTC) + timedelta(seconds=debounce_seconds), jsonb(trace_context) if trace_context else None),
                )
                return "suspicious_digest"
    return None


def promote_ready(conn: psycopg.Connection[Any], run_id: str, current_event_time: datetime | None, live: bool) -> int:
    """Move debounced digests whose window has closed into `pending` (event time for replay; wall time for live)."""
    with conn.cursor() as cur:
        if live:
            cur.execute(
                "UPDATE notification_outbox SET state='pending', updated_at=now() WHERE run_id=%s AND state='debounce' AND next_attempt_at <= now()",
                (run_id,),
            )
        else:
            if current_event_time is None:
                return 0
            cur.execute(
                "UPDATE notification_outbox SET state='pending', next_attempt_at=now(), updated_at=now() WHERE run_id=%s AND state='debounce' AND ready_event_time <= %s",
                (run_id, current_event_time),
            )
        return cur.rowcount


def flush_all(conn: psycopg.Connection[Any], run_id: str) -> int:
    """At replay completion every pending digest is released."""
    with conn.cursor() as cur:
        cur.execute("UPDATE notification_outbox SET state='pending', next_attempt_at=now(), updated_at=now() WHERE run_id=%s AND state='debounce'", (run_id,))
        return cur.rowcount
