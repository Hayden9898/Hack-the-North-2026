"""Incidents, versioned facts, evidence proofs and analyst feedback — all scoped to the run cutoff."""
from __future__ import annotations

from datetime import timedelta
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api import deps
from app.db.engine import one

router = APIRouter(tags=["incidents"])


class Feedback(BaseModel):
    reviewer: str = Field(min_length=1, max_length=100)
    disposition: str = Field(pattern="^(confirmed_suspicious|benign_explained|needs_more_evidence|false_positive|closed)$")
    reason: str = Field(min_length=1, max_length=2000)


@router.get("/runs/{run_id}/incidents")
def list_incidents(
    run_id: str,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    threat_class: str | None = Query(default=None, pattern="^(normal|suspicious|high_risk)$"),
    status: str | None = Query(default=None, pattern="^(open|closed)$"),
    phase: str | None = Query(default=None, pattern="^(warmup|visible)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    run = deps.load_run(conn, run_id)
    clauses = ["i.run_id=%(run)s", "i.last_seq <= %(cutoff)s"]
    params: dict[str, Any] = {"run": run_id, "cutoff": int(run["processed_seq"]), "lim": limit, "off": offset}
    if threat_class:
        clauses.append("i.current_class=%(tc)s")
        params["tc"] = threat_class
    if status:
        clauses.append("i.status=%(st)s")
        params["st"] = status
    if phase:
        clauses.append("(CASE WHEN i.first_event_time < r.visible_start THEN 'warmup' ELSE 'visible' END) = %(ph)s")
        params["ph"] = phase
    with conn.cursor() as cur:
        cur.execute(
            f"""SELECT i.*, v.summary, v.rule_ids, v.evidence_strength,
                       (CASE WHEN i.first_event_time < r.visible_start THEN 'warmup' ELSE 'visible' END) AS phase,
                       (SELECT count(*) FROM incident_evidence e WHERE e.run_id=i.run_id AND e.incident_id=i.incident_id) AS evidence_count,
                       (SELECT string_agg(o.state, ',') FROM notification_outbox o WHERE o.run_id=i.run_id AND o.incident_id=i.incident_id) AS delivery_states,
                       (SELECT x.state FROM explanations x WHERE x.run_id=i.run_id AND x.incident_id=i.incident_id AND x.version=i.current_version) AS explanation_state,
                       count(*) OVER() AS total
                FROM incidents i
                JOIN runs r ON r.run_id = i.run_id
                JOIN incident_versions v ON v.run_id=i.run_id AND v.incident_id=i.incident_id AND v.version=i.current_version
                WHERE {' AND '.join(clauses)}
                ORDER BY i.last_seq DESC LIMIT %(lim)s OFFSET %(off)s""",
            params,
        )
        rows = [dict(r) for r in cur.fetchall()]
    total = rows[0]["total"] if rows else 0
    for r in rows:
        r.pop("total", None)
    return {"cutoff_seq": int(run["processed_seq"]), "total": total, "items": rows}


@router.get("/runs/{run_id}/incidents/{incident_id}")
def get_incident(
    run_id: str,
    incident_id: str,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    version: int | None = Query(default=None, ge=1),
) -> dict[str, Any]:
    run = deps.load_run(conn, run_id)
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM incidents WHERE run_id=%s AND incident_id=%s", (run_id, incident_id))
        inc = cur.fetchone()
        if inc is None or int(inc["last_seq"]) > int(run["processed_seq"]):
            raise HTTPException(status_code=404, detail="incident not found under the run cutoff")
        inc = dict(inc)
        v = version or int(inc["current_version"])
        cur.execute("SELECT * FROM incident_versions WHERE run_id=%s AND incident_id=%s ORDER BY version", (run_id, incident_id))
        versions = [dict(r) for r in cur.fetchall()]
        ver = next((x for x in versions if x["version"] == v), None)
        if ver is None:
            raise HTTPException(status_code=404, detail="version not found")
        evidence_cutoff = int(ver["trigger_seq"])
        # A single event can produce R2/v1 and R5/v2. Sequence alone does not
        # identify a version: evidence memberships and rule sets must agree too.
        cur.execute("SELECT * FROM fact_packets WHERE run_id=%s AND incident_id=%s AND version=%s", (run_id, incident_id, v))
        packet_row = cur.fetchone()
        cur.execute(
            """SELECT e.event_id, e.run_seq, e.event_time, string_agg(DISTINCT e.relation_type, ',') AS relation_type,
                      string_agg(DISTINCT e.rule_id, ',') AS rule_id, min(e.added_version) AS added_version,
                      p.username, p.ip_raw, p.method, p.path, p.status, p.response_bytes, p.object_id, p.threat_class, reg.line_number
               FROM incident_evidence e
               JOIN processed_events p ON p.run_id=e.run_id AND p.run_seq=e.run_seq AND p.event_time=e.event_time
               LEFT JOIN event_registry reg ON reg.event_id = e.event_id
               WHERE e.run_id=%s AND e.incident_id=%s AND e.run_seq <= %s AND e.added_version <= %s
               GROUP BY e.event_id, e.run_seq, e.event_time, p.username, p.ip_raw, p.method, p.path, p.status, p.response_bytes, p.object_id, p.threat_class, reg.line_number
               ORDER BY e.run_seq""",
            (run_id, incident_id, evidence_cutoff, v),
        )
        timeline = [dict(r) for r in cur.fetchall()]
        cur.execute(
            """SELECT rel.related_incident_id, rel.relation_type, rel.link_key, rel.created_version,
                      o.primary_rule_id, ov.threat_class AS current_class, ov.version AS related_version, o.account, o.key_value
               FROM incident_relations rel JOIN incidents o ON o.run_id=rel.run_id AND o.incident_id=rel.related_incident_id
               JOIN LATERAL (
                   SELECT version, threat_class FROM incident_versions
                   WHERE run_id=o.run_id AND incident_id=o.incident_id AND trigger_seq <= %s
                   ORDER BY version DESC LIMIT 1
               ) ov ON true
               WHERE rel.run_id=%s AND rel.incident_id=%s AND rel.created_seq <= %s
                 AND (rel.origin_incident_id <> rel.incident_id OR rel.created_version <= %s)""",
            (evidence_cutoff, run_id, incident_id, evidence_cutoff, v),
        )
        relations = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT * FROM explanations WHERE run_id=%s AND incident_id=%s AND version=%s", (run_id, incident_id, v))
        expl = cur.fetchone()
        cur.execute("SELECT state, attempts, next_attempt_at, last_error FROM explanation_jobs WHERE run_id=%s AND incident_id=%s AND version=%s", (run_id, incident_id, v))
        job = cur.fetchone()
        cur.execute(
            """SELECT idempotency_key, notification_kind, version, state, attempts, next_attempt_at, last_error, delivery_ambiguous, sent_at, created_at,
                      payload->>'text' AS preview_text
               FROM notification_outbox WHERE run_id=%s AND incident_id=%s AND version <= %s ORDER BY created_at""",
            (run_id, incident_id, v),
        )
        deliveries = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT id, version, reviewer, disposition, reason, created_at FROM analyst_feedback WHERE run_id=%s AND incident_id=%s AND version <= %s ORDER BY created_at", (run_id, incident_id, v))
        feedback = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT run_seq, rule_id, event_id, event_time, outcome, key_type, key_value, legs, params FROM rule_matches WHERE run_id=%s AND incident_id=%s AND run_seq <= %s AND rule_id = ANY(%s) ORDER BY run_seq, rule_id", (run_id, incident_id, evidence_cutoff, ver["rule_ids"]))
        matches = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT content_sha256, original_name FROM datasets WHERE id=%s", (run["dataset_id"],))
        dataset = cur.fetchone()
        # Baseline comparison for the incident's account: prior counts at trigger cutoff vs. account totals under cutoff.
        acct = inc.get("account")
        baseline: dict[str, Any] | None = None
        if acct:
            cur.execute(
                """SELECT count(*) total,
                          count(*) FILTER (WHERE status=401) c401, count(*) FILTER (WHERE status=403) c403,
                          count(distinct ip_raw) ips, min(event_time) first_seen
                   FROM processed_events WHERE run_id=%s AND username=%s AND run_seq < %s""",
                (run_id, acct, ver["trigger_seq"]),
            )
            baseline = dict(cur.fetchone() or {})
            cur.execute(
                """SELECT extract(hour from event_time at time zone make_interval(mins => %s))::int h, count(*) n
                   FROM processed_events WHERE run_id=%s AND username=%s AND run_seq < %s GROUP BY 1 ORDER BY 1""",
                (_offset_minutes(conn, inc["incident_id"], run_id), run_id, acct, ver["trigger_seq"]),
            )
            baseline["hour_histogram"] = {int(r["h"]): r["n"] for r in cur.fetchall()}
    packet = packet_row["facts"] if packet_row else None
    from app.investigation import playbooks as pb_mod

    catalog = pb_mod.load_catalog()
    kinds = {f["kind"] for f in (packet or {}).get("facts", [])}
    applicable = pb_mod.applicable(catalog, list(ver["rule_ids"]), kinds)
    selected = set((expl["validated"] or {}).get("playbook_ids", [])) if expl and expl.get("validated") else set()
    return {
        "playbooks": {"applicable": applicable, "selected_by_ai": sorted(selected), "catalog_version": 1},
        "incident": {**inc, "phase": "warmup" if inc["first_event_time"] < run["visible_start"] else "visible"},
        "version": ver,
        "versions": [{k: x[k] for k in ("version", "threat_class", "trigger_seq", "trigger_event_id", "timeline_start", "timeline_end", "rule_ids", "created_at")} for x in versions],
        "packet": packet,
        "packet_hash": packet_row["packet_hash"] if packet_row else None,
        "timeline": timeline,
        "relations": relations,
        "rule_matches": matches,
        "explanation": dict(expl) if expl else None,
        "explanation_job": dict(job) if job else None,
        "deliveries": deliveries,
        "feedback": feedback,
        "baseline": baseline,
        "cutoff_seq": int(run["processed_seq"]),
        "evidence_cutoff_seq": evidence_cutoff,
        "provenance": {
            "dataset_id": run["dataset_id"],
            "dataset_sha256": dataset["content_sha256"] if dataset else None,
            "dataset_name": dataset["original_name"] if dataset else None,
            "source_id": run["source_id"],
            "config_hash": run["config_hash"],
            "reference_hash": (run["config"] or {}).get("reference_hash"),
            "feature_version": run["feature_version"],
            "model_id": run["model_id"],
        },
    }


def _offset_minutes(conn: psycopg.Connection[Any], incident_id: str, run_id: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT r.offset_minutes FROM incidents i JOIN raw_events r ON r.event_time = i.first_event_time
               JOIN incident_evidence e ON e.run_id=i.run_id AND e.incident_id=i.incident_id AND e.event_id = r.event_id
               WHERE i.run_id=%s AND i.incident_id=%s LIMIT 1""",
            (run_id, incident_id),
        )
        row = cur.fetchone()
    return int(row["offset_minutes"]) if row else -240


@router.get("/runs/{run_id}/facts/{fact_id}")
def get_fact(
    run_id: str,
    fact_id: str,
    incident_id: str = Query(...),
    version: int = Query(..., ge=1),
    conn: psycopg.Connection[Any] = Depends(deps.db),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Exact evidence lines for a fact, or a recomputable aggregate proof (count + paginated matching records)."""
    run = deps.load_run(conn, run_id)
    with conn.cursor() as cur:
        cur.execute("SELECT facts FROM fact_packets WHERE run_id=%s AND incident_id=%s AND version=%s", (run_id, incident_id, version))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="packet not found")
        fact = next((f for f in row["facts"]["facts"] if f["fact_id"] == fact_id), None)
        if fact is None:
            raise HTTPException(status_code=404, detail="fact not in packet")
        if int(fact["cutoff_seq"]) > int(run["processed_seq"]):
            raise HTTPException(status_code=404, detail="fact beyond run cutoff")
        evidence = []
        if fact.get("evidence_event_ids"):
            cur.execute(
                """SELECT p.run_seq, p.event_id, p.event_time, p.username, p.ip_raw, p.method, p.path, p.status, p.response_bytes, p.threat_class,
                          r.raw_line, r.raw_target, r.original_time, e.line_number, e.dataset_id
                   FROM processed_events p
                   JOIN raw_events r ON r.event_id=p.event_id AND r.event_time=p.event_time
                   LEFT JOIN event_registry e ON e.event_id=p.event_id
                   WHERE p.run_id=%s AND p.event_id = ANY(%s) ORDER BY p.run_seq""",
                (run_id, fact["evidence_event_ids"]),
            )
            evidence = [dict(r) for r in cur.fetchall()]
        proof = None
        if fact.get("query"):
            proof = _recompute(cur, run_id, fact, limit, offset)
    return {"fact": fact, "evidence": evidence, "aggregate_proof": proof}


def _recompute(cur: psycopg.Cursor[Any], run_id: str, fact: dict[str, Any], limit: int, offset: int) -> dict[str, Any]:
    """Re-run the fact's aggregate definition under its cutoff and return the count plus a page of matching records."""
    q = fact["query"]
    qid = q["id"]
    p = q.get("params", {})
    args = fact["args"]
    base_select = """SELECT p.run_seq, p.event_id, p.event_time, p.username, p.ip_raw, p.method, p.path, p.status, p.response_bytes, e.line_number
                     FROM processed_events p LEFT JOIN event_registry e ON e.event_id=p.event_id"""
    if qid == "account_path_status_count":
        where = "p.run_id=%(run)s AND p.username=%(acct)s AND p.path=%(path)s AND p.method='GET' AND p.status=%(status)s AND p.run_seq < %(before)s"
        params = {"run": run_id, "acct": p["account"], "path": p["path"], "status": p["status"], "before": p["before_seq"]}
    elif qid == "account_path_post2xx_count":
        acct, path = p["key"].split("|", 1)
        where = "p.run_id=%(run)s AND p.username=%(acct)s AND p.path=%(path)s AND p.method='POST' AND p.status BETWEEN 200 AND 299 AND p.run_seq < %(before)s"
        params = {"run": run_id, "acct": acct, "path": path, "before": p["before_seq"]}
    elif qid == "pair_login_401_count_window":
        acct, ip = args["pair"].split("|", 1)
        cur.execute("SELECT event_time FROM processed_events WHERE run_id=%s AND run_seq=%s", (run_id, args["at_seq"]))
        at = cur.fetchone()
        if at is None:
            return {"query": q, "error": "anchor event not processed"}
        where = "p.run_id=%(run)s AND p.username=%(acct)s AND p.ip_raw=%(ip)s AND p.route_family='login' AND p.status=401 AND p.event_time >= %(t0)s AND p.event_time <= %(t)s AND p.run_seq <= %(at)s"
        params = {"run": run_id, "acct": acct, "ip": ip, "t0": at["event_time"] - timedelta(seconds=int(p["window_seconds"])), "t": at["event_time"], "at": args["at_seq"]}
    elif qid == "entity_stats.account.n":
        where = "p.run_id=%(run)s AND p.username=%(acct)s AND p.run_seq < %(before)s"
        params = {"run": run_id, "acct": p["account"], "before": p["before_seq"]}
    elif qid == "entity_stats.pair":
        acct, ip = p["pair"].split("|", 1)
        where = "p.run_id=%(run)s AND p.username=%(acct)s AND p.ip_raw=%(ip)s AND p.run_seq < %(before)s"
        params = {"run": run_id, "acct": acct, "ip": ip, "before": p["before_seq"]}
    elif qid == "entity_stats.account_path":
        acct, path = p["key"].split("|", 1)
        where = "p.run_id=%(run)s AND p.username=%(acct)s AND p.path=%(path)s AND p.run_seq < %(before)s"
        params = {"run": run_id, "acct": acct, "path": path, "before": p["before_seq"]}
    else:
        return {"query": q, "error": "unknown query identity"}
    cur.execute(f"SELECT count(*) n FROM processed_events p WHERE {where}", params)
    total = int(one(cur)["n"])
    cur.execute(f"{base_select} WHERE {where} ORDER BY p.run_seq LIMIT %(lim)s OFFSET %(off)s", {**params, "lim": limit, "off": offset})
    rows = [dict(r) for r in cur.fetchall()]
    recorded = fact["value"]
    matches = (recorded == total) if isinstance(recorded, int) else None
    return {"query": q, "recomputed_count": total, "recorded_value": recorded, "matches_recorded": matches, "rows": rows, "limit": limit, "offset": offset}


@router.post("/runs/{run_id}/incidents/{incident_id}/feedback", status_code=201)
def post_feedback(
    run_id: str,
    incident_id: str,
    body: Feedback,
    conn: psycopg.Connection[Any] = Depends(deps.db),
    operator: str = Depends(deps.require_operator),
) -> dict[str, Any]:
    deps.load_run(conn, run_id)
    with conn.cursor() as cur:
        cur.execute("SELECT current_version FROM incidents WHERE run_id=%s AND incident_id=%s", (run_id, incident_id))
        inc = cur.fetchone()
        if inc is None:
            raise HTTPException(status_code=404, detail="incident not found")
        cur.execute(
            "INSERT INTO analyst_feedback (run_id, incident_id, version, reviewer, disposition, reason) VALUES (%s, %s, %s, %s, %s, %s) RETURNING *",
            (run_id, incident_id, inc["current_version"], f"{body.reviewer} ({operator})", body.disposition, body.reason),
        )
        row = dict(one(cur))
        # Closing records disposition; detections and versions are never erased or downgraded.
        if body.disposition in ("closed", "false_positive", "benign_explained"):
            cur.execute("UPDATE incidents SET status='closed', updated_at=now() WHERE run_id=%s AND incident_id=%s", (run_id, incident_id))
        cur.execute(
            "INSERT INTO ui_updates (run_id, update_seq, type, payload) VALUES (%s, (SELECT coalesce(max(update_seq),0)+1 FROM ui_updates WHERE run_id=%s), 'feedback', %s)",
            (run_id, run_id, __import__("app.db.engine", fromlist=["jsonb"]).jsonb({"incident_id": incident_id, "disposition": body.disposition})),
        )
    return row
