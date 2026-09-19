"""Final classification policy: high-risk rule > suspicious rule or model threshold > normal.

Rules and model are evaluated independently; a low model score never vetoes a rule and a model flag alone is at most
suspicious. processing_status and model_health are separate from the threat class.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.detection.rules import RuleMatch


@dataclass(frozen=True)
class Decision:
    threat_class: str  # normal | suspicious | high_risk
    reason_codes: list[str]
    rule_ids: list[str]
    model_flagged: bool | None  # None when no model score is available


def classify(matches: list[RuleMatch], model_score: float | None, threshold: float | None) -> Decision:
    rule_ids = [m.rule_id for m in matches]
    reasons: list[str] = []
    klass = "normal"
    for m in matches:
        reasons.append(f"rule:{m.rule_id}:{m.outcome}")
        if m.incomplete:
            reasons.append(f"rule:{m.rule_id}:evaluation_incomplete")
    if any(m.outcome == "high_risk" for m in matches):
        klass = "high_risk"
    elif any(m.outcome == "suspicious" for m in matches):
        klass = "suspicious"
    flagged: bool | None = None
    if model_score is not None and threshold is not None:
        flagged = model_score > threshold  # strict; ties are not alerts (architecture.md §6)
        if flagged:
            reasons.append("model:anomaly_above_threshold")
            if klass == "normal":
                klass = "suspicious"
    return Decision(threat_class=klass, reason_codes=reasons, rule_ids=rule_ids, model_flagged=flagged)
