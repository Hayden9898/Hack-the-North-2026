"""Incident correlation with typed keys, immutable versions, evidence memberships and relations (architecture.md §7).

Runs inside the detector transaction. Grouping: same primary rule + typed key within the correlation window.
Other rules attach only through explicit links (R4 → the R1 pair episode; R5 → the R2 access-change incident, with a
relation to the R3 incident it links). Class only increases automatically.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import psycopg

from app.config import DetectionConfig
from app.db.engine import jsonb, one
from app.detection.rules import RuleMatch
from app.features.events import Event
from app.incidents.facts import build_packet
from app.incidents.templates import summarize
from app.notifications import outbox

CLASS_RANK = {"normal": 0, "suspicious": 1, "high_risk": 2}


@dataclass
class IncidentChange:
    incident_id: str
    version: int
    previous_class: str | None
    threat_class: str
    rule_ids: list[str]
    packet_hash: str
    summary: dict[str, Any]
    notification: str | None = None


def _max_class(a: str, b: str) -> str:
    return a if CLASS_RANK[a] >= CLASS_RANK[b] else b


def apply_matches(
    conn: psycopg.Connection[Any],
    *,
    run: dict[str, Any],
    ev: Event,
    matches: list[RuleMatch],
    observed: dict[str, Any],
    cfg: DetectionConfig,
    reference_hash: str,
    app_base_url: str,
    side_effects: bool,
    trace_context: dict[str, Any] | None,
) -> list[IncidentChange]:
    if not matches:
        return []
    run_id = run["run_id"]
    window = timedelta(seconds=int(cfg.policy["correlation"]["window_seconds"]))
    changes: list[IncidentChange] = []
    incident_for_rule: dict[str, str] = {}
    with conn.cursor() as cur:
        for m in matches:
            incident = _find_target(cur, run_id, ev, m, window, incident_for_rule)
            prev_class = incident["current_class"] if incident else None
            if incident is None:
                incident_id = str(uuid.uuid4())
                acct, ip = ev.username, ev.ip_raw if m.key_type == "pair" else None
                cur.execute(
                    """INSERT INTO incidents (run_id, incident_id, key_type, key_value, primary_rule_id, status, current_version, current_class,
                           first_seq, last_seq, first_event_time, last_event_time, account, ip_raw)
                       VALUES (%s, %s, %s, %s, %s, 'open', 0, 'normal', %s, %s, %s, %s, %s, %s) RETURNING *""",
                    (run_id, incident_id, m.key_type, m.key_value, m.rule_id, ev.run_seq, ev.run_seq, ev.event_time, ev.event_time, acct, ip),
                )
                incident = dict(one(cur))
                prev_class = None
            incident_id = incident["incident_id"]
            incident_for_rule[m.rule_id] = incident_id
            new_version = int(incident["current_version"]) + 1
            new_class = _max_class(incident["current_class"], m.outcome) if prev_class else m.outcome

            # Persist the rule match with its incident.
            cur.execute(
                """INSERT INTO rule_matches (run_id, run_seq, rule_id, event_id, event_time, outcome, key_type, key_value, legs, params, incident_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (run_id, run_seq, rule_id) DO NOTHING""",
                (run_id, ev.run_seq, m.rule_id, ev.event_id, ev.event_time, m.outcome, m.key_type, m.key_value, jsonb(m.legs),
                 jsonb({**m.params, "incomplete": m.incomplete}), incident_id),
            )
            # Evidence memberships for every leg.
            for leg in m.legs:
                cur.execute(
                    """INSERT INTO incident_evidence (run_id, incident_id, event_id, run_seq, event_time, relation_type, rule_id, added_version)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                    (run_id, incident_id, leg["event_id"], leg["run_seq"], leg["event_time"], leg["role"], m.rule_id, new_version),
                )
            # Relations to other episodes via explicit typed links.
            for link in m.links:
                other = link.get("incident_id")
                if other and other != incident_id:
                    cur.execute(
                        """INSERT INTO incident_relations (run_id, incident_id, related_incident_id, relation_type, link_key, created_version)
                           VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                        (run_id, incident_id, other, link["link_type"], str(link["link_key"]), new_version),
                    )
                    cur.execute(
                        """INSERT INTO incident_relations (run_id, incident_id, related_incident_id, relation_type, link_key, created_version)
                           VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                        (run_id, other, incident_id, link["link_type"], str(link["link_key"]), new_version),
                    )
            # All matches of this incident so far (for the packet).
            cur.execute(
                "SELECT run_seq, rule_id, event_id, event_time, key_value, legs, params FROM rule_matches WHERE run_id=%s AND incident_id=%s ORDER BY run_seq",
                (run_id, incident_id),
            )
            all_matches = [dict(r) for r in cur.fetchall()]
            rule_ids = sorted({r["rule_id"] for r in all_matches}, key=lambda x: (int(x[1:]) if x[1:].isdigit() else 99))
            packet = build_packet(conn, run_id, incident_id, new_version, ev.run_seq, ev, observed, all_matches, reference_hash,
                                  int(cfg.policy["correlation"]["max_packet_events"]))
            summary = summarize(rule_ids, new_class, packet["facts"], packet["unknown_codes"])
            strength = {
                "rules": rule_ids,
                "legs_present": all(any(f["kind"] == "event_observed" and leg["event_id"] in f["evidence_event_ids"] for f in packet["facts"]) for mm in all_matches for leg in mm["legs"]),
                "evaluation_incomplete": bool(packet["completeness"]["rules_incomplete"]) or any(mm["params"].get("incomplete") for mm in all_matches),
                "missing_evidence": packet["unknown_codes"],
                "distinct_evidence_events": len({f["evidence_event_ids"][0] for f in packet["facts"] if f["kind"] == "event_observed"}),
            }
            first_time = min(incident["first_event_time"], ev.event_time)
            cur.execute(
                """INSERT INTO incident_versions (run_id, incident_id, version, threat_class, trigger_seq, trigger_event_id, timeline_start,
                       timeline_end, rule_ids, evidence_strength, summary)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (run_id, incident_id, new_version, new_class, ev.run_seq, ev.event_id, first_time, ev.event_time, rule_ids, jsonb(strength), jsonb(summary)),
            )
            cur.execute(
                """INSERT INTO fact_packets (run_id, incident_id, version, cutoff_seq, packet_hash, facts, completeness)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (run_id, incident_id, new_version, ev.run_seq, packet["packet_hash"], jsonb(packet), jsonb(packet["completeness"])),
            )
            cur.execute(
                """UPDATE incidents SET current_version=%s, current_class=%s, last_seq=%s, last_event_time=%s, first_event_time=%s,
                       updated_at=now() WHERE run_id=%s AND incident_id=%s""",
                (new_version, new_class, ev.run_seq, ev.event_time, first_time, run_id, incident_id),
            )
            incident.update(current_version=new_version, current_class=new_class, last_seq=ev.run_seq, last_event_time=ev.event_time)
            change = IncidentChange(incident_id, new_version, prev_class, new_class, rule_ids, packet["packet_hash"], summary)
            if side_effects:
                cur.execute("SELECT count(*) n FROM incident_evidence WHERE run_id=%s AND incident_id=%s", (run_id, incident_id))
                n_events = int(one(cur)["n"])
                change.notification = outbox.enqueue_for_version(
                    conn, run=run, incident=incident, version=new_version, previous_class=prev_class, threat_class=new_class,
                    rule_ids=rule_ids, summary=summary, event_time=ev.event_time, event_count=n_events, app_base_url=app_base_url,
                    debounce_seconds=int(cfg.policy["notifications"]["suspicious_debounce_seconds"]), trace_context=trace_context,
                )
                # Explanation job for this version; older pending jobs for the incident are superseded.
                cur.execute(
                    "UPDATE explanation_jobs SET state='superseded', updated_at=now() WHERE run_id=%s AND incident_id=%s AND state IN ('pending','leased')",
                    (run_id, incident_id),
                )
                cur.execute(
                    """INSERT INTO explanation_jobs (job_id, run_id, incident_id, version, packet_hash, state, trace_context)
                       VALUES (%s, %s, %s, %s, %s, 'pending', %s) ON CONFLICT (run_id, incident_id, version) DO NOTHING""",
                    (str(uuid.uuid4()), run_id, incident_id, new_version, packet["packet_hash"], jsonb(trace_context) if trace_context else None),
                )
            changes.append(change)
    return changes


def _find_target(cur: psycopg.Cursor[Any], run_id: str, ev: Event, m: RuleMatch, window: timedelta, incident_for_rule: dict[str, str]) -> dict[str, Any] | None:
    """Locate the incident this match attaches to, locking it."""
    target_id: str | None = None
    if m.rule_id == "R4":
        target_id = m.params.get("r1_incident_id")
    elif m.rule_id == "R5":
        target_id = incident_for_rule.get("R2")
    if target_id:
        cur.execute("SELECT * FROM incidents WHERE run_id=%s AND incident_id=%s FOR UPDATE", (run_id, target_id))
        row = cur.fetchone()
        if row:
            return dict(row)
    cur.execute(
        """SELECT * FROM incidents WHERE run_id=%s AND primary_rule_id=%s AND key_type=%s AND key_value=%s AND status='open'
             AND last_event_time >= %s ORDER BY last_seq DESC LIMIT 1 FOR UPDATE""",
        (run_id, m.rule_id, m.key_type, m.key_value, ev.event_time - window),
    )
    row = cur.fetchone()
    return dict(row) if row else None
