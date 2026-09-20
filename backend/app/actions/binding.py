"""Deterministic parameter binding and precondition evaluation.

The AI selects playbooks; this module decides what an action would actually touch. Every parameter is read out of
the incident row or out of a typed fact in the committed packet, and each bound value keeps the fact id it came
from, so the provenance of a remediation target is as checkable as the provenance of a detection.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.config import canonical_hash


@dataclass(frozen=True)
class Check:
    check: str
    ok: bool
    detail: str


@dataclass
class BoundAction:
    action: dict[str, Any]
    params: dict[str, Any] = field(default_factory=dict)
    bound_from: dict[str, str] = field(default_factory=dict)  # parameter -> fact id or "incident.<column>"
    bound_fact_ids: list[str] = field(default_factory=list)
    checks: list[Check] = field(default_factory=list)
    unmet: list[str] = field(default_factory=list)  # binding failures and failed preconditions, in order

    @property
    def action_id(self) -> str:
        return str(self.action["id"])

    @property
    def available(self) -> bool:
        return not self.unmet

    @property
    def params_hash(self) -> str:
        """Pins the approved binding. An execute whose re-binding hashes differently is refused, not guessed."""
        return canonical_hash({"action_id": self.action_id, "params": self.params})[:32]

    def as_dict(self) -> dict[str, Any]:
        a = self.action
        return {
            "action_id": self.action_id,
            "playbook_id": a["playbook_id"],
            "title": a["title"],
            "kind": a["kind"],
            "severity": a["severity"],
            "reversible": bool(a.get("reversible", True)),
            "summary": a["summary"],
            "impact": a["impact"],
            "permissions": a.get("permissions"),
            "rollback": a["rollback"],
            "verification": a["verification"],
            "params": self.params,
            "bound_from": self.bound_from,
            "bound_fact_ids": self.bound_fact_ids,
            "params_hash": self.params_hash,
            "available": self.available,
            "unmet": self.unmet,
            "checks": [{"check": c.check, "ok": c.ok, "detail": c.detail} for c in self.checks],
        }


def bind(action: dict[str, Any], *, incident: dict[str, Any], version: dict[str, Any], packet: dict[str, Any] | None) -> BoundAction:
    facts = list((packet or {}).get("facts") or [])
    rule_ids = [str(r) for r in (version.get("rule_ids") or [])]
    out = BoundAction(action=action)

    for name, spec in (action.get("params") or {}).items():
        value, source, problem = _resolve(spec, incident=incident, facts=facts)
        if problem:
            out.unmet.append(f"parameter {name!r}: {problem}")
            continue
        out.params[name] = value
        out.bound_from[name] = source
        if source.startswith("fact:") and (fid := source.split(":", 1)[1].split(".", 1)[0]) not in out.bound_fact_ids:
            out.bound_fact_ids.append(fid)

    for pre in action.get("preconditions") or []:
        c = _check(pre, incident=incident, facts=facts, rule_ids=rule_ids)
        out.checks.append(c)
        if not c.ok:
            out.unmet.append(c.detail)
    return out


def bind_all(catalog: list[dict[str, Any]], *, incident: dict[str, Any], version: dict[str, Any], packet: dict[str, Any] | None) -> list[BoundAction]:
    bound = [bind(a, incident=incident, version=version, packet=packet) for a in catalog]
    # Available first, then containment before handoff, then catalog order — the operator's reading order.
    order = {"containment": 0, "handoff": 1}
    return sorted(bound, key=lambda b: (not b.available, order.get(str(b.action["severity"]), 9)))


# ------------------------------------------------------------------------------------------------- resolution

def _resolve(spec: dict[str, Any], *, incident: dict[str, Any], facts: list[dict[str, Any]]) -> tuple[Any, str, str | None]:
    """Returns (value, source, problem). A problem makes the action unavailable rather than partially bound."""
    src = str(spec["from"])
    value: Any
    source: str
    if src.startswith("incident."):
        column = src.split(".", 1)[1]
        value = incident.get(column)
        source = src
        if value in (None, ""):
            return None, source, f"the incident has no {column}"
    elif src.startswith("fact:"):
        rest = src.removeprefix("fact:")
        kind, _, tail = rest.partition(".")
        fact = _first_fact(facts, kind)
        if fact is None:
            return None, src, f"no {kind} fact in this packet"
        if tail == "value":
            value = fact.get("value")
        elif tail.startswith("args."):
            value = (fact.get("args") or {}).get(tail.removeprefix("args."))
        else:
            return None, src, f"unsupported fact accessor {tail!r}"
        source = f"fact:{fact['fact_id']}.{tail}"
        if value in (None, ""):
            return None, source, f"{kind} carries no {tail}"
    else:
        return None, src, f"unsupported binding source {src!r}"

    if split := spec.get("split"):
        parts = str(value).split(str(split.get("sep", "|")))
        index = int(split.get("index", 0))
        if index >= len(parts):
            return None, source, f"value {value!r} has no segment {index}"
        value = parts[index]
    return value, source, None


def _first_fact(facts: list[dict[str, Any]], kind: str) -> dict[str, Any] | None:
    """Trigger and supporting facts outrank context facts: an action binds to what fired the rule."""
    ranked = sorted(facts, key=lambda f: {"trigger": 0, "support": 1}.get(str(f.get("role")), 2))
    return next((f for f in ranked if f.get("kind") == kind), None)


def _check(pre: dict[str, Any], *, incident: dict[str, Any], facts: list[dict[str, Any]], rule_ids: list[str]) -> Check:
    kind = str(pre["check"])
    if kind == "always":
        return Check(kind, True, "no precondition")
    if kind == "incident_status_open":
        ok = incident.get("status") == "open"
        return Check(kind, ok, "incident is open" if ok else "incident is already closed")
    if kind == "rule_any":
        want = [str(r) for r in pre.get("rules") or []]
        hit = sorted(set(want) & set(rule_ids))
        return Check(kind, bool(hit), f"matched {', '.join(hit)}" if hit else f"this version matched {', '.join(rule_ids) or 'no rule'}, not {'/'.join(want)}")
    if kind == "fact_present":
        wanted_kind = str(pre["kind"])
        f = _first_fact(facts, wanted_kind)
        return Check(kind, f is not None, f"{wanted_kind} present" if f else f"no {wanted_kind} fact in this packet")
    if kind == "fact_value_in":
        wanted_kind, values = str(pre["kind"]), [str(v) for v in pre.get("values") or []]
        f = _first_fact(facts, wanted_kind)
        if f is None:
            return Check(kind, False, f"no {wanted_kind} fact in this packet")
        got = str(f.get("value"))
        return Check(kind, got in values, f"{wanted_kind} is {got!r}" + ("" if got in values else f", not one of {values}"))
    return Check(kind, False, f"unknown precondition {kind!r}")
