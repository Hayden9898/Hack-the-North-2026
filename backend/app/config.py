"""Versioned detection configuration (routes, policy, partitions) loaded from YAML.

Everything a detector decision depends on comes from here and is hashed into runs.config_hash.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from app.settings import get_settings


@dataclass(frozen=True)
class RouteFamily:
    id: str
    exact: str | None = None
    prefix: str | None = None
    regex: re.Pattern[str] | None = None
    any: bool = False

    def match(self, path: str) -> tuple[bool, str | None]:
        if self.any:
            return True, None
        if self.exact is not None:
            return path == self.exact, None
        if self.prefix is not None:
            return path.startswith(self.prefix), None
        if self.regex is not None:
            m = self.regex.match(path)
            if m:
                return True, m.groupdict().get("object_id")
            return False, None
        return False, None


@dataclass(frozen=True)
class RouteConfig:
    version: int
    families: tuple[RouteFamily, ...]
    categories: dict[str, frozenset[str]]
    sensitive_substrings: tuple[str, ...]
    sensitive_regexes: tuple[re.Pattern[str], ...]
    expected_query_keys: dict[str, frozenset[str]]
    raw: dict[str, Any] = field(compare=False, hash=False, default_factory=dict)

    def classify(self, path: str) -> tuple[str, str | None]:
        for fam in self.families:
            ok, obj = fam.match(path)
            if ok:
                return fam.id, obj
        return "other", None

    def in_category(self, family: str, category: str) -> bool:
        return family in self.categories.get(category, frozenset())

    def is_sensitive(self, path: str) -> bool:
        upper = path.upper()
        if any(s.upper() in upper for s in self.sensitive_substrings):
            return True
        return any(r.search(path) for r in self.sensitive_regexes)


@dataclass(frozen=True)
class Partition:
    name: str
    start: datetime  # inclusive, UTC
    end_exclusive: datetime


@dataclass(frozen=True)
class Partitions:
    version: int
    dataset_sha256: str | None
    utc_offset_minutes: int
    partitions: dict[str, Partition]

    def local_tz(self) -> timezone:
        return timezone(timedelta(minutes=self.utc_offset_minutes))

    def __getitem__(self, name: str) -> Partition:
        return self.partitions[name]


@dataclass(frozen=True)
class DetectionConfig:
    routes: RouteConfig
    policy: dict[str, Any]
    partitions: Partitions
    config_hash: str
    feature_version: str


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a mapping")
    return data


def canonical_hash(*docs: Any) -> str:
    h = hashlib.sha256()
    for d in docs:
        h.update(json.dumps(d, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8"))
        h.update(b"\x1f")
    return h.hexdigest()


def parse_routes(doc: dict[str, Any]) -> RouteConfig:
    fams: list[RouteFamily] = []
    for item in doc["families"]:
        m = item["match"]
        fams.append(
            RouteFamily(
                id=item["id"],
                exact=m.get("exact"),
                prefix=m.get("prefix"),
                regex=re.compile(m["regex"]) if "regex" in m else None,
                any=bool(m.get("any", False)),
            )
        )
    cats = {k: frozenset(v) for k, v in (doc.get("categories") or {}).items()}
    sens = doc.get("sensitive_resource") or {}
    return RouteConfig(
        version=int(doc["version"]),
        families=tuple(fams),
        categories=cats,
        sensitive_substrings=tuple(sens.get("substrings_case_insensitive") or ()),
        sensitive_regexes=tuple(re.compile(r) for r in (sens.get("path_regexes") or ())),
        expected_query_keys={k: frozenset(v) for k, v in (doc.get("expected_query_keys") or {}).items()},
        raw=doc,
    )


def parse_partitions(doc: dict[str, Any]) -> Partitions:
    offset = int(doc["utc_offset_minutes"])
    tz = timezone(timedelta(minutes=offset))
    parts: dict[str, Partition] = {}
    for name, p in doc["partitions"].items():
        start = datetime.combine(date.fromisoformat(str(p["start"])), datetime.min.time(), tz).astimezone(UTC)
        end = datetime.combine(date.fromisoformat(str(p["end_exclusive"])), datetime.min.time(), tz).astimezone(
            UTC
        )
        if end <= start:
            raise ValueError(f"partition {name} is empty")
        parts[name] = Partition(name=name, start=start, end_exclusive=end)
    order = ["bootstrap", "train", "calibration", "evaluation"]
    for a, b in zip(order, order[1:], strict=False):
        if a in parts and b in parts and parts[a].end_exclusive > parts[b].start:
            raise ValueError(f"partitions {a} and {b} overlap or are out of order")
    return Partitions(
        version=int(doc["version"]),
        dataset_sha256=doc.get("dataset_sha256"),
        utc_offset_minutes=offset,
        partitions=parts,
    )


def load_config(config_dir: str | Path | None = None) -> DetectionConfig:
    cdir = Path(config_dir or get_settings().config_dir)
    routes_doc = _load_yaml(cdir / "routes.yaml")
    policy_doc = _load_yaml(cdir / "policy.yaml")
    parts_doc = _load_yaml(cdir / "partitions.yaml")
    return DetectionConfig(
        routes=parse_routes(routes_doc),
        policy=policy_doc,
        partitions=parse_partitions(parts_doc),
        config_hash=canonical_hash(routes_doc, policy_doc, parts_doc),
        feature_version=str(policy_doc["feature_version"]),
    )


@lru_cache(maxsize=4)
def get_config(config_dir: str | None = None) -> DetectionConfig:
    return load_config(config_dir)
