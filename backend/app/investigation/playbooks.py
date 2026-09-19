"""Reviewed playbook catalog (config/playbooks.yaml) and deterministic applicability matching."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from app.settings import get_settings


@lru_cache(maxsize=2)
def load_catalog(config_dir: str | None = None) -> list[dict[str, Any]]:
    p = Path(config_dir or get_settings().config_dir) / "playbooks.yaml"
    doc = yaml.safe_load(p.read_text(encoding="utf-8"))
    return list(doc["playbooks"])


def applicable(catalog: list[dict[str, Any]], rule_ids: list[str], fact_kinds: set[str]) -> list[dict[str, Any]]:
    out = []
    for pb in catalog:
        a = pb.get("applicability") or {}
        if set(a.get("any_rules") or ()) & set(rule_ids) or set(a.get("any_fact_kinds") or ()) & fact_kinds:
            out.append(pb)
    return out


def brief(pb: dict[str, Any]) -> dict[str, Any]:
    return {"id": pb["id"], "title": pb["title"], "uncertainty": pb["uncertainty"], "applicability": pb.get("applicability", {})}
