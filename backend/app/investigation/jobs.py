"""Explanation job runner (claim → build prompt from packet → provider → validate → persist). Full provider
integration and validation live in app.investigation.{schema,validator,provider}; this module owns the lease loop and
the deterministic fallback so core detection never waits on an LLM."""
from __future__ import annotations

import time
from datetime import datetime, timedelta
from typing import Any

import psycopg

from app.db.engine import jsonb
from app.observability import sentry

LEASE_SECONDS = 45
PROMPT_VERSION = "1"
# A job whose worker keeps dying is reclaimed after lease expiry; this caps how often. Overridable through
# policy.investigation.max_attempts.
DEFAULT_MAX_JOB_ATTEMPTS = 3


def claim_job(conn: psycopg.Connection[Any], worker_id: str, now: datetime, max_attempts: int = DEFAULT_MAX_JOB_ATTEMPTS) -> dict[str, Any] | None:
    """Lease the oldest ready job. Jobs that already used `max_attempts` leases are marked failed (with a deterministic
    fallback explanation so the incident still shows a summary) and skipped."""
    while True:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT * FROM explanation_jobs
                   WHERE (state='pending' OR (state='leased' AND lease_expires_at < %s)) AND next_attempt_at <= %s
                   ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED""",
                (now, now),
            )
            row = cur.fetchone()
            if row is None:
                conn.commit()
                return None
            job = dict(row)
            if int(job["attempts"]) >= max_attempts:
                _exhaust_job(cur, job, max_attempts)
                conn.commit()
                continue
            cur.execute(
                "UPDATE explanation_jobs SET state='leased', lease_owner=%s, lease_expires_at=%s, attempts=attempts+1, updated_at=now() WHERE job_id=%s",
                (worker_id, now + timedelta(seconds=LEASE_SECONDS), job["job_id"]),
            )
        conn.commit()
        return job


def run_one_job(conn: psycopg.Connection[Any], worker: Any, explainer: Any | None) -> str | None:
    now = worker.now()
    icfg = worker.cfg.policy.get("investigation", {})
    job = claim_job(conn, worker.worker_id, now, int(icfg.get("max_attempts", DEFAULT_MAX_JOB_ATTEMPTS)))
    if job is None:
        return None
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM fact_packets WHERE run_id=%s AND incident_id=%s AND version=%s", (job["run_id"], job["incident_id"], job["version"]))
        packet_row = cur.fetchone()
        cur.execute("SELECT current_version FROM incidents WHERE run_id=%s AND incident_id=%s", (job["run_id"], job["incident_id"]))
        inc = cur.fetchone()
    conn.commit()
    if packet_row is None or inc is None:
        _finish(conn, worker.worker_id, job, "failed", error="packet missing")
        return "failed"
    packet = packet_row["facts"]
    if packet_row["packet_hash"] != job["packet_hash"]:
        _finish(conn, worker.worker_id, job, "failed", error="packet hash mismatch")
        return "failed"

    from app.investigation.explain import explain_packet

    t0 = time.perf_counter()
    with sentry.transaction("explanation", "explanation_job", trace_context=job.get("trace_context"), incident_id=job["incident_id"], version=job["version"]):
        result = explain_packet(conn, job["run_id"], packet, explainer, worker.cfg)
    latency_ms = int((time.perf_counter() - t0) * 1000)
    # Stale-version guard (E03): a newer incident version wins; archive this result but never overwrite current view.
    # This pre-call read is only a hint; the persist step re-checks under lock because the detector may supersede
    # the version while the provider call is in flight.
    stale = int(inc["current_version"]) != int(job["version"])
    _persist_explanation(conn, worker.worker_id, job, packet, result, latency_ms, stale)
    return result["state"]


def _persist_explanation(conn: psycopg.Connection[Any], worker_id: str, job: dict[str, Any], packet: dict[str, Any], result: dict[str, Any], latency_ms: int, stale: bool) -> None:
    with conn.cursor() as cur:
        # Lock order matches the detector (run row first, then incident/job rows) so the version re-check below and
        # the ui_updates sequence allocation cannot race a microbatch commit.
        cur.execute("SELECT 1 FROM runs WHERE run_id=%s FOR UPDATE", (job["run_id"],))
        cur.execute("SELECT state, lease_owner FROM explanation_jobs WHERE job_id=%s FOR UPDATE", (job["job_id"],))
        row = cur.fetchone()
        if row is None or row["lease_owner"] != worker_id:
            conn.commit()
            return
        cur.execute("SELECT current_version FROM incidents WHERE run_id=%s AND incident_id=%s", (job["run_id"], job["incident_id"]))
        inc = cur.fetchone()
        # Re-check under lock: the detector marks in-flight jobs 'superseded' and bumps current_version when a newer
        # version appears. Late output for an obsolete version stays archived and never becomes the current view.
        stale = stale or row["state"] == "superseded" or inc is None or int(inc["current_version"]) != int(job["version"])
        cur.execute(
            """INSERT INTO explanations (run_id, incident_id, version, packet_hash, prompt_version, model_name, state, proposal_raw, validated,
                   rejection_reasons, latency_ms, tool_calls)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (run_id, incident_id, version) DO NOTHING""",
            (job["run_id"], job["incident_id"], job["version"], job["packet_hash"], PROMPT_VERSION, result.get("model_name", "none"), result["state"],
             jsonb(result.get("proposal_raw")) if result.get("proposal_raw") is not None else None,
             jsonb(result["validated"]) if result.get("validated") is not None else None,
             result.get("rejection_reasons", []), latency_ms, int(result.get("tool_calls", 0))),
        )
        cur.execute(
            "UPDATE explanation_jobs SET state=%s, lease_owner=NULL, lease_expires_at=NULL, last_error=%s, updated_at=now() WHERE job_id=%s",
            ("superseded" if stale else "done", None if not result.get("rejection_reasons") else "; ".join(result["rejection_reasons"])[:500], job["job_id"]),
        )
        if not stale:
            _emit_explanation_update(cur, job, result["state"])
        for reason in result.get("rejection_reasons", []):
            sentry.log_event("claim_rejected", "warning", run_id=job["run_id"], incident_id=job["incident_id"], version=job["version"], reason=reason[:200])
    conn.commit()


def _emit_explanation_update(cur: psycopg.Cursor[Any], job: dict[str, Any], state: str) -> None:
    """Caller must hold the run row lock (update_seq is allocated as max+1 under that lock)."""
    cur.execute(
        "INSERT INTO ui_updates (run_id, update_seq, type, payload) VALUES (%s, (SELECT coalesce(max(update_seq),0)+1 FROM ui_updates WHERE run_id=%s), 'explanation', %s)",
        (job["run_id"], job["run_id"], jsonb({"incident_id": job["incident_id"], "version": job["version"], "state": state})),
    )


def _exhaust_job(cur: psycopg.Cursor[Any], job: dict[str, Any], max_attempts: int) -> None:
    """Attempt ceiling reached: fail the job and, when no explanation exists yet, store the deterministic fallback so
    the incident view is never left waiting. Runs inside the claim transaction (job row already locked)."""
    from app.investigation.explain import deterministic_fallback

    error = f"attempt ceiling reached ({int(job['attempts'])}/{max_attempts})"
    cur.execute(
        "UPDATE explanation_jobs SET state='failed', lease_owner=NULL, lease_expires_at=NULL, last_error=%s, updated_at=now() WHERE job_id=%s",
        (error, job["job_id"]),
    )
    sentry.log_event("claim_rejected", "warning", run_id=job["run_id"], incident_id=job["incident_id"], version=job["version"], reason=error)
    cur.execute("SELECT facts FROM fact_packets WHERE run_id=%s AND incident_id=%s AND version=%s", (job["run_id"], job["incident_id"], job["version"]))
    packet_row = cur.fetchone()
    if packet_row is None:
        return
    fb = deterministic_fallback(packet_row["facts"], "AI review unavailable (explanation job attempt ceiling reached); deterministic summary shown")
    # No ui_update here: that needs the run row lock, which must be taken before the job row (detector lock order)
    # and the claim query already holds the job row. The incident view reads the explanation row directly.
    cur.execute(
        """INSERT INTO explanations (run_id, incident_id, version, packet_hash, prompt_version, model_name, state, proposal_raw, validated,
               rejection_reasons, latency_ms, tool_calls)
           VALUES (%s, %s, %s, %s, %s, 'none', 'fallback', NULL, %s, %s, NULL, 0)
           ON CONFLICT (run_id, incident_id, version) DO NOTHING""",
        (job["run_id"], job["incident_id"], job["version"], job["packet_hash"], PROMPT_VERSION, jsonb(fb["validated"]), [error]),
    )


def _finish(conn: psycopg.Connection[Any], worker_id: str, job: dict[str, Any], state: str, error: str | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE explanation_jobs SET state=%s, last_error=%s, lease_owner=NULL, lease_expires_at=NULL, updated_at=now() WHERE job_id=%s AND lease_owner=%s",
            (state, error, job["job_id"], worker_id),
        )
    conn.commit()
