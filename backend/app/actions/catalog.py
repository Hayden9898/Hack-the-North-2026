"""Reviewed containment-action catalog (config/actions.yaml).

Actions are data, not code paths: each entry names the playbook it belongs to, how its parameters are bound from
the incident and its fact packet, which preconditions must hold, and which verification query proves the outcome.
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from app.actions.verify import QUERIES
from app.settings import get_settings

CATALOG_VERSION = 1
SEVERITIES = {"containment", "handoff"}
CHECKS = {"always", "incident_status_open", "rule_any", "fact_present", "fact_value_in"}
BINDING_SOURCE = re.compile(r"^(incident\.\w+|fact:\w+\.(value|args\.\w+))$")


@lru_cache(maxsize=2)
def load_catalog(config_dir: str | None = None) -> list[dict[str, Any]]:
    path = Path(config_dir or get_settings().config_dir) / "actions.yaml"
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    actions = list(doc["actions"])
    _validate(actions)
    return actions


def by_id(catalog: list[dict[str, Any]], action_id: str) -> dict[str, Any] | None:
    return next((a for a in catalog if a["id"] == action_id), None)


def for_playbooks(catalog: list[dict[str, Any]], playbook_ids: set[str]) -> list[dict[str, Any]]:
    """Actions belonging to playbooks that are applicable to this incident."""
    return [a for a in catalog if a["playbook_id"] in playbook_ids]


def _validate(actions: list[dict[str, Any]]) -> None:
    """Fail at load time rather than at approval time: a malformed catalog is a configuration error."""
    seen: set[str] = set()
    for a in actions:
        aid = a.get("id")
        if not aid or aid in seen:
            raise ValueError(f"actions.yaml: missing or duplicate action id {aid!r}")
        seen.add(aid)
        if a.get("severity") not in SEVERITIES:
            raise ValueError(f"actions.yaml: {aid} has severity {a.get('severity')!r}, expected one of {sorted(SEVERITIES)}")
        for key in ("playbook_id", "title", "kind", "summary", "impact", "rollback", "verification"):
            if not a.get(key):
                raise ValueError(f"actions.yaml: {aid} is missing {key!r}")
        params = a.get("params") or {}
        for name, spec in params.items():
            if not isinstance(spec, dict) or "from" in spec and not isinstance(spec["from"], str):
                raise ValueError(f"actions.yaml: {aid} parameter {name!r} has a malformed binding")
            if "from" not in spec:
                raise ValueError(f"actions.yaml: {aid} parameter {name!r} has no `from` source")
            if not BINDING_SOURCE.match(spec["from"]):
                raise ValueError(f"actions.yaml: {aid} parameter {name!r} has unsupported binding source {spec['from']!r}")
            if (split := spec.get("split")) is not None:
                index = split.get("index", 0) if isinstance(split, dict) else None
                if isinstance(index, bool) or not isinstance(index, int) or index < 0:
                    raise ValueError(f"actions.yaml: {aid} parameter {name!r} split index must be an integer >= 0")
        for pre in a.get("preconditions") or []:
            check = pre.get("check")
            if check not in CHECKS:
                raise ValueError(f"actions.yaml: {aid} uses unknown precondition {check!r}")
            if check in ("fact_present", "fact_value_in") and not pre.get("kind"):
                raise ValueError(f"actions.yaml: {aid} precondition {check} names no fact kind")
            if check == "fact_value_in" and not (isinstance(pre.get("values"), list) and pre["values"]):
                raise ValueError(f"actions.yaml: {aid} precondition fact_value_in needs a non-empty values list")
            if check == "rule_any" and not (isinstance(pre.get("rules"), list) and pre["rules"]):
                raise ValueError(f"actions.yaml: {aid} precondition rule_any needs a non-empty rules list")
        verification = a["verification"]
        qid = verification.get("id") if isinstance(verification, dict) else None
        if qid != "none":
            if qid not in QUERIES:
                raise ValueError(f"actions.yaml: {aid} names unknown verification query {qid!r}")
            missing = [p for p in QUERIES[qid]["params"] if p not in params]
            if missing:
                raise ValueError(f"actions.yaml: {aid} verification {qid} needs undeclared parameter(s) {', '.join(missing)}")
