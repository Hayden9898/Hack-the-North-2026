"""R01–R06, T02, T04, T05, T06 against a real TimescaleDB with synthetic scenarios (generic entities)."""
from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest

from tests.fixtures.synth import (
    TZ,
    baseline_traffic,
    default_world,
    scenario_access_change,
    scenario_auth_burst,
    scenario_forum_admin,
    scenario_linked_sequence,
)
from tests.helpers import drive, import_world, make_config, q, start_run

pytestmark = pytest.mark.integration

# 10 bootstrap days, 6 train, 6 calibration, then evaluation.
D0 = date(2025, 1, 6)


def _cfg(tmp_path, **overrides):
    return make_config(
        tmp_path,
        bootstrap=(D0, D0 + timedelta(days=10)),
        train=(D0 + timedelta(days=10), D0 + timedelta(days=16)),
        calibration=(D0 + timedelta(days=16), D0 + timedelta(days=22)),
        evaluation=(D0 + timedelta(days=22), D0 + timedelta(days=40)),
        policy_overrides=overrides,
    )


def _world(days=30):
    w = default_world(start=datetime(D0.year, D0.month, D0.day, tzinfo=TZ))
    baseline_traffic(w, days)
    return w


def _eval_day(n: int) -> datetime:
    return datetime(D0.year, D0.month, D0.day, tzinfo=TZ) + timedelta(days=22 + n)


def test_r01_routine_sensitive_access_by_normal_audience_is_normal(db, tmp_path):
    cfg = _cfg(tmp_path)
    w = _world()
    ds = import_world(w, tmp_path, db)
    run_id = start_run(db, cfg, ds)
    run = drive(db, cfg, run_id)
    assert run["state"] == "completed"
    # The CONFIDENTIAL zip is served (200, large) to its audience constantly: never high risk from filename/bytes alone.
    rows = q(db, """select d.threat_class, count(*) n from detections d join processed_events p using (run_id, run_seq)
                    where d.run_id=%s and p.path like '%%CONFIDENTIAL%%' and p.status=200 group by 1""", run_id)
    assert {r["threat_class"] for r in rows} == {"normal"}
    assert q(db, "select count(*) n from incidents where run_id=%s", run_id)[0]["n"] == 0
    assert q(db, "select count(*) n from detections where run_id=%s and threat_class is null", run_id)[0]["n"] == 0


def test_r02_four_unfamiliar_failures_in_60s_fires_r1_with_exact_legs(db, tmp_path):
    cfg = _cfg(tmp_path)
    w = _world()
    t = _eval_day(1) + timedelta(hours=23, minutes=10)
    times = scenario_auth_burst(w, t, victim=w.accounts[1], source_ip=w.ips[w.accounts[3]], n=4, spacing=4)
    ds = import_world(w, tmp_path, db)
    run_id = start_run(db, cfg, ds)
    drive(db, cfg, run_id)
    matches = q(db, "select * from rule_matches where run_id=%s and rule_id='R1' order by run_seq", run_id)
    assert len(matches) == 1, "exactly the 4th failure fires (3 prior + current)"
    m = matches[0]
    assert m["event_time"] == times[3]
    assert m["params"]["failures_in_window"] == 4 and m["params"]["familiarity"] == "unfamiliar"
    roles = [leg["role"] for leg in m["legs"]]
    assert roles == ["prior_failure", "prior_failure", "prior_failure", "current_failure"]
    inc = q(db, "select * from incidents where run_id=%s", run_id)
    assert len(inc) == 1 and inc[0]["current_class"] == "suspicious" and inc[0]["key_type"] == "pair"
    det = q(db, "select d.threat_class from detections d join processed_events p using (run_id, run_seq) where d.run_id=%s and p.status=401 and p.ip_raw=%s and p.username=%s order by run_seq", run_id, w.ips[w.accounts[3]], w.accounts[1])
    assert [d["threat_class"] for d in det] == ["normal", "normal", "normal", "suspicious"]
    # Familiar pair with an isolated 401 never trips R1 (baseline contains many).
    assert q(db, "select count(*) n from rule_matches where run_id=%s and rule_id='R1' and key_value like %s", run_id, f"%|{w.ips[w.accounts[1]]}")[0]["n"] == 0
    # Suspicious notification is a debounced digest, flushed at completion → pending (preview mode delivers later).
    ob = q(db, "select notification_kind, state from notification_outbox where run_id=%s", run_id)
    assert ob == [{"notification_kind": "suspicious_digest", "state": "pending"}]


