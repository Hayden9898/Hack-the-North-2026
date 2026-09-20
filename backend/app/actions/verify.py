"""Verification queries: the criterion an action claims, recomputed against the committed log.

Every query is a named SQL identity over `processed_events`, bounded by the run cutoff exactly like the aggregate
proofs behind facts. A verification is evidence about the recorded log, not a claim that a remote system changed:
in a replay the log is fixed, so a `contradicted` result means the recorded activity continued past the point the
action was approved — which is precisely what an operator needs to know before trusting the containment.
"""
from __future__ import annotations

from typing import Any

import psycopg

# id -> (human description, required parameters, SQL over processed_events after `after_seq` within the cutoff)
QUERIES: dict[str, dict[str, Any]] = {
    "account_activity_after": {
        "describe": "requests by the account after the action point",
        "params": ["account"],
        "sql": """SELECT count(*) n FROM processed_events
                  WHERE run_id=%(run)s AND username=%(account)s AND run_seq > %(after)s AND run_seq <= %(cutoff)s""",
    },
    "auth_success_for_pair_after": {
        "describe": "successful logins for the account/source pair after the action point",
        "params": ["account", "source"],
        "sql": """SELECT count(*) n FROM processed_events
                  WHERE run_id=%(run)s AND username=%(account)s AND ip_raw=%(source)s AND status=200
                    AND route_family='login' AND run_seq > %(after)s AND run_seq <= %(cutoff)s""",
    },
    "events_from_source_after": {
        "describe": "requests from the source address after the action point",
        "params": ["source"],
        "sql": """SELECT count(*) n FROM processed_events
                  WHERE run_id=%(run)s AND ip_raw=%(source)s AND run_seq > %(after)s AND run_seq <= %(cutoff)s""",
    },
    "success_on_path_after": {
        "describe": "2xx responses for the account on this path after the action point",
        "params": ["account", "path"],
        "sql": """SELECT count(*) n FROM processed_events
                  WHERE run_id=%(run)s AND username=%(account)s AND path=%(path)s AND status BETWEEN 200 AND 299
                    AND run_seq > %(after)s AND run_seq <= %(cutoff)s""",
    },
    "admin_post_2xx_after": {
        "describe": "2xx POSTs by the account to this admin endpoint after the action point",
        "params": ["account", "endpoint"],
        "sql": """SELECT count(*) n FROM processed_events
                  WHERE run_id=%(run)s AND username=%(account)s AND path=%(endpoint)s AND method='POST'
                    AND status BETWEEN 200 AND 299 AND run_seq > %(after)s AND run_seq <= %(cutoff)s""",
    },
    "object_access_after": {
        "describe": "requests touching the object after the action point",
        "params": ["object_id"],
        "sql": """SELECT count(*) n FROM processed_events
                  WHERE run_id=%(run)s AND object_id=%(object_id)s AND run_seq > %(after)s AND run_seq <= %(cutoff)s""",
    },
}


def run(
    conn: psycopg.Connection[Any],
    *,
    verification: dict[str, Any],
    run_id: str,
    params: dict[str, Any],
    after_seq: int,
    cutoff_seq: int,
) -> dict[str, Any]:
    """Recompute the criterion. `holds` is None when it cannot yet be decided from the data under the cutoff."""
    qid = str(verification.get("id") or "none")
    criterion = str(verification.get("criterion") or "")
    base = {"query_id": qid, "criterion": criterion, "after_seq": after_seq, "cutoff_seq": cutoff_seq}
    if qid == "none":
        return {**base, "status": "not_applicable", "holds": None, "detail": "This action changes nothing observable in the log."}
    spec = QUERIES.get(qid)
    if spec is None:
        return {**base, "status": "unavailable", "holds": None, "detail": f"no verification query named {qid!r}"}
    missing = [p for p in spec["params"] if params.get(p) in (None, "")]
    if missing:
        return {**base, "status": "unavailable", "holds": None, "detail": f"missing parameter(s) {', '.join(missing)}"}

    args: dict[str, Any] = {"run": run_id, "after": int(after_seq), "cutoff": int(cutoff_seq)}
    args.update({p: params[p] for p in spec["params"]})
    with conn.cursor() as cur:
        cur.execute(spec["sql"], args)
        row = cur.fetchone()
    observed = int((row or {}).get("n", 0))
    if cutoff_seq <= after_seq:
        status, holds = "pending", None
        detail = "No events have been processed past the action point yet."
    elif observed == 0:
        status, holds = "satisfied", True
        detail = f"0 {spec['describe']} between #{after_seq} and the cutoff #{cutoff_seq}."
    else:
        status, holds = "contradicted", False
        detail = f"{observed} {spec['describe']} between #{after_seq} and the cutoff #{cutoff_seq}."
    return {**base, "status": status, "holds": holds, "observed": observed, "expected": 0, "describe": spec["describe"], "detail": detail}
