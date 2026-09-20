"""Independent deterministic rules R1–R6 (architecture.md §7).

Each rule receives the current event, prior history and a bounded evidence repository, and returns a RuleMatch with
event ids for every required leg plus the predicate parameters. Rules never look at the ML score. No account names,
IPs, dates or object ids are encoded here; all thresholds come from policy.yaml.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

import psycopg

from app.config import DetectionConfig
from app.db.engine import one
from app.features.events import Event
from app.features.history import StatsStore, WindowCounts
from app.features.reference import Reference


@dataclass
class RuleMatch:
    rule_id: str
    outcome: str  # suspicious | high_risk
    key_type: str  # pair | account_resource | account_object
    key_value: str
    legs: list[dict[str, Any]]  # [{role, event_id, run_seq, event_time, ...}]
    params: dict[str, Any]
    incomplete: bool = False
    links: list[dict[str, Any]] = field(default_factory=list)  # typed links to other episodes (R5 -> R3 incident)


@dataclass
class RuleContext:
    conn: psycopg.Connection[Any]
    run_id: str
    ev: Event
    win: WindowCounts
    stats: StatsStore
    ref: Reference
    cfg: DetectionConfig
    r2_match: RuleMatch | None = None


def _leg(row: dict[str, Any], role: str) -> dict[str, Any]:
    return {"role": role, "event_id": row["event_id"], "run_seq": int(row["run_seq"]), "event_time": row["event_time"].isoformat()}


def _fetch(ctx: RuleContext, sql: str, params: dict[str, Any], limit: int) -> tuple[list[dict[str, Any]], bool]:
    """Bounded fetch; the second value says whether the cap truncated results (predicate must then be recounted)."""
    with ctx.conn.cursor() as cur:
        cur.execute(sql + " LIMIT %(lim)s", {**params, "lim": limit + 1})
        rows = [dict(r) for r in cur.fetchall()]
    truncated = len(rows) > limit
    return rows[:limit], truncated


def rule_r1_auth_burst(ctx: RuleContext) -> RuleMatch | None:
    ev, cfg = ctx.ev, ctx.cfg.policy["rules"]["R1"]
    routes = ctx.cfg.routes
    if not (routes.in_category(ev.route_family, "login_families") and ev.status == 401):
        return None
    total = ctx.win.pair_401_60s + 1
    if total < int(cfg["min_failures"]):
        return None
    familiarity = ctx.ref.familiarity(ev.username, ev.ip_raw)
    if cfg.get("requires_unfamiliar_or_unknown", True) and familiarity == "familiar":
        return None
    rows, truncated = _fetch(
        ctx,
        """SELECT event_id, run_seq, event_time FROM processed_events
           WHERE run_id=%(run)s AND username=%(u)s AND ip_raw=%(ip)s AND route_family = ANY(%(login)s) AND status=401
             AND event_time >= %(t0)s AND event_time <= %(t)s AND run_seq < %(k)s ORDER BY run_seq""",
        {"run": ctx.run_id, "u": ev.username, "ip": ev.ip_raw, "login": sorted(routes.categories["login_families"]),
         "t0": ev.event_time - timedelta(seconds=int(cfg["window_seconds"])), "t": ev.event_time, "k": ev.run_seq},
        limit=int(ctx.cfg.policy["correlation"]["max_packet_events"]),
    )
    legs = [_leg(r, "prior_failure") for r in rows] + [{"role": "current_failure", **ev.evidence_ref()}]
    return RuleMatch(
        rule_id="R1",
        outcome=cfg["outcome"],
        key_type="pair",
        key_value=ev.pair_key,
        legs=legs,
        params={"window_seconds": cfg["window_seconds"], "min_failures": cfg["min_failures"], "failures_in_window": total,
                "familiarity": familiarity, "reference_hash": ctx.ref.hash},
        incomplete=truncated,
    )


def rule_r6_slow_auth_burst(ctx: RuleContext) -> RuleMatch | None:
    """Detect patient guessing that stays below the one-minute R1 threshold.

    This is intentionally only suspicious alone. A later successful login and sensitive
    access must satisfy R4 independently before the episode can become high risk.
    """
    ev, cfg = ctx.ev, ctx.cfg.policy["rules"]["R6"]
    routes = ctx.cfg.routes
    if not (routes.in_category(ev.route_family, "login_families") and ev.status == 401):
        return None
    # Fast bursts are R1's responsibility; never duplicate its evidence with R6.
    if ctx.win.pair_401_60s + 1 >= int(ctx.cfg.policy["rules"]["R1"]["min_failures"]):
        return None
    familiarity = ctx.ref.familiarity(ev.username, ev.ip_raw)
    if cfg.get("requires_unfamiliar_or_unknown", True) and familiarity == "familiar":
        return None
    t0 = ev.event_time - timedelta(seconds=int(cfg["window_seconds"]))
    params = {
        "run": ctx.run_id,
        "u": ev.username,
        "ip": ev.ip_raw,
        "login": sorted(routes.categories["login_families"]),
        "t0": t0,
        "t": ev.event_time,
        "k": ev.run_seq,
    }
    with ctx.conn.cursor() as cur:
        cur.execute(
            """SELECT count(*) n FROM processed_events
               WHERE run_id=%(run)s AND username=%(u)s AND ip_raw=%(ip)s AND route_family = ANY(%(login)s)
                 AND status=401 AND event_time >= %(t0)s AND event_time <= %(t)s AND run_seq < %(k)s""",
            params,
        )
        prior_count = int(one(cur)["n"])
    total = prior_count + 1
    if total < int(cfg["min_failures"]):
        return None
    rows, truncated = _fetch(
        ctx,
        """SELECT event_id, run_seq, event_time FROM processed_events
           WHERE run_id=%(run)s AND username=%(u)s AND ip_raw=%(ip)s AND route_family = ANY(%(login)s)
             AND status=401 AND event_time >= %(t0)s AND event_time <= %(t)s AND run_seq < %(k)s ORDER BY run_seq""",
        params,
        limit=int(ctx.cfg.policy["correlation"]["max_packet_events"]),
    )
    legs = [_leg(r, "prior_failure") for r in rows] + [{"role": "current_failure", **ev.evidence_ref()}]
    return RuleMatch(
        rule_id="R6",
        outcome=cfg["outcome"],
        key_type="pair",
        key_value=ev.pair_key,
        legs=legs,
        params={
            "window_seconds": cfg["window_seconds"],
            "min_failures": cfg["min_failures"],
            "failures_in_window": total,
            "familiarity": familiarity,
            "reference_hash": ctx.ref.hash,
        },
        incomplete=truncated,
    )


def rule_r2_access_change(ctx: RuleContext) -> RuleMatch | None:
    ev, cfg = ctx.ev, ctx.cfg.policy["rules"]["R2"]
    if not (ev.method == "GET" and ev.status == 200 and ctx.cfg.routes.is_sensitive(ev.path)):
        return None
    ap = ctx.stats.get("account_path", ev.account_path_key)
    denials, successes = int(ap["get403"]), int(ap["get200"])
    if denials < int(cfg["min_prior_denials"]) or successes > int(cfg["max_prior_successes"]):
        return None
    # Counter is authoritative; the listing is bounded display evidence and is recounted independently in SQL.
    rows, truncated = _fetch(
        ctx,
        """SELECT event_id, run_seq, event_time FROM processed_events
           WHERE run_id=%(run)s AND username=%(u)s AND path=%(p)s AND method='GET' AND status=403 AND run_seq < %(k)s
           ORDER BY run_seq""",
        {"run": ctx.run_id, "u": ev.username, "p": ev.path, "k": ev.run_seq},
        limit=int(ctx.cfg.policy["correlation"]["max_packet_events"]),
    )
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT count(*) n FROM processed_events WHERE run_id=%s AND username=%s AND path=%s AND method='GET' AND status=403 AND run_seq < %s",
            (ctx.run_id, ev.username, ev.path, ev.run_seq),
        )
        recount = int(one(cur)["n"])
    legs = [_leg(r, "prior_denial") for r in rows] + [{"role": "current_success", **ev.evidence_ref()}]
    return RuleMatch(
        rule_id="R2",
        outcome=cfg["outcome"],
        key_type="account_resource",
        key_value=ev.account_path_key,
        legs=legs,
        params={"min_prior_denials": cfg["min_prior_denials"], "prior_denials": denials, "prior_denials_sql_recount": recount,
                "prior_successes": successes, "listing_truncated": truncated},
        incomplete=(recount != denials),
    )


def rule_r3_admin_transition(ctx: RuleContext) -> RuleMatch | None:
    ev, cfg = ctx.ev, ctx.cfg.policy["rules"]["R3"]
    routes = ctx.cfg.routes
    if not (ev.method == "POST" and ev.is_2xx and routes.in_category(ev.route_family, "admin_families")):
        return None
    ap = ctx.stats.get("account_path", ev.account_path_key)
    if int(ap["post2xx"]) > 0:
        return None
    rows, _ = _fetch(
        ctx,
        """SELECT event_id, run_seq, event_time, object_id FROM processed_events
           WHERE run_id=%(run)s AND username=%(u)s AND route_family = ANY(%(fam)s) AND object_id IS NOT NULL
             AND event_time >= %(t0)s AND event_time <= %(t)s AND run_seq < %(k)s ORDER BY run_seq DESC""",
        {"run": ctx.run_id, "u": ev.username, "fam": sorted(routes.categories["forum_object_view_families"]),
         "t0": ev.event_time - timedelta(seconds=int(cfg["forum_view_window_seconds"])), "t": ev.event_time, "k": ev.run_seq},
        limit=20,
    )
    if not rows:
        return None
    view = rows[0]
    legs = [{**_leg(view, "forum_object_view"), "object_id": view["object_id"]}, {"role": "admin_request", **ev.evidence_ref()}]
    return RuleMatch(
        rule_id="R3",
        outcome=cfg["outcome"],
        key_type="account_resource",
        key_value=ev.account_path_key,
        legs=legs,
        params={"forum_view_window_seconds": cfg["forum_view_window_seconds"], "object_id": view["object_id"],
                "prior_post_2xx_on_endpoint": int(ap["post2xx"]),
                "seconds_after_view": (ev.event_time - view["event_time"]).total_seconds()},
        links=[{"link_type": "forum_object", "link_key": view["object_id"]}],
    )


def rule_r4_account_use_sequence(ctx: RuleContext) -> RuleMatch | None:
    ev, cfg = ctx.ev, ctx.cfg.policy["rules"]["R4"]
    routes = ctx.cfg.routes
    if not (ev.method == "GET" and ev.status == 200 and routes.is_sensitive(ev.path)):
        return None
    if ctx.ref.familiarity(ev.username, ev.ip_raw) != "unfamiliar":
        return None
    login_rows, _ = _fetch(
        ctx,
        """SELECT event_id, run_seq, event_time FROM processed_events
           WHERE run_id=%(run)s AND username=%(u)s AND ip_raw=%(ip)s AND route_family = ANY(%(login)s) AND status=200
             AND event_time >= %(t0)s AND event_time <= %(t)s AND run_seq < %(k)s ORDER BY run_seq DESC""",
        {"run": ctx.run_id, "u": ev.username, "ip": ev.ip_raw, "login": sorted(routes.categories["login_families"]),
         "t0": ev.event_time - timedelta(seconds=int(cfg["login_window_seconds"])), "t": ev.event_time, "k": ev.run_seq},
        limit=5,
    )
    if not login_rows:
        return None
    with ctx.conn.cursor() as cur:
        cur.execute(
            """SELECT run_seq, rule_id, event_id, event_time, incident_id FROM rule_matches
               WHERE run_id=%s AND rule_id = ANY(%s) AND key_type='pair' AND key_value=%s
                 AND event_time >= %s AND event_time <= %s AND run_seq < %s ORDER BY run_seq DESC LIMIT 5""",
            (ctx.run_id, ["R1", "R6"], ev.pair_key, ev.event_time - timedelta(seconds=int(cfg["auth_episode_window_seconds"])), ev.event_time, ev.run_seq),
        )
        r1 = [dict(r) for r in cur.fetchall()]
    if not r1:
        return None
    login = login_rows[0]
    legs = [
        {**_leg(r1[0], "auth_episode_match"), "incident_id": r1[0]["incident_id"], "rule_id": r1[0]["rule_id"]},
        _leg(login, "successful_login"),
        {"role": "sensitive_success", **ev.evidence_ref()},
    ]
    return RuleMatch(
        rule_id="R4",
        outcome=cfg["outcome"],
        key_type="pair",
        key_value=ev.pair_key,
        legs=legs,
        params={"login_window_seconds": cfg["login_window_seconds"], "auth_episode_window_seconds": cfg["auth_episode_window_seconds"],
                "seconds_since_login": (ev.event_time - login["event_time"]).total_seconds(),
                "seconds_since_auth_episode": (ev.event_time - r1[0]["event_time"]).total_seconds(), "familiarity": "unfamiliar",
                "auth_episode_rule": r1[0]["rule_id"], "auth_episode_incident_id": r1[0]["incident_id"]},
        links=[{"link_type": "pair", "link_key": ev.pair_key, "incident_id": r1[0]["incident_id"]}],
    )


def rule_r5_linked_access_change(ctx: RuleContext) -> RuleMatch | None:
    """R2 fired for account A on this event; within the preceding window another account B viewed object O and then
    satisfied R3; A also viewed O within the window before B's view."""
    if ctx.r2_match is None:
        return None
    ev, cfg = ctx.ev, ctx.cfg.policy["rules"]["R5"]
    window = timedelta(seconds=int(cfg["window_seconds"]))
    with ctx.conn.cursor() as cur:
        cur.execute(
            """SELECT run_seq, event_id, event_time, key_value, legs, params, incident_id FROM rule_matches
               WHERE run_id=%s AND rule_id='R3' AND event_time >= %s AND event_time <= %s AND run_seq < %s
               ORDER BY run_seq DESC LIMIT 20""",
            (ctx.run_id, ev.event_time - window, ev.event_time, ev.run_seq),
        )
        r3s = [dict(r) for r in cur.fetchall()]
    for r3 in r3s:
        b_account = r3["key_value"].split("|", 1)[0]
        if b_account == ev.username:
            continue
        obj = r3["params"].get("object_id")
        view_leg = next((leg for leg in r3["legs"] if leg["role"] == "forum_object_view"), None)
        if not obj or not view_leg:
            continue
        from datetime import datetime

        b_view_time = datetime.fromisoformat(view_leg["event_time"])
        with ctx.conn.cursor() as cur:
            cur.execute(
                """SELECT event_id, run_seq, event_time FROM processed_events
                   WHERE run_id=%s AND username=%s AND object_id=%s AND route_family = ANY(%s)
                     AND event_time >= %s AND event_time <= %s AND run_seq < %s ORDER BY run_seq DESC LIMIT 5""",
                (ctx.run_id, ev.username, obj, sorted(ctx.cfg.routes.categories["forum_object_view_families"]),
                 b_view_time - window, b_view_time, ev.run_seq),
            )
            a_views = [dict(r) for r in cur.fetchall()]
        if not a_views:
            continue
        legs = [
            *[{**leg, "role": "linked_r2_" + leg["role"]} for leg in ctx.r2_match.legs if leg["role"] == "current_success"],
            {**_leg(a_views[0], "a_viewed_object"), "object_id": obj, "account": ev.username},
            {**view_leg, "role": "b_viewed_object", "object_id": obj, "account": b_account},
            {**_leg(r3, "b_admin_request_r3"), "incident_id": r3["incident_id"], "account": b_account},
        ]
        return RuleMatch(
            rule_id="R5",
            outcome=cfg["outcome"],
            key_type="account_resource",
            key_value=ev.account_path_key,
            legs=legs,
            params={"window_seconds": cfg["window_seconds"], "object_id": obj, "other_account_role": "viewer_then_admin_request",
                    "r3_incident_id": r3["incident_id"], "asserts_object_creator": False, "asserts_role_changed": False},
            links=[{"link_type": "forum_object", "link_key": obj, "incident_id": r3["incident_id"]}],
        )
    return None


def evaluate_rules(ctx: RuleContext) -> list[RuleMatch]:
    matches: list[RuleMatch] = []
    for fn in (rule_r1_auth_burst, rule_r6_slow_auth_burst, rule_r2_access_change, rule_r3_admin_transition, rule_r4_account_use_sequence):
        m = fn(ctx)
        if m:
            matches.append(m)
            if m.rule_id == "R2":
                ctx.r2_match = m
    m5 = rule_r5_linked_access_change(ctx)
    if m5:
        matches.append(m5)
    return matches
