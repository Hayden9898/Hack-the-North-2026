"""Reproducible dataset investigation. Every number printed here is computed from the imported evidence tables
with explicit cutoffs; the output feeds reports/investigation.md. Nothing here is used by the detector."""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import timedelta
from typing import Any

from app.config import get_config
from app.db.engine import connect_direct
from app.settings import get_settings


def q(cur, sql: str, *args: Any) -> list[dict[str, Any]]:
    cur.execute(sql, args)
    return [dict(r) for r in cur.fetchall()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--database-url", default=None)
    ap.add_argument("--json", action="store_true", help="emit JSON only")
    args = ap.parse_args()
    cfg = get_config()
    tz = cfg.partitions.local_tz()
    out: dict[str, Any] = {}
    with connect_direct(args.database_url or get_settings().database_url) as conn, conn.cursor() as cur:
        ds = q(cur, "select id, content_sha256, total_lines, valid_count, rejected_count, first_event_time, last_event_time, stats from datasets order by created_at limit 1")
        if not ds:
            print("no dataset imported", file=sys.stderr)
            return 1
        d = ds[0]
        out["dataset"] = {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in d.items()}
        did = d["id"]
        base = "from raw_events r join event_registry e using (event_id) where e.dataset_id = %s"

        # 1. Unusual query keys anywhere in the dataset (relative to configured expected keys per family).
        rows = q(cur, f"select e.line_number, r.event_time, r.username, r.ip_raw, r.method, r.raw_target, r.status, r.route_family, r.query_keys {base} and cardinality(r.query_keys) > 0", did)
        unusual = []
        for r in rows:
            expected = cfg.routes.expected_query_keys.get(r["route_family"], frozenset())
            extra = [k for k in r["query_keys"] if k not in expected]
            if extra:
                unusual.append({**r, "unexpected_keys": extra})
        out["unusual_query_keys"] = unusual

        # 2. Non-2xx/3xx/401/403 statuses.
        out["rare_statuses"] = q(cur, f"select e.line_number, r.event_time, r.username, r.ip_raw, r.raw_target, r.status {base} and r.status not in (200,302,401,403) order by e.line_number", did)

        # 3. Account/IP pairs and per-pair login outcomes.
        out["pairs"] = q(cur, f"select r.username, r.ip_raw, count(*) n, min(r.event_time) first_seen, max(r.event_time) last_seen {base} group by 1,2 order by 1,3 desc", did)
        out["login_by_pair"] = q(cur, f"select r.username, r.ip_raw, r.status, count(*) n {base} and r.route_family='login' group by 1,2,3 order by 1,2,3", did)

        # 4. Admin endpoint usage.
        out["admin_requests"] = q(cur, f"select e.line_number, r.event_time, r.username, r.ip_raw, r.method, r.raw_target, r.status, r.response_bytes {base} and r.route_family='admin' order by e.line_number", did)

        # 5. Sensitive resources: for every (account, path) the first 200 after >=5 prior 403s, computed causally.
        sens_rows = q(cur, f"select e.line_number, r.event_time, r.username, r.path, r.status, r.response_bytes, r.method {base} and r.method='GET' and r.status in (200,403) order by r.event_time, e.line_number", did)
        denials: Counter = Counter()
        successes: Counter = Counter()
        access_changes = []
        for r in sens_rows:
            if not cfg.routes.is_sensitive(r["path"]):
                continue
            key = (r["username"], r["path"])
            if r["status"] == 403:
                denials[key] += 1
            else:
                if denials[key] >= 5 and successes[key] == 0:
                    access_changes.append({**r, "prior_denials": denials[key], "prior_successes": successes[key]})
                successes[key] += 1
        out["sensitive_first_success_after_denials"] = access_changes
        # Which accounts ever received 200 on each sensitive path; how many 403s each.
        out["sensitive_path_outcomes"] = [
            r for r in q(cur, f"select r.path, r.username, r.status, count(*) n {base} and r.method='GET' group by 1,2,3 order by 1,2,3", did) if cfg.routes.is_sensitive(r["path"])
        ]

        # 6. Failed-login bursts: >=4 401s for the same pair within 60s (causal, sliding window).
        logins = q(cur, f"select e.line_number, r.event_time, r.username, r.ip_raw, r.status {base} and r.route_family='login' order by r.event_time, e.line_number", did)
        window: dict[tuple[str, str], list[dict]] = defaultdict(list)
        bursts = []
        seen_burst_anchor: set[tuple[str, str, int]] = set()
        for r in logins:
            if r["status"] != 401:
                continue
            k = (r["username"], r["ip_raw"])
            w = [x for x in window[k] if r["event_time"] - x["event_time"] <= timedelta(seconds=60)]
            w.append(r)
            window[k] = w
            if len(w) >= 4:
                anchor = (k[0], k[1], w[0]["line_number"])
                if anchor not in seen_burst_anchor:
                    seen_burst_anchor.add(anchor)
                    bursts.append({"username": k[0], "ip_raw": k[1], "lines": [x["line_number"] for x in w], "start": w[0]["event_time"], "end": r["event_time"], "count_in_window": len(w)})
        out["failed_login_bursts_4_in_60s"] = bursts
        # Distribution of 401 run lengths per pair (consecutive 401s with no intervening 200 for the pair).
        run_len: Counter = Counter()
        cur_run: dict[tuple[str, str], int] = defaultdict(int)
        for r in logins:
            k = (r["username"], r["ip_raw"])
            if r["status"] == 401:
                cur_run[k] += 1
            else:
                if cur_run[k]:
                    run_len[cur_run[k]] += 1
                cur_run[k] = 0
        for v in cur_run.values():
            if v:
                run_len[v] += 1
        out["consecutive_401_run_lengths"] = dict(sorted(run_len.items()))

        # 7. Off-hours activity per account (local hour outside 07-20) and weekend share.
        # NB: AT TIME ZONE with a bare '-04:00' string uses POSIX sign semantics in PostgreSQL; an INTERVAL is ISO.
        out["hour_profile"] = q(cur, f"select r.username, extract(hour from r.event_time at time zone make_interval(mins => %s))::int as local_hour, count(*) n {base} group by 1,2 order by 1,2", cfg.partitions.utc_offset_minutes, did)

        # 8. Forum object 1042-style analysis is generic: for every forum object, which accounts viewed it within 60m
        #    before an admin POST by a different account, and who edited it after.
        forum = q(cur, f"select e.line_number, r.event_time, r.username, r.ip_raw, r.route_family, r.object_id, r.status {base} and r.route_family in ('forum_view','forum_edit','admin') order by r.event_time, e.line_number", did)
        admin_links = []
        for i, r in enumerate(forum):
            if r["route_family"] != "admin":
                continue
            before = [x for x in forum[:i] if x["username"] == r["username"] and x["route_family"] == "forum_view" and r["event_time"] - x["event_time"] <= timedelta(seconds=60)]
            for v in before:
                others = [x for x in forum[:i] if x["object_id"] == v["object_id"] and x["username"] != r["username"] and v["event_time"] - x["event_time"] <= timedelta(minutes=60) and x["event_time"] <= v["event_time"]]
                edits_after = [x for x in forum[i:] if x["object_id"] == v["object_id"] and x["route_family"] == "forum_edit"]
                admin_links.append({"admin_line": r["line_number"], "admin_account": r["username"], "object_id": v["object_id"], "view_line": v["line_number"], "other_viewers_60m_before": [(x["username"], x["line_number"]) for x in others], "edits_after": [(x["username"], x["line_number"]) for x in edits_after]})
        out["admin_after_forum_view"] = admin_links
        out["forum_edits"] = q(cur, f"select e.line_number, r.event_time, r.username, r.object_id, r.status {base} and r.route_family='forum_edit' order by e.line_number", did)

        # 9. Bytes: per (route_family,status) median for 200s; flag events beyond 10x median for their path.
        out["bytes_by_path"] = q(cur, f"select r.path, r.status, count(*) n, percentile_cont(0.5) within group (order by r.response_bytes) med, max(r.response_bytes) mx, min(r.response_bytes) mn {base} and r.status=200 group by 1,2 having count(*)>20 order by 1", did)

        # 10. Sarah/unfamiliar-pair generic view: for every pair with < 1% of the account's events, list its events.
        rare_pairs = [p for p in out["pairs"] if p["n"] < 0.01 * sum(x["n"] for x in out["pairs"] if x["username"] == p["username"])]
        out["rare_pair_events"] = {}
        for p in rare_pairs:
            out["rare_pair_events"][f"{p['username']}@{p['ip_raw']}"] = q(cur, f"select e.line_number, r.event_time, r.method, r.raw_target, r.status, r.response_bytes {base} and r.username=%s and r.ip_raw=%s order by e.line_number", did, p["username"], p["ip_raw"])

        # 11. Exact denial count for each access-change candidate at its cutoff (independent recount via SQL).
        for ac in out["sensitive_first_success_after_denials"]:
            n = q(cur, f"select count(*) n {base} and r.username=%s and r.path=%s and r.status=403 and (r.event_time, e.line_number) < (%s, %s)", did, ac["username"], ac["path"], ac["event_time"], ac["line_number"])[0]["n"]
            ac["prior_denials_sql_recount"] = n
        conn.rollback()

    def default(o: Any) -> Any:
        if hasattr(o, "isoformat"):
            return o.astimezone(tz).isoformat() if getattr(o, "tzinfo", None) else o.isoformat()
        return str(o)

    print(json.dumps(out, indent=1, default=default))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