def test_r03_first_sensitive_success_after_denials_is_suspicious_not_high_risk(db, tmp_path):
    cfg = _cfg(tmp_path)
    w = _world()
    actor = w.accounts[4]  # not in the zip's audience
    path = w.sensitive_paths[0]
    t = scenario_access_change(w, _eval_day(2) + timedelta(hours=11, minutes=27), actor, path, denials=6)
    ds = import_world(w, tmp_path, db)
    run_id = start_run(db, cfg, ds)
    drive(db, cfg, run_id)
    m = q(db, "select * from rule_matches where run_id=%s and rule_id='R2'", run_id)
    assert len(m) == 1 and m[0]["event_time"] == t
    assert m[0]["params"]["prior_denials"] >= 6 and m[0]["params"]["prior_successes"] == 0
    assert m[0]["params"]["prior_denials"] == m[0]["params"]["prior_denials_sql_recount"]
    inc = q(db, "select current_class, key_type, key_value from incidents where run_id=%s", run_id)
    assert inc == [{"current_class": "suspicious", "key_type": "account_resource", "key_value": f"{actor}|{path}"}]
    assert q(db, "select count(*) n from rule_matches where run_id=%s and rule_id in ('R4','R5')", run_id)[0]["n"] == 0
    # Fact packet: prior denial count fact carries a recomputable query identity and the exact cutoff.
    packet = q(db, "select facts from fact_packets where run_id=%s", run_id)[0]["facts"]
    denial_fact = next(f for f in packet["facts"] if f["kind"] == "prior_denials_count")
    assert denial_fact["value"] >= 6 and denial_fact["query"]["id"] == "account_path_status_count"
    assert denial_fact["cutoff_seq"] == packet["cutoff_seq"]
    assert all(f["provenance_hash"] for f in packet["facts"])


def test_r04_r05_linked_sequence_escalates_and_r06_no_mega_merge(db, tmp_path):
    cfg = _cfg(tmp_path)
    w = _world()
    actor, victim = w.accounts[3], w.accounts[1]  # victim is in the zip's audience; actor is not
    path = w.sensitive_paths[0]
    obj = w.forum_objects[5]
    times = scenario_linked_sequence(w, _eval_day(4), actor, victim, obj, path)
    ds = import_world(w, tmp_path, db)
    run_id = start_run(db, cfg, ds)
    run = drive(db, cfg, run_id)
    assert run["state"] == "completed"
    matches = {r["rule_id"]: r for r in q(db, "select * from rule_matches where run_id=%s order by run_seq", run_id) if r["rule_id"] != "R1"}
    r1 = q(db, "select * from rule_matches where run_id=%s and rule_id='R1' order by run_seq", run_id)
    assert len(r1) >= 2  # 4th failure night one, 4th..6th night two
    assert {"R2", "R3", "R4", "R5"} <= set(matches)
    assert matches["R3"]["event_time"] == times["admin"]
    assert matches["R2"]["event_time"] == times["zip"] and matches["R5"]["event_time"] == times["zip"]
    assert matches["R4"]["event_time"] == times["victim_zip"]
    # R5 legs reference valid earlier records: A viewed O, B viewed O, B admin request, all before the zip success.
    legs = {leg["role"]: leg for leg in matches["R5"]["legs"]}
    assert legs["a_viewed_object"]["object_id"] == obj and legs["b_viewed_object"]["account"] == victim
    assert legs["b_admin_request_r3"]["run_seq"] < matches["R5"]["run_seq"]
    assert matches["R5"]["params"]["asserts_role_changed"] is False
    # R4 legs: r1 episode (earlier), successful login, sensitive success.
    roles = [leg["role"] for leg in matches["R4"]["legs"]]
    assert roles == ["r1_episode_match", "successful_login", "sensitive_success"]

    incidents = q(db, "select * from incidents where run_id=%s order by first_seq", run_id)
    by_rule = {i["primary_rule_id"]: i for i in incidents}
    # R1 pair episode escalated by R4 to high risk; R2 access-change escalated by R5; R3 stays its own suspicious episode.
    assert by_rule["R1"]["current_class"] == "high_risk" and by_rule["R1"]["key_type"] == "pair"
    assert by_rule["R2"]["current_class"] == "high_risk"
    assert by_rule["R3"]["current_class"] == "suspicious"
    assert len(incidents) == 3, "no recursive union into one mega incident"
    rel = q(db, "select * from incident_relations where run_id=%s and incident_id=%s", run_id, by_rule["R2"]["incident_id"])
    assert any(r["related_incident_id"] == by_rule["R3"]["incident_id"] and r["link_key"] == obj for r in rel)
    # Original event verdicts preserved: the R3 admin event stays 'suspicious' even after later escalation.
    det = q(db, "select d.threat_class from detections d join processed_events p using (run_id, run_seq) where d.run_id=%s and p.path='/api/admin/role_update'", run_id)
    assert det == [{"threat_class": "suspicious"}]
    # High-risk escalations bypass debounce: two pending high-risk notifications (R2/R5 incident and R1/R4 incident).
    ob = q(db, "select notification_kind, state, incident_id from notification_outbox where run_id=%s order by created_at", run_id)
    kinds = [o["notification_kind"] for o in ob]
    assert kinds.count("high_risk_escalation") == 2
    assert all(o["state"] == "pending" for o in ob)
    # Versions are immutable and monotone.
    vers = q(db, "select incident_id, version, threat_class from incident_versions where run_id=%s order by incident_id, version", run_id)
    for inc in incidents:
        vs = [v for v in vers if v["incident_id"] == inc["incident_id"]]
        assert [v["version"] for v in vs] == list(range(1, len(vs) + 1))
    # Baseline traffic shares nothing with these episodes: unrelated accounts have no incidents.
    assert all(i["account"] in (actor, victim) for i in incidents)


