"""Validator contract against a synthetic packet: E01-style rejections and forced trigger inclusion."""
from app.config import canonical_hash
from app.investigation.validator import validate


def _fact(fid, kind, value, role="support", cutoff=10, args=None):
    return {"fact_id": fid, "kind": kind, "value": value, "role": role, "cutoff_seq": cutoff, "args": args or {}, "evidence_event_ids": [], "query": None, "provenance_hash": "p"}


F_TRIG = "f_0000000000000001"
F_DEN = "f_0000000000000002"
F_FAM = "f_0000000000000003"
F_HIST = "f_0000000000000004"
F_FUTURE = "f_00000000000000ff"
F_PAIR = "f_0000000000000005"  # context fact present in every packet
F_DELTA = "f_0000000000000006"  # time delta: present for any linked pair of requests
F_HOUR = "f_0000000000000007"  # context fact present in every packet
F_OBJ = "f_0000000000000008"  # shared forum-object link (R3/R5 only)
F_UNFAM = "f_0000000000000009"  # unfamiliar source (R1/R4/R6 evidence)

PACKET = {
    "packet_hash": "h1",
    "incident_id": "inc",
    "version": 1,
    "cutoff_seq": 10,
    "rule_ids": ["R2"],
    "trigger_fact_ids": [F_TRIG, F_DEN],
    "unknown_codes": ["authorized_change_record_unavailable"],
    "completeness": {},
    "facts": [
        _fact(F_TRIG, "event_observed", {"path": "/x"}, role="trigger"),
        _fact(F_DEN, "prior_denials_count", 77, role="trigger"),
        _fact(F_FAM, "source_familiarity", "familiar", role="context"),
        _fact(F_HIST, "account_resource_history", {"prior_get_200": 0}, role="context"),
        _fact(F_FUTURE, "event_observed", {"path": "/later"}, role="support", cutoff=99),
        _fact(F_PAIR, "pair_history", {"events": 3, "login_failures": 0}, role="context"),
        _fact(F_DELTA, "time_delta_seconds", 4.0, role="support"),
        _fact(F_HOUR, "local_hour_typicality", {"account_events_this_hour": 1, "account_events_total": 9}, role="context"),
        _fact(F_OBJ, "same_object", "obj-1", role="support"),
        _fact(F_UNFAM, "source_familiarity", "unfamiliar", role="support"),
    ],
}
APPLICABLE = {"sensitive_access_authorization_review"}


def _proposal(**over):
    base = {
        "schema_version": "1",
        "packet_hash": "h1",
        "summary_fact_ids": [F_DEN],
        "hypotheses": [{"type": "possible_privilege_abuse", "supporting_fact_ids": [F_DEN], "counterevidence_fact_ids": [F_HIST], "unknown_codes": ["authorized_change_record_unavailable"]}],
        "false_positive_assessment": {"status": "insufficient_evidence", "supporting_fact_ids": [], "missing_evidence_codes": ["authorized_change_record"]},
        "playbook_ids": ["sensitive_access_authorization_review"],
    }
    base.update(over)
    return base


def test_valid_proposal_gets_trigger_facts_forced_in_and_templates_applied():
    r = validate(_proposal(), PACKET, APPLICABLE)
    assert r.ok, r.reasons
    v = r.validated
    assert v["summary_fact_ids"] == [F_DEN, F_TRIG] and v["forced_inclusions"] == [F_TRIG]
    assert v["hypotheses"][0]["text"].startswith("Possible privilege or access change (unproven)")
    assert v["false_positive_assessment"]["advisory_only"] is True
    assert v["ai_review"] == "validated"


def test_nonexistent_fact_id_rejected():
    r = validate(_proposal(summary_fact_ids=["f_deadbeefdeadbeef"]), PACKET, APPLICABLE)
    assert not r.ok and any("unknown fact id" in x for x in r.reasons)


def test_future_fact_beyond_cutoff_rejected():
    r = validate(_proposal(summary_fact_ids=[F_FUTURE]), PACKET, APPLICABLE)
    assert not r.ok and any("beyond the packet cutoff" in x for x in r.reasons)


def test_altered_packet_hash_rejected():
    r = validate(_proposal(packet_hash="h2"), PACKET, APPLICABLE)
    assert not r.ok and "packet_hash mismatch" in r.reasons


def test_contradictory_hypotheses_rejected():
    hyps = [
        {"type": "insufficient_evidence", "supporting_fact_ids": [], "counterevidence_fact_ids": [], "unknown_codes": []},
        {"type": "possible_privilege_abuse", "supporting_fact_ids": [F_DEN], "counterevidence_fact_ids": [], "unknown_codes": []},
    ]
    r = validate(_proposal(hypotheses=hyps), PACKET, APPLICABLE)
    assert not r.ok and any("contradictory" in x for x in r.reasons)


