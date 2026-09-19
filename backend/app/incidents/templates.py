"""Deterministic, qualified text rendered from typed facts. No LLM prose is ever published from here."""
from __future__ import annotations

from typing import Any

RULE_HEADLINES = {
    "R1": "Repeated failed logins from a source not in the account's familiar-login reference",
    "R2": "First successful response for a sensitive resource after repeated denials for this account",
    "R3": "First successful admin request by this account, seconds after viewing a forum object",
    "R4": "Sensitive resource served to an unfamiliar account/source pair shortly after a successful login, following an earlier failed-login episode",
    "R5": "Access change linked to another account's forum-object view and admin request",
}

QUALIFIERS = {
    "R1": "Repeated failures indicate attempts, not who made them.",
    "R2": "A measured change in the observed response, not proof of unauthorized access; an approved grant looks identical.",
    "R3": "Linked recorded requests; no causal assertion about the forum content.",
    "R4": "Suspected account misuse; session identity is not recorded in these logs.",
    "R5": "Does not assert who created the object or whose role changed.",
}


class _Dedup(list):
    """Appends only lines not seen before (keeps first occurrence order)."""

    def __init__(self, target: list[str]) -> None:
        super().__init__()
        self._target = target

    def append(self, line: str) -> None:  # type: ignore[override]
        if line not in self._target:
            self._target.append(line)


def _fmt_event(v: dict[str, Any]) -> str:
    line = f"line {v['line_number']}" if v.get("line_number") else v["event_id"][:10]
    return f"{v['event_time']} {v['account']}@{v['ip']} {v['method']} {v['path']} -> {v['status']} ({line})"


def summarize(rule_ids: list[str], threat_class: str, facts: list[dict[str, Any]], unknown_codes: list[str]) -> dict[str, Any]:
    by_kind: dict[str, list[dict[str, Any]]] = {}
    # Current-version (trigger) facts first; older support facts only add lines that are not already present.
    for f in sorted(facts, key=lambda x: {"trigger": 0, "support": 1, "context": 2}.get(x.get("role", "support"), 1)):
        by_kind.setdefault(f["kind"], []).append(f)
    raw_lines: list[str] = []
    lines = _Dedup(raw_lines)
    for f in by_kind.get("auth_failures_in_window", []):
        lines.append(f"{f['value']} login failures for {f['args']['pair']} within {f['args']['window_seconds']}s (observed).")
    for f in by_kind.get("prior_denials_count", []):
        lines.append(f"{f['value']} prior 403 responses for {f['args']['account']} on {f['args']['path']} before this request (counted).")
    for f in by_kind.get("prior_successes_count", []):
        lines.append(f"{f['value']} prior 200 responses for the same account/path (counted).")
    for f in by_kind.get("time_delta_seconds", []):
        lines.append(f"{f['value']:.0f}s between linked requests {f['args']['from_event'][:8]}… and {f['args']['to_event'][:8]}….")
    for f in by_kind.get("same_object", []):
        lines.append(f"Requests reference the same forum object {f['value']}.")
    for f in by_kind.get("source_familiarity", []):
        if f["role"] != "context":
            lines.append(f"Source pair {f['args']['pair']} is '{f['value']}' relative to the frozen August login reference.")
    lines = raw_lines
    trig = [f for f in by_kind.get("event_observed", []) if f["role"] == "trigger"]
    primary = rule_ids[-1] if rule_ids else ""
    return {
        "headline": RULE_HEADLINES.get(primary, "Detector match"),
        "class": threat_class,
        "qualifier": " ".join(QUALIFIERS[r] for r in rule_ids if r in QUALIFIERS),
        "lines": lines[:8],
        "trigger_events": [_fmt_event(f["value"]) for f in trig[:5]],
        "unknowns": unknown_codes,
    }
