"""Containment actions end to end: bind → dry run → execute → verify → rollback, plus the response packet.

Exercises the refusals that make the loop trustworthy — execute without a dry run, execute after the binding moved,
double execution — and confirms that a preview execution is never recorded as having changed anything.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from tests.fixtures.synth import TZ, baseline_traffic, default_world, scenario_access_change, scenario_auth_burst
from tests.helpers import drive, import_world, make_config, q

from app.api.main import create_app
from app.settings import get_settings

pytestmark = pytest.mark.e2e

D0 = date(2025, 1, 6)
START = datetime(D0.year, D0.month, D0.day, tzinfo=TZ)


@pytest.fixture
def client(db, tmp_path, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "database_url", db)
    monkeypatch.setattr(s, "config_dir", str(tmp_path / "config"))
    monkeypatch.setattr(s, "upload_dir", str(tmp_path / "uploads"))
    from app.config import get_config

    get_config.cache_clear()
    with TestClient(create_app()) as c:
        yield c
    get_config.cache_clear()


def _cfg(tmp_path):
    return make_config(
        tmp_path,
        bootstrap=(D0, D0 + timedelta(days=10)),
        train=(D0 + timedelta(days=10), D0 + timedelta(days=16)),
        calibration=(D0 + timedelta(days=16), D0 + timedelta(days=22)),
        evaluation=(D0 + timedelta(days=22), D0 + timedelta(days=40)),
    )


def _run_access_change(db, tmp_path):
    """One R2 incident: repeated 403s on a sensitive path, then a first 200."""
    cfg = _cfg(tmp_path)
    w = default_world(start=START)
    baseline_traffic(w, 30)
    actor, path = w.accounts[4], w.sensitive_paths[0]
    scenario_access_change(w, START + timedelta(days=24, hours=11, minutes=27), actor, path, denials=6)
    ds = import_world(w, tmp_path, db)
    from tests.helpers import start_run

    rid = start_run(db, cfg, ds)
    drive(db, cfg, rid)
    inc = q(db, "select incident_id, current_version from incidents where run_id=%s", rid)[0]
    return cfg, rid, inc["incident_id"], actor, path


def _run_auth_burst(db, tmp_path):
    """An R1 incident from an unfamiliar source, which is what makes block_source available."""
    cfg = _cfg(tmp_path)
    w = default_world(start=START)
    baseline_traffic(w, 30)
    victim, source = w.accounts[2], "198.51.100.77"
    scenario_auth_burst(w, START + timedelta(days=25, hours=3), victim, source, n=5)
    ds = import_world(w, tmp_path, db)
    from tests.helpers import start_run

    rid = start_run(db, cfg, ds)
    drive(db, cfg, rid)
    rows = q(db, "select incident_id from incidents where run_id=%s and primary_rule_id='R1'", rid)
    return cfg, rid, rows[0]["incident_id"], victim, source


# ------------------------------------------------------------------------------------------------- binding

def test_actions_are_bound_from_facts_and_listed_with_their_provenance(client, db, tmp_path):
    _, rid, iid, actor, path = _run_access_change(db, tmp_path)
    body = client.get(f"/api/v1/runs/{rid}/incidents/{iid}/actions").json()

    assert body["execution_mode"] == "preview" and body["adapter"] == "preview"
    assert body["contained_at"] is None
    actions = {a["action_id"]: a for a in body["actions"]}
    assert "restore_acl" in actions and "export_response_packet" in actions

    acl = actions["restore_acl"]
    assert acl["available"] is True
    assert acl["params"] == {"account": actor, "path": path}
    # Every parameter names the fact it was read out of.
    assert all(src.startswith("fact:") or src.startswith("incident.") for src in acl["bound_from"].values())
    assert acl["bound_fact_ids"] and acl["proposal"] is None

    # An action whose playbook does not apply to R2 is not offered at all.
    assert "quarantine_object" not in actions


def test_unavailable_actions_state_the_reason(client, db, tmp_path):
    _, rid, iid, _, _ = _run_access_change(db, tmp_path)
    body = client.get(f"/api/v1/runs/{rid}/incidents/{iid}/actions").json()
    unavailable = [a for a in body["actions"] if not a["available"]]
    assert unavailable, "an R2 incident cannot satisfy every action in the catalog"
    assert all(a["unmet"] for a in unavailable)
    assert all(a["checks"] for a in unavailable)


# ------------------------------------------------------------------------------------------------- the loop

def test_dry_run_execute_verify_rollback(client, db, tmp_path):
    _, rid, iid, actor, path = _run_access_change(db, tmp_path)
    base = f"/api/v1/runs/{rid}/incidents/{iid}/actions/restore_acl"

    # Execute is refused until a dry run has been approved.
    r = client.post(f"{base}/execute")
    assert r.status_code == 409 and r.json()["detail"]["error"] == "dry_run_required"

    dry = client.post(f"{base}/dry-run")
    assert dry.status_code == 200, dry.text
    d = dry.json()
    assert d["result"]["applied_to_external_system"] is False
    assert d["result"]["would_issue"]["params"] == {"account": actor, "path": path}
    assert d["result"]["would_issue"]["phase"] == "dry_run"
    assert all(c["ok"] for c in d["result"]["checks"])

    ex = client.post(f"{base}/execute")
    assert ex.status_code == 200, ex.text
    e = ex.json()
    assert e["outcome"] == "preview"
    assert e["result"]["applied_to_external_system"] is False  # honest: nothing was contacted
    assert e["contained_at"] is not None

    # The incident is stamped as contained in preview mode, never as applied.
    inc = q(db, "select contained_at, containment_mode from incidents where run_id=%s and incident_id=%s", rid, iid)[0]
    assert inc["contained_at"] is not None and inc["containment_mode"] == "preview"

    # Executing twice is refused rather than silently repeated.
    again = client.post(f"{base}/execute")
    assert again.status_code == 409 and again.json()["detail"]["error"] == "already_executed"

    v = client.post(f"{base}/verify")
    assert v.status_code == 200
    ver = v.json()["verification"]
    assert ver["query_id"] == "success_on_path_after"
    assert ver["status"] in ("satisfied", "contradicted", "pending")
    assert ver["criterion"]

    rb = client.post(f"{base}/rollback")
    assert rb.status_code == 200 and rb.json()["outcome"] == "preview"
    inc = q(db, "select contained_at, containment_mode from incidents where run_id=%s and incident_id=%s", rid, iid)[0]
    assert inc["contained_at"] is None and inc["containment_mode"] is None

    # Rolling back twice is refused.
    assert client.post(f"{base}/rollback").status_code == 409


def test_every_phase_is_recorded_in_the_append_only_log(client, db, tmp_path):
    _, rid, iid, _, _ = _run_access_change(db, tmp_path)
    base = f"/api/v1/runs/{rid}/incidents/{iid}/actions/restore_acl"
    for step in ("dry-run", "execute", "verify", "rollback"):
        assert client.post(f"{base}/{step}").status_code == 200

    log = q(db, "select phase, operator, adapter, outcome, request, result from action_log where run_id=%s order by id", rid)
    assert [r["phase"] for r in log] == ["dry_run", "execute", "verify", "rollback"]
    assert all(r["operator"] for r in log)
    assert all(r["request"] for r in log)
    assert log[1]["result"]["verification"]["criterion"]

    listed = client.get(f"/api/v1/runs/{rid}/incidents/{iid}/actions").json()
    assert [r["phase"] for r in listed["log"]] == ["dry_run", "execute", "verify", "rollback"]

    # SSE consumers see the action phases.
    kinds = [r["payload"]["phase"] for r in q(db, "select payload from ui_updates where run_id=%s and type='action' order by update_seq", rid)]
    assert kinds == ["dry_run", "execute", "rollback"]


def test_execute_is_refused_when_the_binding_moved_since_the_dry_run(client, db, tmp_path):
    _, rid, iid, _, _ = _run_access_change(db, tmp_path)
    base = f"/api/v1/runs/{rid}/incidents/{iid}/actions/restore_acl"
    assert client.post(f"{base}/dry-run").status_code == 200

    # Simulate the evidence behind the action moving after approval.
    with __import__("app.db.engine", fromlist=["connect_direct"]).connect_direct(db) as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE action_proposals SET params_hash='stale' WHERE run_id=%s", (rid,))
        conn.commit()

    r = client.post(f"{base}/execute")
    assert r.status_code == 409 and r.json()["detail"]["error"] == "binding_changed"
    assert q(db, "select state from action_proposals where run_id=%s", rid)[0]["state"] == "dry_run"


def test_preconditions_are_rechecked_at_execute_time(client, db, tmp_path):
    _, rid, iid, _, _ = _run_access_change(db, tmp_path)
    base = f"/api/v1/runs/{rid}/incidents/{iid}/actions/restore_acl"
    assert client.post(f"{base}/dry-run").status_code == 200

    # Another analyst closes the incident between approval and execution.
    client.post(
        f"/api/v1/runs/{rid}/incidents/{iid}/feedback",
        json={"reviewer": "someone", "disposition": "benign_explained", "reason": "approved change, confirmed with the owner"},
    )
    r = client.post(f"{base}/execute")
    assert r.status_code == 409 and r.json()["detail"]["error"] == "preconditions_unmet"
    assert "closed" in r.json()["detail"]["message"]


def test_an_inapplicable_action_is_a_404_not_a_500(client, db, tmp_path):
    _, rid, iid, _, _ = _run_access_change(db, tmp_path)
    r = client.post(f"/api/v1/runs/{rid}/incidents/{iid}/actions/quarantine_object/dry-run")
    assert r.status_code == 404 and r.json()["detail"]["error"] == "action_not_applicable"


def test_block_source_binds_the_unfamiliar_source(client, db, tmp_path):
    _, rid, iid, victim, source = _run_auth_burst(db, tmp_path)
    body = client.get(f"/api/v1/runs/{rid}/incidents/{iid}/actions").json()
    actions = {a["action_id"]: a for a in body["actions"]}
    assert actions["revoke_sessions"]["available"] is True
    block = actions["block_source"]
    assert block["available"] is True and block["params"] == {"account": victim, "source": source}
    assert block["impact"] and "shared" in block["impact"]  # the blast radius is stated before approval

    assert client.post(f"/api/v1/runs/{rid}/incidents/{iid}/actions/block_source/dry-run").status_code == 200
    ex = client.post(f"/api/v1/runs/{rid}/incidents/{iid}/actions/block_source/execute").json()
    assert ex["outcome"] == "preview"
    v = client.post(f"/api/v1/runs/{rid}/incidents/{iid}/actions/block_source/verify").json()["verification"]
    assert v["query_id"] == "events_from_source_after" and v["status"] in ("satisfied", "contradicted", "pending")


# ------------------------------------------------------------------------------------------------- response packet

def test_response_packet_renders_from_committed_evidence(client, db, tmp_path):
    _, rid, iid, actor, path = _run_access_change(db, tmp_path)
    r = client.get(f"/api/v1/runs/{rid}/incidents/{iid}/response-packet")
    assert r.status_code == 200
    body = r.json()
    md = body["markdown"]
    assert body["content_sha256"] and body["fact_packet_hash"]
    assert f"# Response packet — incident {iid[:12]}" in md
    assert actor in md and path in md
    assert "## What these logs cannot tell you" in md
    assert "## Containment actions bound to this incident" in md
    assert "no parameter came from a language model" in md

    dl = client.get(f"/api/v1/runs/{rid}/incidents/{iid}/response-packet", params={"download": True})
    assert dl.headers["content-type"].startswith("text/markdown")
    assert "attachment" in dl.headers["content-disposition"]


def test_storing_a_packet_queues_a_handoff_through_the_outbox(client, db, tmp_path):
    _, rid, iid, _, _ = _run_access_change(db, tmp_path)
    r = client.post(f"/api/v1/runs/{rid}/incidents/{iid}/response-packet")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["notification_queued"] is True

    stored = q(db, "select content_sha256, markdown, created_by from response_packets where packet_id=%s", body["packet_id"])
    assert stored and stored[0]["content_sha256"] == body["content_sha256"]

    out = q(db, "select notification_kind, state, payload from notification_outbox where run_id=%s and notification_kind='response_packet'", rid)
    assert len(out) == 1 and out[0]["state"] == "pending"
    assert body["content_sha256"][:16] in out[0]["payload"]["text"]

    # Re-storing the identical packet is idempotent: one row, one queued message.
    again = client.post(f"/api/v1/runs/{rid}/incidents/{iid}/response-packet").json()
    assert again["packet_id"] == body["packet_id"] and again["notification_queued"] is False
    assert len(q(db, "select 1 from notification_outbox where run_id=%s and notification_kind='response_packet'", rid)) == 1


def test_run_counts_report_containment(client, db, tmp_path):
    _, rid, iid, _, _ = _run_access_change(db, tmp_path)
    before = client.get(f"/api/v1/runs/{rid}").json()["counts"]["containment"]
    assert before["actionable"] >= 1 and before["contained"] == 0 and before["median_seconds"] is None

    base = f"/api/v1/runs/{rid}/incidents/{iid}/actions/restore_acl"
    client.post(f"{base}/dry-run")
    client.post(f"{base}/execute")

    after = client.get(f"/api/v1/runs/{rid}").json()["counts"]["containment"]
    assert after["contained"] == 1 and after["preview"] == 1 and after["applied"] == 0
    assert after["median_seconds"] is not None and after["median_seconds"] >= 0
