"""Synthetic access-log generator for scenario tests. Entity names, IPs, dates and object ids are parameters so the
same scenarios can be re-run with renamed/shifted entities (acceptance R07). Nothing here is used by the detector."""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

TZ = timezone(timedelta(hours=-4))


@dataclass
class World:
    accounts: list[str]
    ips: dict[str, str]  # account -> home ip
    documents: dict[str, list[str]]  # path -> audience accounts (others get 403)
    sensitive_paths: list[str]
    forum_objects: list[str]
    start: datetime  # local midnight of day 0
    seed: int = 7
    lines: list[tuple[datetime, str]] = field(default_factory=list)

    def emit(self, t: datetime, ip: str, user: str, method: str, target: str, status: int, size: int | str) -> None:
        ts = t.astimezone(TZ).strftime("%d/%b/%Y:%H:%M:%S %z")
        self.lines.append((t, f'{ip} - {user} [{ts}] "{method} {target} HTTP/1.1" {status} {size}'))

    def render(self) -> str:
        # Stable order by (time, insertion index) - matches the detector's admission order semantics.
        indexed = sorted(enumerate(self.lines), key=lambda x: (x[1][0], x[0]))
        return "\n".join(line for _, (_, line) in indexed) + "\n"


def default_world(start: datetime | None = None, prefix: str = "acct", ip_base: str = "192.168.10", seed: int = 7) -> World:
    accounts = [f"{prefix}_{i}" for i in range(1, 7)]
    ips = {a: f"{ip_base}.{10 + i}" for i, a in enumerate(accounts)}
    docs = {
        "/finance/reports/plan_CONFIDENTIAL.zip": accounts[0:2],
        "/hr/roster_CONFIDENTIAL.csv": accounts[2:3],
        "/eng/design.pdf": accounts,  # public-ish
        "/sales/pipeline.xlsx": accounts[3:5],
    }
    return World(
        accounts=accounts,
        ips=ips,
        documents=docs,
        sensitive_paths=[p for p in docs if "CONFIDENTIAL" in p],
        forum_objects=[str(2000 + i) for i in range(12)],
        start=(start or datetime(2025, 1, 6, 0, 0, tzinfo=TZ)),
        seed=seed,
    )


def baseline_traffic(w: World, days: int, events_per_day: int = 120) -> None:
    """Routine business-hours traffic: logins (mostly 200, isolated 401s), assets, dashboard, documents, forum."""
    rng = random.Random(w.seed)
    for d in range(days):
        day = w.start + timedelta(days=d)
        for a in w.accounts:
            ip = w.ips[a]
            t = day + timedelta(hours=8, minutes=rng.randint(0, 30))
            w.emit(t, ip, a, "POST", "/api/auth/login", 200, 128)
            t += timedelta(seconds=2)
            w.emit(t, ip, a, "GET", "/dashboard", 200, 2048)
        for _ in range(events_per_day):
            a = rng.choice(w.accounts)
            ip = w.ips[a]
            t = day + timedelta(hours=8, minutes=rng.randint(30, 600), seconds=rng.randint(0, 59))
            kind = rng.random()
            if kind < 0.25:
                w.emit(t, ip, a, "GET", "/assets/app.js", 200, 4582)
            elif kind < 0.45:
                path = rng.choice(list(w.documents))
                ok = a in w.documents[path]
                w.emit(t, ip, a, "GET", path, 200 if ok else 403, 5120 if ok else 0)
            elif kind < 0.65:
                obj = rng.choice(w.forum_objects)
                w.emit(t, ip, a, "GET", f"/intranet/forum/view/{obj}", 200, 3105)
            elif kind < 0.72:
                obj = rng.choice(w.forum_objects)
                w.emit(t, ip, a, "POST", f"/intranet/forum/edit/{obj}", 302, 112)
            elif kind < 0.78:
                w.emit(t, ip, a, "POST", "/intranet/forum/new?topic=weekly", 302, 112)
            elif kind < 0.83:
                # isolated login failure followed by success (routine typo)
                w.emit(t, ip, a, "POST", "/api/auth/login", 401, 88)
                w.emit(t + timedelta(seconds=7), ip, a, "POST", "/api/auth/login", 200, 128)
            elif kind < 0.9:
                w.emit(t, ip, a, "GET", "/api/notifications/poll", 200, 42)
            else:
                w.emit(t, ip, a, "GET", "/logout", 302, 0)


