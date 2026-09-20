"""Parameter binding and precondition evaluation: an action's target always traces back to a typed fact."""
from __future__ import annotations

import pytest

from app.actions import binding
from app.actions.catalog import by_id, load_catalog
from app.settings import get_settings

CATALOG = load_catalog(get_settings().config_dir)


def fact(kind, args, value, role="trigger", fact_id=None):
    return {"fact_id": fact_id or f"f_{kind}", "kind": kind, "role": role, "args": args, "value": value,
            "cutoff_seq": 100, "evidence_event_ids": [], "query": None}


def incident(**kw):
    base = {"incident_id": "inc1", "account": "acct_4", "ip_raw": "203.0.113.9", "status": "open",
            "key_type": "pair", "key_value": "acct_4|203.0.113.9"}
    return {**base, **kw}


def version(*rules):
    return {"version": 1, "rule_ids": list(rules), "trigger_seq": 90, "threat_class": "suspicious"}


def bind(action_id, inc, ver, facts):
    action = by_id(CATALOG, action_id)
    assert action is not None
    return binding.bind(action, incident=inc, version=ver, packet={"facts": facts})


def test_catalog_loads_and_validates():
    assert {a["id"] for a in CATALOG} >= {"revoke_sessions", "block_source", "restore_acl", "export_response_packet"}
    assert all(a["severity"] in ("containment", "handoff") for a in CATALOG)


def test_binds_account_from_the_incident_row():
    b = bind("revoke_sessions", incident(), version("R1"), [])
    assert b.available and b.params == {"account": "acct_4"}
    assert b.bound_from["account"] == "incident.account"


def test_binds_resource_from_the_typed_fact_not_the_incident():
    facts = [
        fact("prior_denials_count", {"account": "acct_9", "path": "/exec/CONFIDENTIAL.pdf", "before_seq": 80}, 6),
        fact("first_success_after_denials", {"account": "acct_9", "path": "/exec/CONFIDENTIAL.pdf", "at_seq": 90}, True),
    ]
    b = bind("restore_acl", incident(), version("R2"), facts)
    assert b.available
    # The account comes from the fact's args, so it cannot drift from the evidence the count was computed over.
    assert b.params == {"account": "acct_9", "path": "/exec/CONFIDENTIAL.pdf"}
    assert b.bound_from["path"] == "fact:f_prior_denials_count.args.path"
    assert b.bound_fact_ids == ["f_prior_denials_count"]


def test_split_binding_takes_one_segment_of_a_composite_key():
    facts = [fact("prior_endpoint_post_2xx_count", {"account_endpoint": "acct_2|/api/admin/role_update", "before_seq": 80}, 0)]
    b = bind("revert_role_change", incident(), version("R3"), facts)
    assert b.available and b.params == {"account": "acct_2", "endpoint": "/api/admin/role_update"}


def test_missing_fact_makes_the_action_unavailable_rather_than_partially_bound():
    b = bind("restore_acl", incident(), version("R2"), [])
    assert not b.available and b.params == {}
    assert any("prior_denials_count" in u for u in b.unmet)


def test_precondition_on_a_fact_value_is_enforced():
    familiar = [fact("source_familiarity", {"pair": "acct_4|203.0.113.9"}, "familiar")]
    b = bind("block_source", incident(), version("R1"), familiar)
    assert not b.available and any("'familiar'" in u for u in b.unmet)

    unfamiliar = [fact("source_familiarity", {"pair": "acct_4|203.0.113.9"}, "unfamiliar")]
    ok = bind("block_source", incident(), version("R1"), unfamiliar)
    assert ok.available and ok.params == {"account": "acct_4", "source": "203.0.113.9"}


def test_closed_incident_offers_no_containment():
    b = bind("revoke_sessions", incident(status="closed"), version("R1"), [])
    assert not b.available and any("closed" in u for u in b.unmet)


def test_rule_precondition_rejects_an_unrelated_incident():
    b = bind("revoke_sessions", incident(), version("R2"), [])
    assert not b.available and any("R2" in u for u in b.unmet)


def test_trigger_facts_outrank_context_facts_of_the_same_kind():
    facts = [
        fact("source_familiarity", {"pair": "x"}, "familiar", role="context", fact_id="f_ctx"),
        fact("source_familiarity", {"pair": "y"}, "unfamiliar", role="trigger", fact_id="f_trig"),
    ]
    b = bind("block_source", incident(), version("R1"), facts)
    assert b.available  # bound to the trigger fact, which is what fired the rule


def test_params_hash_pins_the_binding():
    facts = [fact("prior_denials_count", {"account": "a", "path": "/p", "before_seq": 1}, 6),
             fact("first_success_after_denials", {"account": "a", "path": "/p", "at_seq": 2}, True)]
    first = bind("restore_acl", incident(), version("R2"), facts)
    same = bind("restore_acl", incident(), version("R2"), facts)
    moved = bind("restore_acl", incident(), version("R2"),
                 [fact("prior_denials_count", {"account": "a", "path": "/other", "before_seq": 1}, 6),
                  fact("first_success_after_denials", {"account": "a", "path": "/other", "at_seq": 2}, True)])
    assert first.params_hash == same.params_hash != moved.params_hash


def test_handoff_action_needs_nothing_and_is_always_available():
    b = bind("export_response_packet", incident(status="closed"), version(), [])
    assert b.available and b.params == {}


@pytest.mark.parametrize("action_id", [a["id"] for a in CATALOG])
def test_every_action_declares_a_known_verification_query(action_id):
    from app.actions.verify import QUERIES

    action = by_id(CATALOG, action_id)
    qid = action["verification"]["id"]
    assert qid == "none" or qid in QUERIES, f"{action_id} names verification query {qid!r}"
    assert action["verification"]["criterion"]
