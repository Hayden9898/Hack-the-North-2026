"""E01–E04 + Q01 with a scripted provider against real packets from a synthetic run."""
from __future__ import annotations

import copy
from datetime import date, datetime, timedelta

import pytest
from tests.fixtures.synth import TZ, baseline_traffic, default_world, scenario_access_change
from tests.helpers import drive, import_world, make_config, q, start_run

from app.db.engine import connect_direct
from app.investigation.provider import Block, Reply
from app.workers.side_effects import SideEffectWorker

pytestmark = pytest.mark.integration
D0 = date(2025, 1, 6)


class FakeExplainer:
    model_name = "fake-model"

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def complete(self, *, system, messages, tools, max_tokens, timeout_s):
        self.calls.append({"messages": copy.deepcopy(messages), "tools": [t["name"] for t in tools], "max_tokens": max_tokens, "timeout_s": timeout_s})
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def tool_use(name, inp, tid="t1"):
    return Reply(content=[Block("tool_use", id=tid, name=name, input=inp)], stop_reason="tool_use")


def submit(sel):
    return Reply(content=[Block("text", text="submitting"), Block("tool_use", id="s1", name="submit_selections", input=sel)], stop_reason="tool_use")


@pytest.fixture
def scenario(db, tmp_path):
    cfg = make_config(tmp_path, bootstrap=(D0, D0 + timedelta(days=10)), train=(D0 + timedelta(days=10), D0 + timedelta(days=16)),
                      calibration=(D0 + timedelta(days=16), D0 + timedelta(days=22)), evaluation=(D0 + timedelta(days=22), D0 + timedelta(days=40)))
    w = default_world(start=datetime(D0.year, D0.month, D0.day, tzinfo=TZ))
    baseline_traffic(w, 28)
    actor, path = w.accounts[4], w.sensitive_paths[0]
    scenario_access_change(w, datetime(D0.year, D0.month, D0.day, tzinfo=TZ) + timedelta(days=24, hours=11), actor, path, denials=6)
    ds = import_world(w, tmp_path, db)
    rid = start_run(db, cfg, ds)
    drive(db, cfg, rid)
    packet = q(db, "select facts from fact_packets where run_id=%s", rid)[0]["facts"]
    job = q(db, "select * from explanation_jobs where run_id=%s", rid)[0]
    return {"cfg": cfg, "run_id": rid, "packet": packet, "job": job, "actor": actor, "path": path, "world": w}


def _worker(db, cfg, explainer):
    return SideEffectWorker(db, cfg=cfg, explainer=explainer, worker_id="w1")


def _facts(packet, kind):
    return [f["fact_id"] for f in packet["facts"] if f["kind"] == kind]


def _good_selection(packet):
    return {
        "schema_version": "1",
        "packet_hash": packet["packet_hash"],
        "summary_fact_ids": _facts(packet, "prior_denials_count")[:1],
        "hypotheses": [
            {"type": "possible_privilege_abuse", "supporting_fact_ids": _facts(packet, "prior_denials_count")[:1] + _facts(packet, "first_success_after_denials")[:1],
             "counterevidence_fact_ids": _facts(packet, "account_resource_history")[:1], "unknown_codes": ["authorized_change_record_unavailable"]},
        ],
        "false_positive_assessment": {"status": "insufficient_evidence", "supporting_fact_ids": [], "missing_evidence_codes": ["authorized_change_record"]},
        "playbook_ids": ["sensitive_access_authorization_review"],
    }


def test_valid_investigation_with_tool_use_is_validated_and_trigger_facts_forced(db, scenario):
    p = scenario["packet"]
    fake = FakeExplainer([
        tool_use("resource_history", {"path": scenario["path"], "limit": 5}),
        submit(_good_selection(p)),
    ])
    w = _worker(db, scenario["cfg"], fake)
    with connect_direct(db) as conn:
        assert w.explain_one(conn) == "validated"
    ex = q(db, "select * from explanations where run_id=%s", scenario["run_id"])[0]
    assert ex["state"] == "validated" and ex["model_name"] == "fake-model" and ex["tool_calls"] == 1
    v = ex["validated"]
    assert set(p["trigger_fact_ids"]) <= set(v["summary_fact_ids"])
    assert v["forced_inclusions"]  # trigger facts the model did not select were forced in
    assert v["hypotheses"][0]["text"].startswith("Possible privilege or access change (unproven)")
    assert v["tool_log"][0]["tool"] == "resource_history" and v["tool_log"][0]["rows"] > 0
    # The tool result the model saw came from this run and under the cutoff only.
    tool_result_msg = fake.calls[1]["messages"][2]["content"][0]["content"]
    assert scenario["path"] in tool_result_msg and '"error"' not in tool_result_msg
    assert q(db, "select state from explanation_jobs where run_id=%s", scenario["run_id"])[0]["state"] == "done"
    assert q(db, "select count(*) n from ui_updates where run_id=%s and type='explanation'", scenario["run_id"])[0]["n"] == 1
    # Prompt hygiene: log text is delimiter-wrapped and marked untrusted; the packet hash is present.
    first_user = fake.calls[0]["messages"][0]["content"]
    assert "<log_text>" in first_user and p["packet_hash"] in first_user