def test_hypothesis_without_required_predicate_rejected():
    hyps = [{"type": "possible_account_misuse", "supporting_fact_ids": [F_DEN], "counterevidence_fact_ids": [], "unknown_codes": []}]
    r = validate(_proposal(hypotheses=hyps), PACKET, APPLICABLE)
    assert not r.ok and any("required kind" in x for x in r.reasons)


def _hyp(code, supporting):
    return [{"type": code, "supporting_fact_ids": supporting, "counterevidence_fact_ids": [], "unknown_codes": []}]


def test_always_present_context_facts_do_not_satisfy_any_hypothesis_gate():
    # pair_history / time_delta_seconds / local_hour_typicality exist in every packet; citing only them must not
    # validate a hypothesis on an access-change (R2) packet.
    for code in ("possible_account_misuse", "possible_forum_mediated_request", "legitimate_authorized_activity"):
        for fid in (F_PAIR, F_DELTA, F_HOUR):
            r = validate(_proposal(hypotheses=_hyp(code, [fid])), PACKET, APPLICABLE)
            assert not r.ok and any("required kind" in x for x in r.reasons), (code, fid, r.reasons)


def test_misuse_requires_auth_evidence():
    assert validate(_proposal(hypotheses=_hyp("possible_account_misuse", [F_UNFAM])), PACKET, APPLICABLE).ok
    # A familiar source is not auth evidence for misuse.
    assert not validate(_proposal(hypotheses=_hyp("possible_account_misuse", [F_FAM])), PACKET, APPLICABLE).ok


def test_forum_mediated_requires_shared_object():
    assert validate(_proposal(hypotheses=_hyp("possible_forum_mediated_request", [F_OBJ])), PACKET, APPLICABLE).ok
    assert not validate(_proposal(hypotheses=_hyp("possible_forum_mediated_request", [F_DELTA])), PACKET, APPLICABLE).ok


def test_legitimate_requires_familiar_source_or_prior_history():
    assert validate(_proposal(hypotheses=_hyp("legitimate_authorized_activity", [F_FAM])), PACKET, APPLICABLE).ok
    assert validate(_proposal(hypotheses=_hyp("legitimate_authorized_activity", [F_HIST])), PACKET, APPLICABLE).ok
    assert not validate(_proposal(hypotheses=_hyp("legitimate_authorized_activity", [F_UNFAM])), PACKET, APPLICABLE).ok


def test_same_fact_supporting_and_counter_rejected():
    hyps = [{"type": "possible_privilege_abuse", "supporting_fact_ids": [F_DEN], "counterevidence_fact_ids": [F_DEN], "unknown_codes": []}]
    r = validate(_proposal(hypotheses=hyps), PACKET, APPLICABLE)
    assert not r.ok and any("both supporting and counterevidence" in x for x in r.reasons)


def test_nonexistent_or_inapplicable_playbook_rejected():
    r = validate(_proposal(playbook_ids=["reset_the_firewall"]), PACKET, APPLICABLE)
    assert not r.ok and any("playbook" in x for x in r.reasons)
    r2 = validate(_proposal(playbook_ids=["review_account_activity"]), PACKET, APPLICABLE)  # exists but not applicable
    assert not r2.ok


def test_prose_or_extra_fields_rejected_by_schema():
    r = validate(_proposal(narrative="The attacker definitely stole credentials."), PACKET, APPLICABLE)
    assert not r.ok and any(x.startswith("schema:") for x in r.reasons)
    r2 = validate(_proposal(hypotheses=[{"type": "confirmed_csrf", "supporting_fact_ids": [], "counterevidence_fact_ids": [], "unknown_codes": []}]), PACKET, APPLICABLE)
    assert not r2.ok
    r3 = validate("not json", PACKET, APPLICABLE)
    assert not r3.ok


def test_false_positive_claim_needs_support_and_stays_advisory():
    fp = {"status": "likely_false_positive", "supporting_fact_ids": [], "missing_evidence_codes": []}
    assert not validate(_proposal(false_positive_assessment=fp), PACKET, APPLICABLE).ok
    fp["supporting_fact_ids"] = [F_HIST]
    r = validate(_proposal(false_positive_assessment=fp), PACKET, APPLICABLE)
    assert r.ok and r.validated["false_positive_assessment"]["status"] == "likely_false_positive"
    assert canonical_hash(r.validated) != ""  # serialisable
