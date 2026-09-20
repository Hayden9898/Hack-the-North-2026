"""Deterministic typed facts and immutable fact packets (architecture.md §8).

Every fact: fact_id, kind, exact args, value, cutoff, evidence refs or aggregate query identity, provenance hash.
Facts are computed by code from committed evidence before any LLM is involved. Counterevidence/context facts are
produced here too, so an AI cannot omit them.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import psycopg

from app.config import canonical_hash
from app.features.events import Event

PACKET_SCHEMA_VERSION = "1"

UNKNOWN_CODES_BY_RULE = {
    "R1": ["credential_source_unknown", "session_identity_unavailable"],
    "R6": ["credential_source_unknown", "session_identity_unavailable"],
    "R2": ["authorized_change_record_unavailable", "role_change_contents_unavailable"],
    "R3": ["request_body_unavailable", "role_change_contents_unavailable", "user_agent_unavailable"],
    "R4": ["session_identity_unavailable", "credential_source_unknown", "external_transfer_unproven"],
    "R5": ["object_creator_unknown", "role_change_contents_unavailable", "causal_link_unproven"],
}


def _fact(kind: str, args: dict[str, Any], value: Any, cutoff_seq: int, evidence: list[str], role: str, query: dict[str, Any] | None = None) -> dict[str, Any]:
    fact_id = "f_" + canonical_hash({"kind": kind, "args": args, "cutoff_seq": cutoff_seq})[:16]
    body = {"kind": kind, "args": args, "value": value, "cutoff_seq": cutoff_seq, "evidence_event_ids": evidence, "query": query}
    return {"fact_id": fact_id, "role": role, **body, "provenance_hash": canonical_hash(body)}


def _event_fact(row: dict[str, Any], cutoff_seq: int, role: str) -> dict[str, Any]:
    value = {
        "event_id": row["event_id"],
        "run_seq": int(row["run_seq"]),
        "line_number": row.get("line_number"),
        "event_time": row["event_time"].isoformat() if isinstance(row["event_time"], datetime) else row["event_time"],
        "account": row["username"],
        "ip": row["ip_raw"],
        "method": row["method"],
        "path": row["path"],
        "raw_target": row.get("raw_target"),
        "status": int(row["status"]),
        "response_bytes": row.get("response_bytes"),
        "object_id": row.get("object_id"),
    }
    return _fact("event_observed", {"event_id": row["event_id"]}, value, cutoff_seq, [row["event_id"]], role)


def load_events(conn: psycopg.Connection[Any], run_id: str, event_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not event_ids:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            """SELECT p.event_id, p.run_seq, p.event_time, p.username, p.ip_raw, p.method, p.path, p.status, p.response_bytes,
                      p.object_id, r.raw_target, e.line_number
               FROM processed_events p
               JOIN raw_events r ON r.event_id = p.event_id AND r.event_time = p.event_time
               JOIN event_registry e ON e.event_id = p.event_id
               WHERE p.run_id = %s AND p.event_id = ANY(%s)""",
            (run_id, event_ids),
        )
        return {row["event_id"]: dict(row) for row in cur.fetchall()}


def build_packet(
    conn: psycopg.Connection[Any],
    run_id: str,
    incident_id: str,
    version: int,
    cutoff_seq: int,
    current: Event,
    current_observed: dict[str, Any],
    matches: list[dict[str, Any]],
    reference_hash: str,
    max_events: int,
) -> dict[str, Any]:
    """matches: all rule_matches rows attached to this incident (including the current event's), oldest first."""
    facts: list[dict[str, Any]] = []
    trigger_ids: list[str] = []
    unknown: list[str] = []
    incomplete: list[str] = []
    listing_truncated = False

    leg_ids: list[str] = []
    for m in matches:
        for leg in m["legs"]:
            if leg["event_id"] not in leg_ids:
                leg_ids.append(leg["event_id"])
    if len(leg_ids) > max_events:
        listing_truncated = True
        leg_ids = leg_ids[-max_events:]
    events = load_events(conn, run_id, [i for i in leg_ids if i != current.event_id])
    cur_row = {
        "event_id": current.event_id, "run_seq": current.run_seq, "event_time": current.event_time, "username": current.username,
        "ip_raw": current.ip_raw, "method": current.method, "path": current.path, "status": current.status,
        "response_bytes": current.response_bytes, "object_id": current.object_id, "raw_target": current.raw_target,
        "line_number": current.line_number,
    }
    events[current.event_id] = cur_row

    seen: set[str] = set()

    def add(f: dict[str, Any], trigger: bool = False) -> None:
        if f["fact_id"] in seen:
            return
        seen.add(f["fact_id"])
        facts.append(f)
        if trigger:
            trigger_ids.append(f["fact_id"])

    for m in matches:
        rid = m["rule_id"]
        p = m["params"]
        is_current = int(m["run_seq"]) == current.run_seq
        role = "trigger" if is_current else "support"
        for leg in m["legs"]:
            row = events.get(leg["event_id"])
            if row:
                add(_event_fact(row, cutoff_seq, role), trigger=is_current)
        legs_ids = [leg["event_id"] for leg in m["legs"] if leg["event_id"] in events]
        if rid in ("R1", "R6"):
            add(_fact("auth_failures_in_window", {"pair": m["key_value"], "window_seconds": p["window_seconds"], "at_seq": m["run_seq"]},
                      p["failures_in_window"], cutoff_seq, legs_ids, role,
                      query={"id": "pair_login_401_count_window", "version": 1, "params": {"window_seconds": p["window_seconds"]}}), trigger=is_current)
            add(_fact("source_familiarity", {"pair": m["key_value"], "reference_hash": p["reference_hash"]}, p["familiarity"], cutoff_seq, [], role), trigger=is_current)
        elif rid == "R2":
            acct, path = m["key_value"].split("|", 1)
            add(_fact("prior_denials_count", {"account": acct, "path": path, "method": "GET", "status": 403, "before_seq": m["run_seq"]},
                      p["prior_denials"], cutoff_seq, legs_ids,
                      role, query={"id": "account_path_status_count", "version": 1, "params": {"account": acct, "path": path, "status": 403, "before_seq": m["run_seq"]}}), trigger=is_current)
            add(_fact("prior_successes_count", {"account": acct, "path": path, "method": "GET", "status": 200, "before_seq": m["run_seq"]},
                      p["prior_successes"], cutoff_seq, [],
                      role, query={"id": "account_path_status_count", "version": 1, "params": {"account": acct, "path": path, "status": 200, "before_seq": m["run_seq"]}}), trigger=is_current)
            add(_fact("first_success_after_denials", {"account": acct, "path": path, "at_seq": m["run_seq"]}, True, cutoff_seq, legs_ids, role), trigger=is_current)
            if p.get("prior_denials_sql_recount") != p.get("prior_denials"):
                incomplete.append("R2:counter_recount_mismatch")
        elif rid == "R3":
            view = next((leg for leg in m["legs"] if leg["role"] == "forum_object_view"), None)
            admin = next((leg for leg in m["legs"] if leg["role"] == "admin_request"), None)
            if view and admin:
                add(_fact("time_delta_seconds", {"from_event": view["event_id"], "to_event": admin["event_id"]}, p["seconds_after_view"], cutoff_seq, [view["event_id"], admin["event_id"]], role), trigger=is_current)
                add(_fact("same_object", {"object_id": p["object_id"], "events": sorted([view["event_id"]])}, p["object_id"], cutoff_seq, [view["event_id"]], role), trigger=is_current)
            add(_fact("prior_endpoint_post_2xx_count", {"account_endpoint": m["key_value"], "before_seq": m["run_seq"]}, p["prior_post_2xx_on_endpoint"], cutoff_seq, [], role,
                      query={"id": "account_path_post2xx_count", "version": 1, "params": {"key": m["key_value"], "before_seq": m["run_seq"]}}), trigger=is_current)
        elif rid == "R4":
            login = next((leg for leg in m["legs"] if leg["role"] == "successful_login"), None)
            sens = next((leg for leg in m["legs"] if leg["role"] == "sensitive_success"), None)
            episode = next((leg for leg in m["legs"] if leg["role"] == "auth_episode_match"), None)
            if login and sens:
                add(_fact("time_delta_seconds", {"from_event": login["event_id"], "to_event": sens["event_id"]}, p["seconds_since_login"], cutoff_seq, [login["event_id"], sens["event_id"]], role), trigger=is_current)
            if episode and sens:
                add(_fact("time_delta_seconds", {"from_event": episode["event_id"], "to_event": sens["event_id"]}, p["seconds_since_auth_episode"], cutoff_seq, [episode["event_id"], sens["event_id"]], role), trigger=is_current)
            add(_fact("source_familiarity", {"pair": m["key_value"], "reference_hash": reference_hash}, "unfamiliar", cutoff_seq, [], role), trigger=is_current)
        elif rid == "R5":
            a_view = next((leg for leg in m["legs"] if leg["role"] == "a_viewed_object"), None)
            b_view = next((leg for leg in m["legs"] if leg["role"] == "b_viewed_object"), None)
            b_admin = next((leg for leg in m["legs"] if leg["role"] == "b_admin_request_r3"), None)
            ids = [x["event_id"] for x in (a_view, b_view) if x]
            add(_fact("same_object", {"object_id": p["object_id"], "events": sorted(ids)}, p["object_id"], cutoff_seq, ids, role), trigger=is_current)
            if b_admin:
                add(_fact("time_delta_seconds", {"from_event": b_admin["event_id"], "to_event": current.event_id}, (current.event_time - datetime.fromisoformat(b_admin["event_time"])).total_seconds(), cutoff_seq, [b_admin["event_id"], current.event_id], role), trigger=is_current)
            add(_fact("assertion_scope", {"rule": "R5"}, {"asserts_object_creator": False, "asserts_role_changed": False, "asserts_session_identity": False}, cutoff_seq, [], role), trigger=is_current)
        for code in UNKNOWN_CODES_BY_RULE.get(rid, []):
            if code not in unknown:
                unknown.append(code)

    # Context / counterevidence facts computed by code for the current event's account, pair and resource.
    ctx_args = {"account": current.username, "before_seq": current.run_seq}
    add(_fact("account_history_count", ctx_args, current_observed.get("acct_count"), cutoff_seq, [], "context",
              query={"id": "entity_stats.account.n", "version": 1, "params": ctx_args}))
    add(_fact("pair_history", {"pair": current.pair_key, "before_seq": current.run_seq},
              {"events": current_observed.get("pair_count"), "login_attempts": current_observed.get("pair_login_attempts"),
               "login_failures": current_observed.get("pair_login_failures"), "login_success": current_observed.get("pair_login_success")},
              cutoff_seq, [], "context", query={"id": "entity_stats.pair", "version": 1, "params": {"pair": current.pair_key, "before_seq": current.run_seq}}))
    add(_fact("account_resource_history", {"account": current.username, "path": current.path, "before_seq": current.run_seq},
              {"prior_get_200": current_observed.get("acct_path_prior_200"), "prior_get_403": current_observed.get("acct_path_denials")},
              cutoff_seq, [], "context", query={"id": "entity_stats.account_path", "version": 1, "params": {"key": current.account_path_key, "before_seq": current.run_seq}}))
    add(_fact("local_hour_typicality", {"account": current.username, "local_hour": current_observed.get("local_hour"), "before_seq": current.run_seq},
              {"account_events_this_hour": current_observed.get("acct_hour_count"), "account_events_total": current_observed.get("acct_count")},
              cutoff_seq, [], "context"))
    add(_fact("source_familiarity", {"pair": current.pair_key, "reference_hash": reference_hash}, current_observed.get("familiarity"), cutoff_seq, [], "context"))
    if current_observed.get("unusual_query_keys"):
        add(_fact("unusual_query_keys", {"event_id": current.event_id}, current_observed["unusual_query_keys"], cutoff_seq, [current.event_id], "context"))
    if current_observed.get("cold_start"):
        add(_fact("cold_start", {"account": current.username, "before_seq": current.run_seq}, True, cutoff_seq, [], "context"))

    packet = {
        "schema_version": PACKET_SCHEMA_VERSION,
        "incident_id": incident_id,
        "version": version,
        "cutoff_seq": cutoff_seq,
        "rule_ids": sorted({m["rule_id"] for m in matches}),
        "reference_hash": reference_hash,
        "facts": facts,
        "trigger_fact_ids": trigger_ids,
        "unknown_codes": unknown,
        "completeness": {"rules_incomplete": incomplete, "listing_truncated": listing_truncated, "max_events": max_events},
    }
    packet["packet_hash"] = canonical_hash({k: v for k, v in packet.items() if k != "packet_hash"})
    return packet