def test_r06_shared_assets_and_subnet_do_not_connect_incidents(db, tmp_path):
    cfg = _cfg(tmp_path)
    w = _world()
    # Two independent unfamiliar bursts against two different victims from two different sources in the same /24.
    scenario_auth_burst(w, _eval_day(1) + timedelta(hours=23), victim=w.accounts[0], source_ip="192.168.10.200", n=4)
    scenario_auth_burst(w, _eval_day(1) + timedelta(hours=23, minutes=2), victim=w.accounts[2], source_ip="192.168.10.201", n=4)
    ds = import_world(w, tmp_path, db)
    run_id = start_run(db, cfg, ds)
    drive(db, cfg, run_id)
    inc = q(db, "select key_value from incidents where run_id=%s order by first_seq", run_id)
    assert len(inc) == 2 and inc[0]["key_value"] != inc[1]["key_value"]
    assert q(db, "select count(*) n from incident_relations where run_id=%s", run_id)[0]["n"] == 0


def test_t02_equal_timestamps_keep_stable_order_and_causal_windows(db, tmp_path):
    cfg = _cfg(tmp_path)
    w = _world(days=24)
    t = _eval_day(1) + timedelta(hours=10)
    src = "192.168.10.222"
    # Four failures at the identical second: the 4th (by original line order) fires and sees 3 preceding ties.
    for _ in range(4):
        w.emit(t, src, w.accounts[0], "POST", "/api/auth/login", 401, 88)
    ds = import_world(w, tmp_path, db)
    run_id = start_run(db, cfg, ds)
    drive(db, cfg, run_id)
    rows = q(db, """select re.run_seq, e.line_number, d.threat_class from run_events re join event_registry e using (event_id)
                    join detections d using (run_id, run_seq) where re.run_id=%s and re.event_time=%s order by re.run_seq""", run_id, t)
    assert [r["line_number"] for r in rows] == sorted(r["line_number"] for r in rows)
    assert [r["threat_class"] for r in rows] == ["normal", "normal", "normal", "suspicious"]
    snaps = q(db, "select observed_context->>'pair_401_60s' as c from feature_snapshots where run_id=%s and event_time=%s order by run_seq", run_id, t)
    assert [s["c"] for s in snaps] == ["0", "1", "2", "3"]