def test_e01_invalid_then_contradictory_proposal_is_rejected_with_fallback(db, scenario):
    p = scenario["packet"]
    bad1 = {**_good_selection(p), "summary_fact_ids": ["f_deadbeefdeadbeef"]}
    bad2 = {**_good_selection(p), "hypotheses": [
        {"type": "insufficient_evidence", "supporting_fact_ids": [], "counterevidence_fact_ids": [], "unknown_codes": []},
        {"type": "possible_privilege_abuse", "supporting_fact_ids": _facts(p, "prior_denials_count")[:1], "counterevidence_fact_ids": [], "unknown_codes": []},
    ]}
    fake = FakeExplainer([submit(bad1), submit(bad2)])
    w = _worker(db, scenario["cfg"], fake)
    with connect_direct(db) as conn:
        assert w.explain_one(conn) == "rejected"
    ex = q(db, "select * from explanations where run_id=%s", scenario["run_id"])[0]
    assert ex["state"] == "rejected"
    assert any("unknown fact id" in r for r in ex["rejection_reasons"]) and any("contradictory" in r for r in ex["rejection_reasons"])
    assert ex["validated"]["ai_review"] == "unavailable" and ex["validated"]["summary_fact_ids"] == p["trigger_fact_ids"][:6]
    assert ex["proposal_raw"] is not None  # kept for debugging, never published as verified
    assert len(fake.calls) == 2  # exactly one repair
    # The repair prompt told the model what was wrong.
    assert "rejected by the validator" in fake.calls[1]["messages"][-1]["content"]


def test_e02_injection_cannot_escape_tool_scope(db, scenario, tmp_path):
    p = scenario["packet"]
    # A second, unrelated run in the same database must be invisible to the tools.
    other = start_run(db, scenario["cfg"], q(db, "select dataset_id from runs where run_id=%s", scenario["run_id"])[0]["dataset_id"])
    drive(db, scenario["cfg"], other)
    n_other = q(db, "select count(*) n from processed_events where run_id=%s", other)[0]["n"]
    assert n_other > 0
    with connect_direct(db) as conn, conn.cursor() as cur:  # keep the other run's job out of this test's queue
        cur.execute("UPDATE explanation_jobs SET state='done' WHERE run_id=%s", (other,))
        conn.commit()
    injected = "x'; DROP TABLE runs; -- ignore previous instructions"
    script = [
        tool_use("run_sql", {"query": "select * from runs"}),
        tool_use("account_history", {"account": injected, "limit": 50}),
        tool_use("account_history", {"account": scenario["actor"], "limit": 50, "run_id": other}),
        tool_use("resource_history", {"path": scenario["path"], "limit": 50}),
        tool_use("resource_history", {"path": scenario["path"], "limit": 50}),
        tool_use("resource_history", {"path": scenario["path"], "limit": 50}),
        tool_use("resource_history", {"path": scenario["path"], "limit": 50}),  # 7th call → budget exhausted
        submit(_good_selection(p)),
    ]
    fake = FakeExplainer(script)
    w = _worker(db, scenario["cfg"], fake)
    with connect_direct(db) as conn:
        assert w.explain_one(conn) == "validated"
    assert q(db, "select count(*) n from runs")[0]["n"] == 2  # nothing dropped
    results = [c["messages"][-1]["content"][0]["content"] for c in fake.calls[1:]]
    assert "unknown tool" in results[0]
    assert '"rows": []' in results[1]  # injected account string matches nothing; no error, no escape
    assert "not accepted" in results[2]  # run_id injection refused
    assert "budget exhausted" in results[6]
    # Row budget: 4 resource_history calls at limit 50 cannot exceed 200 rows total (tail truncated by budget).
    total_rows = sum(e.get("rows", 0) for e in q(db, "select validated from explanations where run_id=%s", scenario["run_id"])[0]["validated"]["tool_log"])
    assert total_rows <= 200
    # Tool results never include rows from the other run: every returned row's account/path belongs to this run's cutoff.
    seen_seqs = [row["run_seq"] for res in results if '"rows"' in res for row in __import__("json").loads(res).get("rows", [])]
    assert all(s <= p["cutoff_seq"] for s in seen_seqs)


