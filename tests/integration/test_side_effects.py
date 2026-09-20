"""Q02/Q03: outbox delivery states under Slack 429/500/400/timeout, lease reclaim, preview mode; explanation fallback."""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta

import pytest
from tests.helpers import q

from app.config import load_config
from app.db.engine import connect_direct, jsonb
from app.ingest.importer import dataset_id_for
from app.notifications.slack import DeliveryResult, PreviewAdapter, SlackWebhookAdapter
from app.settings import Settings
from app.workers.side_effects import SideEffectWorker

pytestmark = pytest.mark.integration


class StubSlack:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def deliver(self, payload):
        self.calls += 1
        return self.outcomes.pop(0)


def _seed(db, run_id="run-a", key="run-a:inc-1:high_risk_escalation", state="pending"):
    with connect_direct(db) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO runs (run_id, mode, phase, config_hash, feature_version, state, config)
               VALUES (%s, 'live', 'visible', 'h', 'v1', 'running', %s) ON CONFLICT DO NOTHING""",
            (run_id, jsonb({"allow_live_notifications": True})),
        )
        cur.execute(
            """INSERT INTO notification_outbox (idempotency_key, run_id, incident_id, version, notification_kind, destination_key, payload, state, next_attempt_at)
               VALUES (%s, %s, 'inc-1', 1, 'high_risk_escalation', 'slack:default', %s, %s, now() - interval '1 minute')""",
            (key, run_id, jsonb({"text": "HIGH RISK incident inc-1 v1", "blocks": []}), state),
        )
        conn.commit()


def _worker(db, adapter, now=None):
    clock = {"t": now or datetime.now(UTC)}
    w = SideEffectWorker(db, cfg=load_config(), slack_adapter=adapter, worker_id="w1", now=lambda: clock["t"])
    return w, clock


def test_preview_mode_records_message_without_network(db):
    _seed(db)
    w, _ = _worker(db, PreviewAdapter())
    with connect_direct(db) as conn:
        assert w.deliver_one(conn) == "preview"
        assert w.deliver_one(conn) is None
    row = q(db, "select state, attempts, sent_at, payload->>'text' t from notification_outbox")[0]
    assert row["state"] == "preview" and row["attempts"] == 1 and row["sent_at"] is not None
    assert "HIGH RISK" in row["t"]
    assert q(db, "select notifications_sent from runs where run_id='run-a'")[0]["notifications_sent"] == 0


def test_retry_on_500_then_429_retry_after_then_sent(db):
    _seed(db)
    stub = StubSlack([DeliveryResult("retry", 500, None, "server error 500"), DeliveryResult("retry", 429, 120.0, "rate limited"), DeliveryResult("sent", 200)])
    w, clock = _worker(db, stub)
    with connect_direct(db) as conn:
        assert w.deliver_one(conn) == "retry"
        r = q(db, "select state, attempts, next_attempt_at, last_error from notification_outbox")[0]
        assert r["state"] == "pending" and r["attempts"] == 1 and "500" in r["last_error"]
        assert timedelta(seconds=0.5) <= r["next_attempt_at"] - clock["t"] <= timedelta(seconds=4)  # base 2s with jitter
        assert w.deliver_one(conn) is None  # not yet due
        clock["t"] += timedelta(seconds=5)
        assert w.deliver_one(conn) == "retry"
        r = q(db, "select state, attempts, next_attempt_at from notification_outbox")[0]
        assert r["attempts"] == 2 and r["next_attempt_at"] - clock["t"] >= timedelta(seconds=119)  # honours Retry-After beyond the 60s cap
        clock["t"] += timedelta(seconds=121)
        assert w.deliver_one(conn) == "sent"
    r = q(db, "select state, attempts, sent_at from notification_outbox")[0]
    assert r["state"] == "sent" and r["attempts"] == 3 and r["sent_at"] is not None
    assert q(db, "select notifications_sent from runs where run_id='run-a'")[0]["notifications_sent"] == 1
    assert stub.calls == 3


def test_permanent_400_fails_immediately_and_is_visible(db):
    _seed(db)
    w, _ = _worker(db, StubSlack([DeliveryResult("failed", 400, None, "permanent 400: invalid_payload")]))
    with connect_direct(db) as conn:
        assert w.deliver_one(conn) == "failed"
    r = q(db, "select state, attempts, last_error from notification_outbox")[0]
    assert r["state"] == "failed" and r["attempts"] == 1 and "400" in r["last_error"]
    assert q(db, "select payload->>'outcome' o from ui_updates where type='delivery'")[0]["o"] == "failed"


def test_ambiguous_timeouts_flag_possible_duplicate_and_exhaust(db):
    _seed(db)
    w, clock = _worker(db, StubSlack([DeliveryResult("ambiguous", None, None, "timeout")] * 5))
    with connect_direct(db) as conn:
        for _ in range(5):
            w.deliver_one(conn)
            clock["t"] += timedelta(seconds=120)
    r = q(db, "select state, attempts, delivery_ambiguous, last_error from notification_outbox")[0]
    assert r["state"] == "failed" and r["attempts"] == 5 and r["delivery_ambiguous"] is True
    assert "exhausted" in r["last_error"]


def test_q03_dead_worker_lease_is_reclaimed_and_idempotent(db):
    _seed(db)
    with connect_direct(db) as conn, conn.cursor() as cur:
        cur.execute("UPDATE notification_outbox SET state='leased', lease_owner='dead-worker', lease_expires_at=%s", (datetime.now(UTC) - timedelta(seconds=1),))
        conn.commit()
    w, _ = _worker(db, StubSlack([DeliveryResult("sent", 200)]))
    with connect_direct(db) as conn:
        assert w.deliver_one(conn) == "sent"
        assert w.deliver_one(conn) is None
    assert q(db, "select count(*) n from notification_outbox where state='sent'")[0]["n"] == 1


def test_lost_lease_does_not_overwrite_other_owner(db):
    _seed(db)
    w, _ = _worker(db, StubSlack([DeliveryResult("sent", 200)]))
    with connect_direct(db) as conn:
        row = w.claim_notification(conn)
        assert row is not None
        # Another worker reclaims after our lease expired (simulated) and finishes first.
        with conn.cursor() as cur:
            cur.execute("UPDATE notification_outbox SET lease_owner='w2', state='sent', sent_at=now() WHERE idempotency_key=%s", (row["idempotency_key"],))
        conn.commit()
        w._persist_outcome(conn, row["idempotency_key"], row, DeliveryResult("failed", 400, None, "late failure"), load_config().policy["notifications"])
    assert q(db, "select state, lease_owner from notification_outbox")[0] == {"state": "sent", "lease_owner": "w2"}


def test_replay_run_is_preview_only_even_with_live_adapter(db):
    _seed(db, run_id="run-r", key="run-r:inc:hr")
    with connect_direct(db) as conn, conn.cursor() as cur:
        cur.execute("UPDATE runs SET mode='replay', config='{}'::jsonb WHERE run_id='run-r'")
        conn.commit()
    stub = StubSlack([DeliveryResult("sent", 200)])
    w, _ = _worker(db, stub)
    with connect_direct(db) as conn:
        assert w.deliver_one(conn) == "failed"
    assert stub.calls == 0
    assert "not opted into live delivery" in q(db, "select last_error from notification_outbox")[0]["last_error"]


def test_worker_imports_database_backed_upload_without_a_shared_filesystem(db, tmp_path):
    """The API's disk is not mounted in a separate Railway worker service."""
    content = b'192.168.10.10 - acct_1 [06/Jan/2025:08:00:00 -0400] "GET /dashboard HTTP/1.1" 200 2048\n'
    digest = hashlib.sha256(content).hexdigest()
    dataset_id = dataset_id_for(digest)
    with connect_direct(db) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO datasets (id, content_sha256, original_name, bytes, parse_version, import_state)
               VALUES (%s, %s, 'api-only-upload.log', %s, 'apache_combined_v1', 'pending')""",
            (dataset_id, digest, len(content)),
        )
        cur.execute("INSERT INTO dataset_uploads (dataset_id, content) VALUES (%s, %s)", (dataset_id, content))
        conn.commit()
    worker_upload_dir = tmp_path / "worker-private-files"
    settings = Settings(database_url=db, upload_dir=str(worker_upload_dir))
    worker = SideEffectWorker(db, settings=settings, cfg=load_config(), slack_adapter=PreviewAdapter(), worker_id="worker-other-service")
    with connect_direct(db) as conn:
        assert worker.import_one(conn) == "ready"
    row = q(db, "SELECT import_state, valid_count FROM datasets WHERE id=%s", dataset_id)[0]
    assert row == {"import_state": "ready", "valid_count": 1}
    assert q(db, "SELECT count(*) AS n FROM dataset_uploads WHERE dataset_id=%s", dataset_id)[0]["n"] == 0
    assert list(worker_upload_dir.iterdir()) == []


def test_slack_adapter_classifies_http_outcomes(monkeypatch):
    import httpx

    def handler(request: httpx.Request) -> httpx.Response:
        code = int(json.loads(request.content)["text"])
        headers = {"Retry-After": "7"} if code == 429 else {}
        return httpx.Response(code, headers=headers, text="ok" if code == 200 else "err")

    adapter = SlackWebhookAdapter("https://hooks.example/test", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert adapter.deliver({"text": "200"}).outcome == "sent"
    r429 = adapter.deliver({"text": "429"})
    assert r429.outcome == "retry" and r429.retry_after_seconds == 7.0
    assert adapter.deliver({"text": "503"}).outcome == "retry"
    assert adapter.deliver({"text": "404"}).outcome == "failed"

    def timeout(request):
        raise httpx.ReadTimeout("slow")

    slow = SlackWebhookAdapter("https://hooks.example/test", client=httpx.Client(transport=httpx.MockTransport(timeout)))
    assert slow.deliver({"text": "x"}).outcome == "ambiguous"


def test_explanation_job_falls_back_deterministically_without_provider(db):
    with connect_direct(db) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO runs (run_id, mode, phase, config_hash, feature_version, state) VALUES ('run-x','replay','visible','h','v1','running')")
        packet = {"packet_hash": "ph", "trigger_fact_ids": ["f_a", "f_b"], "facts": [], "unknown_codes": [], "completeness": {}}
        cur.execute("INSERT INTO incidents (run_id, incident_id, key_type, key_value, primary_rule_id, status, current_version, current_class, first_seq, last_seq, first_event_time, last_event_time) VALUES ('run-x','inc','pair','a|b','R1','open',1,'suspicious',1,1,now(),now())")
        cur.execute("INSERT INTO fact_packets (run_id, incident_id, version, cutoff_seq, packet_hash, facts, completeness) VALUES ('run-x','inc',1,1,'ph',%s,'{}')", (jsonb(packet),))
        cur.execute("INSERT INTO explanation_jobs (job_id, run_id, incident_id, version, packet_hash, state, next_attempt_at) VALUES ('j1','run-x','inc',1,'ph','pending', now() - interval '1 minute')")
        conn.commit()
    w, _ = _worker(db, PreviewAdapter())
    with connect_direct(db) as conn:
        assert w.explain_one(conn) == "fallback"
        assert w.explain_one(conn) is None
    ex = q(db, "select state, validated, model_name from explanations")[0]
    assert ex["state"] == "fallback" and ex["model_name"] == "none"
    assert ex["validated"]["ai_review"] == "unavailable" and ex["validated"]["summary_fact_ids"] == ["f_a", "f_b"]
    assert q(db, "select state from explanation_jobs")[0]["state"] == "done"
