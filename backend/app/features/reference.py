"""Frozen bootstrap reference: familiar successful-login sources, bootstrap query keys and byte medians.

Built once per run (or per model) from the bootstrap partition of the *raw* dataset. It is observed familiarity,
not authorization. Repeated failures never make a pair familiar because only login 200s are counted.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import psycopg

from app.config import DetectionConfig, canonical_hash


@dataclass
class Reference:
    version: int
    bootstrap_start: str
    bootstrap_end_exclusive: str
    familiar_pairs: dict[str, list[str]] = field(default_factory=dict)  # account -> sorted familiar IPs
    pair_support: dict[str, dict[str, int]] = field(default_factory=dict)  # "acct|ip" -> {events, dates}
    accounts_with_support: list[str] = field(default_factory=list)
    family_query_keys: dict[str, list[str]] = field(default_factory=dict)  # route family -> sorted keys seen
    bytes_median_log1p: dict[str, float] = field(default_factory=dict)  # "family|status" -> median log1p(bytes)
    min_success_events: int = 3
    min_distinct_dates: int = 2
    source: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "bootstrap_start": self.bootstrap_start,
            "bootstrap_end_exclusive": self.bootstrap_end_exclusive,
            "familiar_pairs": self.familiar_pairs,
            "pair_support": self.pair_support,
            "accounts_with_support": self.accounts_with_support,
            "family_query_keys": self.family_query_keys,
            "bytes_median_log1p": self.bytes_median_log1p,
            "min_success_events": self.min_success_events,
            "min_distinct_dates": self.min_distinct_dates,
            "source": self.source,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Reference:
        return cls(**{k: d.get(k, v) for k, v in cls.empty().to_dict().items()})

    @classmethod
    def empty(cls) -> Reference:
        return cls(version=1, bootstrap_start="", bootstrap_end_exclusive="")

    @property
    def hash(self) -> str:
        return canonical_hash(self.to_dict())

    def account_known(self, account: str) -> bool:
        return account in self.accounts_with_support

    def pair_familiar(self, account: str, ip: str) -> bool:
        return ip in self.familiar_pairs.get(account, ())

    def familiarity(self, account: str, ip: str) -> str:
        """'familiar' | 'unfamiliar' | 'reference_unknown'."""
        if not self.account_known(account):
            return "reference_unknown"
        return "familiar" if self.pair_familiar(account, ip) else "unfamiliar"

    def bytes_reference(self, family: str, status: int) -> float | None:
        return self.bytes_median_log1p.get(f"{family}|{status}")


def build_reference(
    conn: psycopg.Connection[Any],
    dataset_id: str,
    cfg: DetectionConfig,
    start: datetime | None = None,
    end_exclusive: datetime | None = None,
) -> Reference:
    """Compute the frozen reference from raw events of one dataset inside [start, end_exclusive)."""
    part = cfg.partitions["bootstrap"]
    start = start or part.start
    end = end_exclusive or part.end_exclusive
    fam = cfg.policy["familiarity"]
    tz = cfg.partitions.local_tz()
    ref = Reference(
        version=1,
        bootstrap_start=start.isoformat(),
        bootstrap_end_exclusive=end.isoformat(),
        min_success_events=int(fam["min_success_events"]),
        min_distinct_dates=int(fam["min_distinct_dates"]),
        source={"dataset_id": dataset_id, "routes_version": cfg.routes.version},
    )
    login_families = sorted(cfg.routes.categories.get("login_families", frozenset()))
    with conn.cursor() as cur:
        cur.execute(
            """SELECT r.username, r.ip_raw, r.event_time
               FROM raw_events r JOIN event_registry e USING (event_id)
               WHERE e.dataset_id = %s AND r.event_time >= %s AND r.event_time < %s
                 AND r.route_family = ANY(%s) AND r.status = 200""",
            (dataset_id, start, end, login_families),
        )
        support: dict[tuple[str, str], tuple[int, set]] = {}
        for row in cur.fetchall():
            key = (row["username"], row["ip_raw"])
            n, dates = support.get(key, (0, set()))
            dates.add(row["event_time"].astimezone(tz).date().isoformat())
            support[key] = (n + 1, dates)
        for (acct, ip), (n, dates) in sorted(support.items()):
            ref.pair_support[f"{acct}|{ip}"] = {"events": n, "dates": len(dates)}
            if n >= ref.min_success_events and len(dates) >= ref.min_distinct_dates:
                ref.familiar_pairs.setdefault(acct, []).append(ip)
        for acct in ref.familiar_pairs:
            ref.familiar_pairs[acct].sort()
        ref.accounts_with_support = sorted(ref.familiar_pairs)

        cur.execute(
            """SELECT r.route_family, k.key
               FROM raw_events r JOIN event_registry e USING (event_id), unnest(r.query_keys) AS k(key)
               WHERE e.dataset_id = %s AND r.event_time >= %s AND r.event_time < %s
               GROUP BY 1, 2""",
            (dataset_id, start, end),
        )
        for row in cur.fetchall():
            ref.family_query_keys.setdefault(row["route_family"], []).append(row["key"])
        for f in ref.family_query_keys:
            ref.family_query_keys[f].sort()

        cur.execute(
            """SELECT r.route_family, r.status,
                      percentile_cont(0.5) WITHIN GROUP (ORDER BY ln(1 + coalesce(r.response_bytes, 0))) AS med
               FROM raw_events r JOIN event_registry e USING (event_id)
               WHERE e.dataset_id = %s AND r.event_time >= %s AND r.event_time < %s
               GROUP BY 1, 2""",
            (dataset_id, start, end),
        )
        for row in cur.fetchall():
            if row["med"] is not None and not math.isnan(row["med"]):
                ref.bytes_median_log1p[f"{row['route_family']}|{row['status']}"] = float(row["med"])
    return ref


def utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)