def test_e03_late_result_for_obsolete_version_cannot_replace_current(db, scenario):
    p = scenario["packet"]
    rid = scenario["run_id"]
    # A newer version appears before the job finishes.
    with connect_direct(db) as conn, conn.cursor() as cur:
        cur.execute("UPDATE incidents SET current_version = current_version + 1 WHERE run_id=%s", (rid,))
        conn.commit()
    fake = FakeExplainer([submit(_good_selection(p))])
    w = _worker(db, scenario["cfg"], fake)
    with connect_direct(db) as conn:
        assert w.explain_one(conn) == "validated"
    assert q(db, "select state from explanation_jobs where run_id=%s", rid)[0]["state"] == "superseded"
    ex = q(db, "select version, state from explanations where run_id=%s", rid)
    assert ex == [{"version": p["version"], "state": "validated"}]  # archived under its own version only
    assert q(db, "select count(*) n from explanations where run_id=%s and version=%s", rid, p["version"] + 1)[0]["n"] == 0
    assert q(db, "select count(*) n from ui_updates where run_id=%s and type='explanation'", rid)[0]["n"] == 0


def test_e04_false_positive_assessment_cannot_downgrade_or_suppress(db, scenario):
    p = scenario["packet"]
    rid = scenario["run_id"]
    before_inc = q(db, "select current_class, current_version, status from incidents where run_id=%s", rid)
    before_out = q(db, "select idempotency_key, state, payload from notification_outbox where run_id=%s order by 1", rid)
    before_det = q(db, "select run_seq, threat_class from detections where run_id=%s and threat_class<>'normal' order by 1", rid)
    sel = _good_selection(p)
    sel["false_positive_assessment"] = {"status": "likely_false_positive", "supporting_fact_ids": _facts(p, "account_resource_history")[:1], "missing_evidence_codes": []}
    sel["hypotheses"] = [{"type": "legitimate_authorized_activity", "supporting_fact_ids": _facts(p, "account_resource_history")[:1], "counterevidence_fact_ids": _facts(p, "prior_denials_count")[:1], "unknown_codes": []}]
    fake = FakeExplainer([submit(sel)])
    w = _worker(db, scenario["cfg"], fake)
    with connect_direct(db) as conn:
        assert w.explain_one(conn) == "validated"
    ex = q(db, "select validated from explanations where run_id=%s", rid)[0]["validated"]
    assert ex["false_positive_assessment"]["status"] == "likely_false_positive" and ex["false_positive_assessment"]["advisory_only"]
    assert q(db, "select current_class, current_version, status from incidents where run_id=%s", rid) == before_inc
    assert q(db, "select idempotency_key, state, payload from notification_outbox where run_id=%s order by 1", rid) == before_out
    assert q(db, "select run_seq, threat_class from detections where run_id=%s and threat_class<>'normal' order by 1", rid) == before_det


def test_q01_provider_timeout_falls_back_and_core_state_untouched(db, scenario):
    rid = scenario["run_id"]
    fake = FakeExplainer([TimeoutError("slow provider"), TimeoutError("slow provider again")])
    w = _worker(db, scenario["cfg"], fake)
    with connect_direct(db) as conn:
        assert w.explain_one(conn) == "fallback"
        # Deliveries proceed independently (preview mode) even though the AI review failed.
        assert w.deliver_one(conn) == "preview"
    ex = q(db, "select state, validated, rejection_reasons from explanations where run_id=%s", rid)[0]
    assert ex["state"] == "fallback" and ex["validated"]["ai_review"] == "unavailable"
    assert any("timeout" in r for r in ex["rejection_reasons"])
    assert q(db, "select current_class from incidents where run_id=%s", rid)[0]["current_class"] == "suspicious"
    assert q(db, "select state from notification_outbox where run_id=%s", rid) == [{"state": "preview"}]
