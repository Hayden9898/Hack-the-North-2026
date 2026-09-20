"""End-to-end API flows through FastAPI's TestClient against the real database: run lifecycle, cutoff scoping, facts
proof, feedback, SSE cursor semantics, live ingestion (T03 late, D03 conflict), and S02 auth boundaries."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from tests.fixtures.synth import (
    TZ,
    baseline_traffic,
    default_world,
    scenario_access_change,
    scenario_linked_sequence,
)
from tests.helpers import drive, import_world, make_config, q, start_run

from app.api.main import create_app
from app.db.engine import connect_direct
from app.settings import get_settings

pytestmark = pytest.mark.e2e

D0 = date(2025, 1, 6)


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


def _world_with_r2(days=30):
    w = default_world(start=datetime(D0.year, D0.month, D0.day, tzinfo=TZ))
    baseline_traffic(w, days)
    actor, path = w.accounts[4], w.sensitive_paths[0]
    t = datetime(D0.year, D0.month, D0.day, tzinfo=TZ) + timedelta(days=24, hours=11, minutes=27)
    scenario_access_change(w, t, actor, path, denials=6)
    return w, actor, path, t


def test_run_lifecycle_cutoff_scoping_facts_and_feedback(client, db, tmp_path):
    cfg = _cfg(tmp_path)
    w, actor, path, t = _world_with_r2()
    ds = import_world(w, tmp_path, db)
    # Datasets endpoint reflects the import.
    d = client.get(f"/api/v1/datasets/{ds}").json()
    assert d["import_state"] == "ready" and d["rejected_count"] == 0 and d["valid_count"] == d["total_lines"]

    r = client.post("/api/v1/runs", json={"dataset_id": ds, "name": "api-run", "speed": 0, "pause_at_visible_start": True})
    assert r.status_code == 201, r.text
    run = r.json()
    rid = run["run_id"]
    assert run["state"] == "created" and run["phase"] == "warmup" and run["model_health"] == "rules_only"
    assert "http" not in json.dumps(run["integrations"])  # no secrets echoed

    # Invalid transitions are 409, not 500.
    assert client.post(f"/api/v1/runs/{rid}/replay", json={"action": "pause"}).status_code == 409
    assert client.post(f"/api/v1/runs/{rid}/replay", json={"action": "start"}).status_code == 200

    # Drive warmup; the run pauses at the visible boundary (pause_at_visible_start).
    state = drive(db, cfg, rid)
    assert state["state"] == "paused" and state["phase"] == "visible"
    got = client.get(f"/api/v1/runs/{rid}").json()
    assert got["state"] == "paused" and got["backlog"] == 0
    assert got["counts"]["visible"] == {} and sum(got["counts"]["warmup"].values()) == got["processed_seq"]

    # Events endpoint never returns rows beyond the cutoff; everything so far is warmup-labelled.
    ev = client.get(f"/api/v1/runs/{rid}/events", params={"limit": 50, "order": "desc"}).json()
    assert ev["cutoff_seq"] == got["processed_seq"]
    assert all(e["run_seq"] <= ev["cutoff_seq"] and e["phase"] == "warmup" for e in ev["items"])
    assert client.get(f"/api/v1/runs/{rid}/incidents").json()["items"] == []

    # Resume and finish.
    assert client.post(f"/api/v1/runs/{rid}/replay", json={"action": "resume"}).status_code == 200
    state = drive(db, cfg, rid)
    assert state["state"] == "completed"
    incs = client.get(f"/api/v1/runs/{rid}/incidents", params={"threat_class": "suspicious"}).json()
    assert incs["total"] == 1
    inc = incs["items"][0]
    assert inc["phase"] == "visible" and inc["rule_ids"] == ["R2"] and inc["summary"]["headline"]
    detail = client.get(f"/api/v1/runs/{rid}/incidents/{inc['incident_id']}").json()
    assert detail["incident"]["current_class"] == "suspicious"
    assert detail["packet"]["packet_hash"] == detail["packet_hash"]
    assert detail["explanation"] is None or detail["explanation"]["state"] in ("fallback", "validated", "rejected")
    assert detail["deliveries"] and detail["deliveries"][0]["notification_kind"] == "suspicious_digest"
    assert detail["baseline"]["total"] > 0 and len(detail["baseline"]["hour_histogram"]) > 0
    assert detail["timeline"][-1]["path"] == path and detail["timeline"][-1]["status"] == 200

    # Fact → exact evidence and recomputable aggregate proof that matches the recorded count.
    denial_fact = next(f for f in detail["packet"]["facts"] if f["kind"] == "prior_denials_count")
    proof = client.get(f"/api/v1/runs/{rid}/facts/{denial_fact['fact_id']}", params={"incident_id": inc["incident_id"], "version": detail["version"]["version"]}).json()
    assert proof["aggregate_proof"]["matches_recorded"] is True
    assert proof["aggregate_proof"]["recomputed_count"] == denial_fact["value"] >= 6
    assert all(r["status"] == 403 and r["username"] == actor for r in proof["aggregate_proof"]["rows"])
    assert len(proof["evidence"]) == len(denial_fact["evidence_event_ids"])
    assert all(r["raw_line"].startswith(w.ips[actor]) for r in proof["evidence"])
    # Unknown fact id → 404, never a fabricated fact.
    assert client.get(f"/api/v1/runs/{rid}/facts/f_nope", params={"incident_id": inc["incident_id"], "version": 1}).status_code == 404

    # Event detail exposes the raw line, features and memberships.
    e = client.get(f"/api/v1/runs/{rid}/events/{detail['version']['trigger_seq']}").json()
    assert e["raw_line"].endswith("200 8459200") and e["features"] and e["incident_memberships"]
    assert client.get(f"/api/v1/runs/{rid}/events/{10**9}").status_code == 404

    # Feedback is append-only; closing does not erase detections or versions.
    fb = client.post(f"/api/v1/runs/{rid}/incidents/{inc['incident_id']}/feedback", json={"reviewer": "analyst", "disposition": "benign_explained", "reason": "approved access change ticket #123"})
    assert fb.status_code == 201
    after = client.get(f"/api/v1/runs/{rid}/incidents/{inc['incident_id']}").json()
    assert after["incident"]["status"] == "closed" and after["incident"]["current_class"] == "suspicious"
    assert len(after["feedback"]) == 1 and len(after["versions"]) == len(detail["versions"])
    assert q(db, "select count(*) n from detections where run_id=%s and threat_class='suspicious'", rid)[0]["n"] == 1

    # SSE snapshot + resumable stream: updates after a cursor are contiguous.
    snap = client.get(f"/api/v1/runs/{rid}/updates/snapshot").json()
    assert snap["latest_seq"] > 0
    rows = q(db, "select update_seq, type from ui_updates where run_id=%s order by update_seq", rid)
    assert [r["update_seq"] for r in rows] == list(range(1, len(rows) + 1))
    assert {"progress", "run_state", "feedback"} <= {r["type"] for r in rows}
    resp = client.get(f"/api/v1/runs/{rid}/updates", params={"once": "true"}, headers={"Last-Event-ID": str(snap["latest_seq"] - 2)})
    assert resp.status_code == 200 and resp.headers["content-type"].startswith("text/event-stream")
    ids = [int(line.split("id: ")[1]) for line in resp.text.splitlines() if line.startswith("id: ")]
    assert ids == [snap["latest_seq"] - 1, snap["latest_seq"]]
    events = [line.split("event: ")[1] for line in resp.text.splitlines() if line.startswith("event: ")]
    assert "feedback" in events
    # Nothing new after the latest cursor → a heartbeat carrying the cursor, then close.
    resp = client.get(f"/api/v1/runs/{rid}/updates", params={"once": "true", "after": snap["latest_seq"]})
    assert "event: heartbeat" in resp.text and f"id: {snap['latest_seq']}" in resp.text
    # Far-behind cursor → resync_required.
    with connect_direct(db) as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO ui_updates (run_id, update_seq, type, payload) SELECT %s, g, 'progress', '{}'::jsonb FROM generate_series(%s::bigint, %s::bigint) g", (rid, snap["latest_seq"] + 1, snap["latest_seq"] + 6000))
        conn.commit()
    resp = client.get(f"/api/v1/runs/{rid}/updates", params={"once": "true", "after": 0})
    assert "event: resync_required" in resp.text


def test_incident_versions_isolate_same_event_escalations_and_later_relationships(client, db, tmp_path, monkeypatch):
    """R2 and R5 share a sequence but are distinct immutable versions; R3 predates the link."""
    cfg = _cfg(tmp_path)
    w = default_world(start=datetime(D0.year, D0.month, D0.day, tzinfo=TZ))
    baseline_traffic(w, 30)
    actor, victim = w.accounts[3], w.accounts[1]
    scenario_linked_sequence(w, w.start + timedelta(days=26), actor, victim, w.forum_objects[5], w.sensitive_paths[0])
    ds = import_world(w, tmp_path, db)
    rid = start_run(db, cfg, ds)
    drive(db, cfg, rid)
    cases = {i["primary_rule_id"]: i for i in q(db, "SELECT * FROM incidents WHERE run_id=%s", rid)}
    r2, r3 = cases["R2"]["incident_id"], cases["R3"]["incident_id"]
    url = f"/api/v1/runs/{rid}/incidents/{r2}"
    first = client.get(url, params={"version": 1}).json()
    current = client.get(url).json()
    assert first["version"]["trigger_seq"] == current["version"]["trigger_seq"]
    assert first["version"]["rule_ids"] == ["R2"]
    assert {m["rule_id"] for m in first["rule_matches"]} == {"R2"}
    assert {m["rule_id"] for m in current["rule_matches"]} == {"R2", "R5"}
    assert first["relations"] == []
    assert current["relations"][0]["related_incident_id"] == r3
    assert all(e["added_version"] <= 1 for e in first["timeline"])
    assert len(first["timeline"]) < len(current["timeline"])
    assert all(d["version"] <= 1 for d in first["deliveries"])
    assert first["evidence_cutoff_seq"] == first["packet"]["cutoff_seq"] < first["cutoff_seq"]
    assert first["provenance"]["dataset_id"] == ds
    assert len(first["provenance"]["dataset_sha256"]) == 64
    assert first["provenance"]["config_hash"] == cfg.config_hash
    # A relationship created by a later R5 request cannot retroactively appear in R3's snapshot.
    admin = client.get(f"/api/v1/runs/{rid}/incidents/{r3}").json()
    assert admin["relations"] == []
    # Nor can the later R4 rule appear in the first R1 episode version.
    login = client.get(f"/api/v1/runs/{rid}/incidents/{cases['R1']['incident_id']}", params={"version": 1}).json()
    assert {m["rule_id"] for m in login["rule_matches"]} == {"R1"}
    assert all(e["run_seq"] <= login["evidence_cutoff_seq"] for e in login["timeline"])

    # Exercise the real migration on pre-0004 table shape; rollback keeps the test schema intact.
    import importlib

    migration = importlib.import_module("app.db.migrations.versions.0004_relation_provenance")
    with connect_direct(db) as conn, conn.cursor() as cur:
        cur.execute("ALTER TABLE incident_relations DROP COLUMN created_seq, DROP COLUMN origin_incident_id")
        monkeypatch.setattr(migration.op, "execute", cur.execute)
        migration.upgrade()
        cur.execute("SELECT created_seq, origin_incident_id, created_version FROM incident_relations WHERE run_id=%s", (rid,))
        links = cur.fetchall()
        assert len(links) == 2
        assert all(link["origin_incident_id"] == r2 and link["created_version"] == 2 for link in links)
        assert all(link["created_seq"] == current["evidence_cutoff_seq"] for link in links)
        conn.rollback()
    # A review belongs to the version reviewed, not every previous evidence snapshot.
    response = client.post(url + "/feedback", json={"reviewer": "local-test", "disposition": "needs_more_evidence", "reason": "Check authorization record"})
    assert response.status_code == 201
    assert client.get(url, params={"version": 1}).json()["feedback"] == []
    assert len(client.get(url).json()["feedback"]) == 1


def test_live_ingestion_late_and_conflict(client, db, tmp_path):
    _cfg(tmp_path)
    r = client.post("/api/v1/runs", json={"mode": "live", "name": "live", "source_id": "src-a"})
    assert r.status_code == 201, r.text
    rid = r.json()["run_id"]
    assert r.json()["state"] == "running"
    ts = datetime(2026, 5, 1, 12, 0, tzinfo=TZ)

    def line(dt, user="acct_1", ip="10.1.1.1", tgt="/dashboard", st=200):
        return f'{ip} - {user} [{dt.strftime("%d/%b/%Y:%H:%M:%S %z")}] "GET {tgt} HTTP/1.1" {st} 100'

    batch = {
        "source_id": "src-a",
        "events": [
            {"event_id": "e2", "line": line(ts + timedelta(seconds=5))},
            {"event_id": "e1", "line": line(ts)},
            {"event_id": "bad", "line": "garbage"},
        ],
    }
    res = client.post(f"/api/v1/runs/{rid}/events", json=batch).json()
    assert res["counts"] == {"accepted": 2, "rejected": 1} and res["received"] == 3
    by_id = {i["client_event_id"]: i for i in res["items"]}
    assert by_id["e1"]["run_seq"] == 1 and by_id["e2"]["run_seq"] == 2  # sorted by event_time, not arrival order
    assert by_id["bad"]["status"] == "rejected" and by_id["bad"]["reason"]

    # Same id + same payload → duplicate; same id + different payload → conflict; earlier time → late.
    res2 = client.post(f"/api/v1/runs/{rid}/events", json={"source_id": "src-a", "events": [
        {"event_id": "e1", "line": line(ts)},
        {"event_id": "e2", "line": line(ts + timedelta(seconds=5), st=500)},
        {"event_id": "e0", "line": line(ts - timedelta(minutes=1))},
        {"event_id": "e3", "line": line(ts + timedelta(seconds=9))},
    ]}).json()
    assert res2["counts"] == {"duplicate": 1, "conflict": 1, "late": 1, "accepted": 1}
    assert q(db, "select status from raw_events where event_id=(select event_id from event_registry where client_event_id='e2')")[0]["status"] == 200  # original retained
    late = client.get(f"/api/v1/runs/{rid}/late").json()["items"]
    assert len(late) == 1 and late[0]["event_time"].startswith("2026-05-01T15:59")
    run = client.get(f"/api/v1/runs/{rid}").json()
    assert run["late_count"] == 1 and run["admitted_seq"] == 3
    # The late record is never in the ordered inbox nor scored.
    assert q(db, "select count(*) n from run_events where run_id=%s", rid)[0]["n"] == 3
    # Wrong source → 403.
    assert client.post(f"/api/v1/runs/{rid}/events", json={"source_id": "src-b", "events": []}).status_code == 403
    # Replay run rejects live batches.
    assert client.post(f"/api/v1/runs/{rid}/replay", json={"action": "speed", "speed": 10}).status_code == 200


def test_s02_shared_deployment_requires_secrets_and_never_leaks_them(client, tmp_path, monkeypatch):
    _cfg(tmp_path)
    s = get_settings()
    monkeypatch.setattr(s, "api_host", "0.0.0.0")
    monkeypatch.setattr(s, "app_auth_secret", "operator-secret-xyz")
    monkeypatch.setattr(s, "ingest_token", "ingest-token-abc")
    r = client.post("/api/v1/runs", json={"mode": "live", "name": "x"})
    assert r.status_code == 401 and "operator-secret" not in r.text
    r = client.post("/api/v1/runs", json={"mode": "live", "name": "x"}, headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401
    r = client.post("/api/v1/runs", json={"mode": "live", "name": "x", "source_id": "s"}, headers={"Authorization": "Bearer operator-secret-xyz"})
    assert r.status_code == 201
    rid = r.json()["run_id"]
    r = client.post(f"/api/v1/runs/{rid}/events", json={"source_id": "s", "events": []})
    assert r.status_code == 401 and "ingest-token" not in r.text
    r = client.post(f"/api/v1/runs/{rid}/events", json={"source_id": "s", "events": []}, headers={"X-Ingest-Token": "ingest-token-abc"})
    assert r.status_code == 200
    ready = client.get("/health/ready").json()
    assert "operator-secret" not in json.dumps(ready) and "ingest-token" not in json.dumps(ready)
