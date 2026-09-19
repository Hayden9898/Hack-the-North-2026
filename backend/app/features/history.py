"""SQL-backed observed history for one event: bounded window queries plus persistent per-run entity counters.

Causality: every query is over `processed_events` of the same run with run_seq < k. Equal-timestamp records that
precede k are included; records after k are excluded. Counters exclude the current event until `apply_event`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import psycopg

from app.db.engine import jsonb
from app.features.events import Event

STATS_SCHEMA_VERSION = 1


@dataclass
class WindowCounts:
    acct_5m: int = 0
    acct_1h: int = 0
    ip_5m: int = 0
    pair_login_5m: int = 0
    pair_401_5m: int = 0
    pair_401_60s: int = 0
    acct_5m_prev: int = 0  # requests in the 5 minutes *before* the current one (for burst framing)


def window_counts(conn: psycopg.Connection[Any], run_id: str, ev: Event, windows: dict[str, int], r1_window: int) -> WindowCounts:
    t = ev.event_time
    short = timedelta(seconds=int(windows["short"]))
    medium = timedelta(seconds=int(windows["medium"]))
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              count(*) FILTER (WHERE username = %(u)s AND event_time >= %(t5)s)                                        AS acct_5m,
              count(*) FILTER (WHERE username = %(u)s)                                                                 AS acct_1h,
              count(*) FILTER (WHERE ip_raw = %(ip)s AND event_time >= %(t5)s)                                         AS ip_5m,
              count(*) FILTER (WHERE username = %(u)s AND ip_raw = %(ip)s AND route_family = ANY(%(login)s)
                               AND event_time >= %(t5)s)                                                              AS pair_login_5m,
              count(*) FILTER (WHERE username = %(u)s AND ip_raw = %(ip)s AND route_family = ANY(%(login)s)
                               AND status = 401 AND event_time >= %(t5)s)                                             AS pair_401_5m,
              count(*) FILTER (WHERE username = %(u)s AND ip_raw = %(ip)s AND route_family = ANY(%(login)s)
                               AND status = 401 AND event_time >= %(t60)s)                                            AS pair_401_60s
            FROM processed_events
            WHERE run_id = %(run)s AND event_time >= %(t1h)s AND event_time <= %(t)s AND run_seq < %(k)s
              AND (username = %(u)s OR ip_raw = %(ip)s)
            """,
            {
                "run": run_id,
                "u": ev.username,
                "ip": ev.ip_raw,
                "t": t,
                "t5": t - short,
                "t1h": t - medium,
                "t60": t - timedelta(seconds=r1_window),
                "k": ev.run_seq,
                "login": list(LOGIN_FAMILIES),
            },
        )
        row = cur.fetchone() or {}
    return WindowCounts(**{k: int(row.get(k, 0) or 0) for k in ("acct_5m", "acct_1h", "ip_5m", "pair_login_5m", "pair_401_5m", "pair_401_60s")})


# Populated from config at detector start (kept module-level to keep the SQL parameter list short).
LOGIN_FAMILIES: tuple[str, ...] = ("login",)


def configure(login_families: tuple[str, ...]) -> None:
    global LOGIN_FAMILIES
    LOGIN_FAMILIES = tuple(login_families)


# ------------------------------------------------------------------------------------------------ entity counters


def _account_default() -> dict[str, Any]:
    return {"n": 0, "ips": {}, "hours": {}, "families": {}, "paths_denied": 0}


def _pair_default() -> dict[str, Any]:
    return {"n": 0, "login_attempts": 0, "login_failures": 0, "login_success": 0}


def _account_path_default() -> dict[str, Any]:
    return {"n": 0, "get200": 0, "get403": 0, "post2xx": 0, "any2xx": 0}


DEFAULTS = {"account": _account_default, "pair": _pair_default, "account_path": _account_path_default}


@dataclass
class StatsStore:
    """Transaction-scoped read-through cache over `entity_stats`. Authoritative state is SQL; the cache only avoids
    repeated reads inside one microbatch and is written back before commit."""

    conn: psycopg.Connection[Any]
    run_id: str
    cache: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    dirty: set[tuple[str, str]] = field(default_factory=set)

    def get(self, key_type: str, key_value: str) -> dict[str, Any]:
        k = (key_type, key_value)
        if k in self.cache:
            return self.cache[k]
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT state FROM entity_stats WHERE run_id=%s AND key_type=%s AND key_value=%s",
                (self.run_id, key_type, key_value),
            )
            row = cur.fetchone()
        state = dict(row["state"]) if row else DEFAULTS[key_type]()
        self.cache[k] = state
        return state

    def apply_event(self, ev: Event) -> None:
        """Update counters with the now-processed event. Called after features/rules for this event."""
        acct = self.get("account", ev.username)
        acct["n"] += 1
        acct["ips"][ev.ip_raw] = acct["ips"].get(ev.ip_raw, 0) + 1
        h = str(ev.local_time.hour)
        acct["hours"][h] = acct["hours"].get(h, 0) + 1
        acct["families"][ev.route_family] = acct["families"].get(ev.route_family, 0) + 1
        self.dirty.add(("account", ev.username))

        pair = self.get("pair", ev.pair_key)
        pair["n"] += 1
        if ev.route_family in LOGIN_FAMILIES:
            pair["login_attempts"] += 1
            if ev.status == 401:
                pair["login_failures"] += 1
            elif ev.is_2xx:
                pair["login_success"] += 1
        self.dirty.add(("pair", ev.pair_key))

        ap = self.get("account_path", ev.account_path_key)
        ap["n"] += 1
        if ev.method == "GET" and ev.status == 200:
            ap["get200"] += 1
        if ev.method == "GET" and ev.status == 403:
            ap["get403"] += 1
            acct["paths_denied"] += 1
        if ev.method == "POST" and ev.is_2xx:
            ap["post2xx"] += 1
        if ev.is_2xx:
            ap["any2xx"] += 1
        self.dirty.add(("account_path", ev.account_path_key))

    def flush(self) -> None:
        if not self.dirty:
            return
        rows = [(self.run_id, kt, kv, STATS_SCHEMA_VERSION, jsonb(self.cache[(kt, kv)])) for kt, kv in self.dirty]
        with self.conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO entity_stats (run_id, key_type, key_value, schema_version, state)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (run_id, key_type, key_value) DO UPDATE SET state = EXCLUDED.state, schema_version = EXCLUDED.schema_version""",
                rows,
            )
        self.dirty.clear()
