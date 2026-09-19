"""Constrained AI investigation entry point. With no provider (or on any failure) the deterministic summary is used and
the explanation is marked 'fallback' with "AI review unavailable". Full provider/validator wiring lands in M5; the
contract here is stable: explain_packet → {state, validated, proposal_raw, rejection_reasons, model_name, tool_calls}."""
from __future__ import annotations

from typing import Any

import psycopg

from app.config import DetectionConfig


def deterministic_fallback(packet: dict[str, Any], reason: str) -> dict[str, Any]:
    return {
        "state": "fallback",
        "model_name": "none",
        "tool_calls": 0,
        "validated": {
            "schema_version": "1",
            "packet_hash": packet["packet_hash"],
            "summary_fact_ids": packet["trigger_fact_ids"][:6],
            "hypotheses": [],
            "false_positive_assessment": {"status": "not_assessed", "supporting_fact_ids": [], "missing_evidence_codes": []},
            "playbook_ids": [],
            "ai_review": "unavailable",
            "ai_review_reason": reason,
        },
        "proposal_raw": None,
        "rejection_reasons": [],
    }


def explain_packet(conn: psycopg.Connection[Any], run_id: str, packet: dict[str, Any], explainer: Any | None, cfg: DetectionConfig) -> dict[str, Any]:
    if explainer is None:
        return deterministic_fallback(packet, "no LLM provider configured (deterministic mode)")
    try:
        from app.investigation.pipeline import run_investigation

        return run_investigation(conn, run_id, packet, explainer, cfg)
    except Exception as exc:  # noqa: BLE001 - provider problems never propagate to core detection
        fb = deterministic_fallback(packet, f"provider error: {type(exc).__name__}")
        fb["rejection_reasons"] = [f"provider_error:{type(exc).__name__}"]
        return fb
