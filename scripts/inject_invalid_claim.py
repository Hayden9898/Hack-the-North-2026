"""FAULT INJECTION (labelled): submit a deliberately invalid AI proposal for a real incident and show the validator
rejecting it, the deterministic fallback, and the Sentry `claim_rejected` log. Never runs against a real provider.

Usage: python -m scripts.inject_invalid_claim --run-id <run> [--incident-id <inc>]
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid

from app.config import get_config
from app.db.engine import connect_direct, jsonb
from app.investigation.provider import Block, Reply
from app.observability import sentry
from app.settings import get_settings
from app.workers.side_effects import SideEffectWorker


class ScriptedBadExplainer:
    """Fabricated fact ids, an altered packet hash, a non-existent playbook and a confident 'confirmed attack' code."""

    model_name = "fault-injection-scripted"

    def __init__(self, packet_hash: str) -> None:
        self.packet_hash = packet_hash
        self.n = 0

    def complete(self, *, system, messages, tools, max_tokens, timeout_s):
        self.n += 1
        if self.n == 1:
            sel = {
                "schema_version": "1",
                "packet_hash": "0000deadbeef",  # altered hash
                "summary_fact_ids": ["f_fabricated000001", "f_fabricated000002"],
                "hypotheses": [{"type": "confirmed_credential_theft", "supporting_fact_ids": ["f_fabricated000001"], "counterevidence_fact_ids": [], "unknown_codes": []}],
                "false_positive_assessment": {"status": "likely_false_positive", "supporting_fact_ids": [], "missing_evidence_codes": []},
                "playbook_ids": ["wipe_and_reimage_everything"],
            }
        else:
            sel = {
                "schema_version": "1",
                "packet_hash": self.packet_hash,
                "summary_fact_ids": ["f_fabricated000001"],
                "hypotheses": [
                    {"type": "insufficient_evidence", "supporting_fact_ids": [], "counterevidence_fact_ids": [], "unknown_codes": []},
                    {"type": "possible_account_misuse", "supporting_fact_ids": ["f_fabricated000001"], "counterevidence_fact_ids": [], "unknown_codes": []},
                ],
                "false_positive_assessment": {"status": "not_assessed", "supporting_fact_ids": [], "missing_evidence_codes": []},
                "playbook_ids": [],
            }
        return Reply(content=[Block("tool_use", id=f"s{self.n}", name="submit_selections", input=sel)], stop_reason="tool_use")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--incident-id", default=None, help="default: the run's highest-class incident")
    args = ap.parse_args()
    s = get_settings()
    sentry.init("fault-injection", s)
    cfg = get_config()
    with connect_direct(s.database_url) as conn, conn.cursor() as cur:
        if args.incident_id:
            cur.execute("SELECT incident_id, current_version FROM incidents WHERE run_id=%s AND incident_id=%s", (args.run_id, args.incident_id))
        else:
            cur.execute("SELECT incident_id, current_version FROM incidents WHERE run_id=%s ORDER BY (current_class='high_risk') DESC, last_seq DESC LIMIT 1", (args.run_id,))
        inc = cur.fetchone()
        if inc is None:
            print("no incident found", file=sys.stderr)
            return 1
        cur.execute("SELECT packet_hash FROM fact_packets WHERE run_id=%s AND incident_id=%s AND version=%s", (args.run_id, inc["incident_id"], inc["current_version"]))
        ph = cur.fetchone()["packet_hash"]
        # Archive any existing explanation for this version so the injected attempt is visible, then queue a fresh job.
        cur.execute("DELETE FROM explanations WHERE run_id=%s AND incident_id=%s AND version=%s", (args.run_id, inc["incident_id"], inc["current_version"]))
        cur.execute("DELETE FROM explanation_jobs WHERE run_id=%s AND incident_id=%s AND version=%s", (args.run_id, inc["incident_id"], inc["current_version"]))
        cur.execute(
            "INSERT INTO explanation_jobs (job_id, run_id, incident_id, version, packet_hash, state, trace_context) VALUES (%s, %s, %s, %s, %s, 'pending', %s)",
            (str(uuid.uuid4()), args.run_id, inc["incident_id"], inc["current_version"], ph, jsonb({"fault_injection": True})),
        )
        conn.commit()
    worker = SideEffectWorker(s.database_url, cfg=cfg, explainer=ScriptedBadExplainer(ph), worker_id="fault-injection")
    with connect_direct(s.database_url) as conn:
        outcome = worker.explain_one(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT state, rejection_reasons, validated->>'ai_review' ai FROM explanations WHERE run_id=%s AND incident_id=%s AND version=%s", (args.run_id, inc["incident_id"], inc["current_version"]))
            row = cur.fetchone()
    print(json.dumps({"label": "FAULT INJECTION (scripted invalid proposal, not a real provider)", "incident_id": inc["incident_id"], "version": inc["current_version"],
                      "outcome": outcome, "explanation_state": row["state"], "ai_review": row["ai"], "rejection_reasons": row["rejection_reasons"],
                      "sentry": "claim_rejected logged per reason" if sentry.enabled() else "Sentry disabled (no DSN): reasons logged locally"}, indent=2))
    sentry.flush()
    return 0 if outcome == "rejected" else 2


if __name__ == "__main__":
    raise SystemExit(main())