def scenario_auth_burst(w: World, t: datetime, victim: str, source_ip: str, n: int = 4, spacing: int = 4) -> list[datetime]:
    times = []
    for i in range(n):
        ti = t + timedelta(seconds=i * spacing)
        w.emit(ti, source_ip, victim, "POST", "/api/auth/login", 401, 88)
        times.append(ti)
    return times


def scenario_access_change(w: World, t: datetime, actor: str, path: str, denials: int = 6) -> datetime:
    """`denials` 403s spread over the preceding days, then a 200 at t."""
    ip = w.ips[actor]
    for i in range(denials):
        w.emit(t - timedelta(days=denials - i, hours=1), ip, actor, "GET", path, 403, 0)
    w.emit(t, ip, actor, "GET", path, 200, 8459200)
    return t


def scenario_forum_admin(w: World, t: datetime, viewer: str, obj: str) -> datetime:
    ip = w.ips[viewer]
    w.emit(t, ip, viewer, "GET", f"/intranet/forum/view/{obj}", 200, 3105)
    w.emit(t + timedelta(seconds=1), ip, viewer, "POST", "/api/admin/role_update", 200, 85)
    return t + timedelta(seconds=1)


def scenario_linked_sequence(w: World, day: datetime, actor: str, victim: str, obj: str, path: str) -> dict[str, datetime]:
    """Full analogue of the known sequence with generic entities."""
    src = w.ips[actor]
    t_burst1 = day - timedelta(days=2) + timedelta(hours=23, minutes=10)
    scenario_auth_burst(w, t_burst1, victim, src, n=4)
    t_burst2 = day - timedelta(days=1) + timedelta(hours=22, minutes=11)
    scenario_auth_burst(w, t_burst2, victim, src, n=6)
    t_post = day + timedelta(hours=9, minutes=20)
    w.emit(t_post, src, actor, "POST", "/intranet/forum/new?topic=lunch&payload=test", 500, 1024)
    w.emit(t_post + timedelta(minutes=58, seconds=32), src, actor, "POST", "/intranet/forum/new?topic=parking&script=success", 302, 112)
    w.emit(t_post + timedelta(minutes=58, seconds=35), src, actor, "GET", f"/intranet/forum/view/{obj}", 200, 3105)
    t_view = day + timedelta(hours=11, minutes=7, seconds=56)
    scenario_forum_admin(w, t_view, victim, obj)
    w.emit(t_view + timedelta(seconds=3), w.ips[victim], victim, "GET", f"/assets/avatar_{obj}.png", 200, 1205)
    t_zip = day + timedelta(hours=11, minutes=26, seconds=59)
    for i in range(7):
        w.emit(day - timedelta(days=20 - i * 2, hours=3), src, actor, "GET", path, 403, 0)
    w.emit(t_zip, src, actor, "GET", path, 200, 8459200)
    w.emit(t_zip + timedelta(minutes=21), src, actor, "POST", f"/intranet/forum/edit/{obj}", 302, 112)
    t_login = day + timedelta(hours=22, minutes=29, seconds=43)
    w.emit(t_login, src, victim, "POST", "/api/auth/login", 200, 128)
    w.emit(t_login + timedelta(seconds=2), src, victim, "GET", "/dashboard", 200, 2048)
    t_victim_zip = t_login + timedelta(seconds=57)
    w.emit(t_victim_zip, src, victim, "GET", path, 200, 8459200)
    w.emit(t_victim_zip + timedelta(minutes=3), src, victim, "GET", "/logout", 302, 0)
    return {"burst1": t_burst1, "burst2": t_burst2, "admin": t_view + timedelta(seconds=1), "zip": t_zip, "login": t_login, "victim_zip": t_victim_zip}
