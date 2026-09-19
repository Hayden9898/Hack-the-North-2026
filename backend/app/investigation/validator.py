"""Validates an LLM selection proposal against the immutable fact packet (architecture.md §8).

Rejects: schema violations, wrong packet hash, unknown fact ids, facts beyond the cutoff, hypotheses without their
minimum supporting predicates, contradictory selections, inapplicable playbooks. Forces inclusion of every trigger fact.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from app.investigation.schema import (
    FP_STATUSES,
    GLOBAL_UNKNOWN_CODES,
    HYPOTHESIS_CODES,
    MISSING_EVIDENCE_CODES,
    SCHEMA_VERSION,
    Selections,
)


@dataclass
class ValidationResult:
    ok: bool
    reasons: list[str] = field(default_factory=list)
    validated: dict[str, Any] | None = None


def _fact_kind_key(f: dict[str, Any]) -> set[str]:
    kinds = {f["kind"]}
    if f["kind"] == "source_familiarity":
        kinds.add(f"source_familiarity:{f['value']}")
    return kinds


def validate(proposal: Any, packet: dict[str, Any], applicable_playbook_ids: set[str]) -> ValidationResult:
    reasons: list[str] = []
    if not isinstance(proposal, dict):
        return ValidationResult(False, ["proposal is not a JSON object"])
    try:
        sel = Selections.model_validate(proposal)
    except ValidationError as exc:
        return ValidationResult(False, [f"schema:{e['loc']}:{e['msg']}"[:200] for e in exc.errors()][:10])

    if sel.packet_hash != packet["packet_hash"]:
        reasons.append("packet_hash mismatch")
    facts = {f["fact_id"]: f for f in packet["facts"]}
    cutoff = int(packet["cutoff_seq"])

    def check_ids(ids: list[str], where: str) -> None:
        for fid in ids:
            f = facts.get(fid)
            if f is None:
                reasons.append(f"{where}: unknown fact id {fid}")
            elif int(f["cutoff_seq"]) > cutoff:
                reasons.append(f"{where}: fact {fid} is beyond the packet cutoff")

    check_ids(sel.summary_fact_ids, "summary")
    seen_types: set[str] = set()
    for i, h in enumerate(sel.hypotheses):
        where = f"hypotheses[{i}]({h.type})"
        if h.type in seen_types:
            reasons.append(f"{where}: duplicate hypothesis type")
        seen_types.add(h.type)
        check_ids(h.supporting_fact_ids, where + ".supporting")
        check_ids(h.counterevidence_fact_ids, where + ".counterevidence")
        overlap = set(h.supporting_fact_ids) & set(h.counterevidence_fact_ids)
        if overlap:
            reasons.append(f"{where}: facts cited as both supporting and counterevidence: {sorted(overlap)}")
        for code in h.unknown_codes:
            if code not in GLOBAL_UNKNOWN_CODES and code not in set(packet.get("unknown_codes", [])):
                reasons.append(f"{where}: unknown_code {code!r} not in the allowed list")
        spec = HYPOTHESIS_CODES[h.type]
        needed = spec["min_fact_kinds"]
        if needed:
            cited_kinds: set[str] = set()
            for fid in h.supporting_fact_ids:
                if fid in facts:
                    cited_kinds |= _fact_kind_key(facts[fid])
            if not cited_kinds & needed:
                reasons.append(f"{where}: no supporting fact of a required kind ({sorted(needed)})")
    if "insufficient_evidence" in seen_types and len(seen_types) > 1:
        reasons.append("contradictory: insufficient_evidence combined with a specific hypothesis")
    fp = sel.false_positive_assessment
    check_ids(fp.supporting_fact_ids, "false_positive_assessment")
    if fp.status == "likely_false_positive" and not fp.supporting_fact_ids:
        reasons.append("false_positive_assessment: likely_false_positive requires supporting facts")
    for code in fp.missing_evidence_codes:
        if code not in MISSING_EVIDENCE_CODES:
            reasons.append(f"false_positive_assessment: unknown missing_evidence code {code!r}")
    for pid in sel.playbook_ids:
        if pid not in applicable_playbook_ids:
            reasons.append(f"playbook {pid!r} does not exist or is not applicable to this incident")
    if reasons:
        return ValidationResult(False, reasons)

    # Immutable inclusion: every trigger fact is part of the published summary whether or not the model chose it.
    forced = [fid for fid in packet["trigger_fact_ids"] if fid not in sel.summary_fact_ids]
    summary_ids = list(sel.summary_fact_ids) + forced
    validated = {
        "schema_version": SCHEMA_VERSION,
        "packet_hash": packet["packet_hash"],
        "summary_fact_ids": summary_ids,
        "forced_inclusions": forced,
        "hypotheses": [
            {
                "type": h.type,
                "text": HYPOTHESIS_CODES[h.type]["text"],
                "supporting_fact_ids": h.supporting_fact_ids,
                "counterevidence_fact_ids": h.counterevidence_fact_ids,
                "unknown_codes": h.unknown_codes,
            }
            for h in sel.hypotheses
        ],
        # Advisory only. Never consulted by the detector, correlation or delivery paths.
        "false_positive_assessment": {"status": fp.status, "supporting_fact_ids": fp.supporting_fact_ids, "missing_evidence_codes": fp.missing_evidence_codes, "advisory_only": True},
        "playbook_ids": sel.playbook_ids,
        "unknown_codes": list(packet.get("unknown_codes", [])),
        "ai_review": "validated",
    }
    assert fp.status in FP_STATUSES
    return ValidationResult(True, [], validated)