def test_t04_two_runs_are_isolated(db, tmp_path):
    cfg = _cfg(tmp_path)
    w = _world(days=24)
    scenario_auth_burst(w, _eval_day(1) + timedelta(hours=23), victim=w.accounts[0], source_ip="192.168.10.200", n=4)
    ds = import_world(w, tmp_path, db)
    a = start_run(db, cfg, ds)
    b = start_run(db, cfg, ds)
    drive(db, cfg, a)
    drive(db, cfg, b)
    for rid in (a, b):
        assert q(db, "select count(*) n from incidents where run_id=%s", rid)[0]["n"] == 1
        assert q(db, "select count(*) n from notification_outbox where run_id=%s", rid)[0]["n"] == 1
    sa = q(db, "select key_type, key_value, state from entity_stats where run_id=%s order by 1,2", a)
    sb = q(db, "select key_type, key_value, state from entity_stats where run_id=%s order by 1,2", b)
    assert sa == sb  # deterministic and independent
    va = q(db, "select numeric_vector from feature_snapshots where run_id=%s order by run_seq", a)
    vb = q(db, "select numeric_vector from feature_snapshots where run_id=%s order by run_seq", b)
    assert va == vb
    assert q(db, "select count(*) n from ui_updates where run_id=%s", a)[0]["n"] > 0
    assert q(db, "select count(*) n from incident_versions where run_id=%s and incident_id in (select incident_id from incidents where run_id=%s)", a, b)[0]["n"] == 0


class _Crash(RuntimeError):
    pass


def test_t05_crash_before_commit_then_restart_has_no_double_effects(db, tmp_path):
    cfg = _cfg(tmp_path, **{"replay.microbatch": 50})
    w = _world(days=24)
    scenario_auth_burst(w, _eval_day(1) + timedelta(hours=23), victim=w.accounts[0], source_ip="192.168.10.200", n=4)
    ds = import_world(w, tmp_path, db)
    run_id = start_run(db, cfg, ds)
    crashes = {"n": 0}

    def hook(stage, ev):
        # Crash right before the commit of the first three batches that contain the burst's final event.
        if stage == "before_commit" and crashes["n"] < 2:
            crashes["n"] += 1
            raise _Crash("simulated crash before commit")

    run = drive(db, cfg, run_id, fault_hook=hook)
    assert run["state"] == "completed"
    assert crashes["n"] == 2
    total = q(db, "select count(*) n from event_registry", )[0]["n"]
    assert q(db, "select count(*) n from processed_events where run_id=%s", run_id)[0]["n"] == total
    assert q(db, "select count(*) n from detections where run_id=%s", run_id)[0]["n"] == total
    assert q(db, "select processed_seq, admitted_seq from runs where run_id=%s", run_id)[0] == {"processed_seq": total, "admitted_seq": total}
    # Exactly one incident, one outbox key, and account counters equal the number of events per account (no double increments).
    assert q(db, "select count(*) n from incidents where run_id=%s", run_id)[0]["n"] == 1
    assert q(db, "select count(*) n from notification_outbox where run_id=%s", run_id)[0]["n"] == 1
    per_acct = q(db, "select username, count(*) n from processed_events where run_id=%s group by 1 order by 1", run_id)
    stats = {r["key_value"]: r["state"]["n"] for r in q(db, "select key_value, state from entity_stats where run_id=%s and key_type='account'", run_id)}
    assert {r["username"]: r["n"] for r in per_acct} == stats
    # attempts recorded on the retried sequence, but it was never skipped
    assert q(db, "select count(*) n from run_events where run_id=%s and processing_state<>'processed'", run_id)[0]["n"] == 0


def test_t06_poison_record_blocks_run_visibly_without_false_all_clear(db, tmp_path):
    cfg = _cfg(tmp_path, **{"replay.microbatch": 20, "replay.max_attempts": 3})
    w = _world(days=24)
    ds = import_world(w, tmp_path, db)
    run_id = start_run(db, cfg, ds)
    target_line = 500
    poison_id = q(db, "select event_id from event_registry where line_number=%s", target_line)[0]["event_id"]

    def hook(stage, ev):
        if stage == "event" and ev is not None and ev.event_id == poison_id:
            raise ValueError("simulated deterministic processing failure")

    run = drive(db, cfg, run_id, fault_hook=hook)
    assert run["state"] == "blocked"
    assert "ValueError" in run["block_reason"]
    seq = run["blocked_seq"]
    assert q(db, "select processing_state, attempts from run_events where run_id=%s and run_seq=%s", run_id, seq)[0] == {"processing_state": "failed", "attempts": 3}
    assert run["processed_seq"] == seq - 1
    assert q(db, "select count(*) n from detections where run_id=%s and run_seq>=%s", run_id, seq)[0]["n"] == 0
    assert q(db, "select type, payload->>'state' s from ui_updates where run_id=%s order by update_seq desc limit 1", run_id)[0]["s"] == "blocked"
