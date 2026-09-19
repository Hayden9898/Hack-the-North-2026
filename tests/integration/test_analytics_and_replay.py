"""A01/A02 (aggregate freshness and pinned views) and M4 replay controls (pause drains bounded work; virtual clock)."""
from __future__ import annotations

import time
from datetime import UTC, date, datetime, timedelta

import pytest
from tests.fixtures.synth import TZ, baseline_traffic, default_world, scenario_auth_burst
from tests.helpers import drive, import_world, make_config, q, start_run

from app.db.engine import connect_direct
from app.incidents import analytics
from app.workers import runs as runs_mod
from app.workers.detector import Detector

pytestmark = pytest.mark.integration
D0 = date(2025, 1, 6)


def _cfg(tmp_path, **over):
    return make_config(tmp_path, bootstrap=(D0, D0 + timedelta(days=10)), train=(D0 + timedelta(days=10), D0 + timedelta(days=16)),
                       calibration=(D0 + timedelta(days=16), D0 + timedelta(days=22)), evaluation=(D0 + timedelta(days=22), D0 + timedelta(days=40)), policy_overrides=over)


def _world(days=26):
    w = default_world(start=datetime(D0.year, D0.month, D0.day, tzinfo=TZ))
    baseline_traffic(w, days)
    scenario_auth_burst(w, datetime(D0.year, D0.month, D0.day, tzinfo=TZ) + timedelta(days=23, hours=23), victim=w.accounts[0], source_ip="192.168.10.200", n=4)
    return w


def _raw_grouped(db, rid, cut=None):
    extra = f" and run_seq <= {int(cut)}" if cut is not None else ""
    return q(db, f"""select time_bucket('5 minutes', event_time) b, username a, count(*) n, count(*) filter (where status=401) c401,
                     count(*) filter (where threat_class='suspicious') s from processed_events where run_id=%s{extra} group by 1,2 order by 1,2""", rid)


def test_a01_a02_aggregate_matches_raw_and_pinned_views_never_leak(db, tmp_path):
    cfg = _cfg(tmp_path)
    w = _world()
    ds = import_world(w, tmp_path, db)
    rid = start_run(db, cfg, ds)
    run = drive(db, cfg, rid)
    assert run["state"] == "completed"
    # Before any refresh: the endpoint logic falls back to raw and says so (A01).
    with connect_direct(db) as conn:
        out = analytics.timeseries(conn, rid)
    assert out["source"]["mode"] == "raw_fallback" and out["source"]["stale"] is True
    raw = _raw_grouped(db, rid)
    assert len(out["rows"]) == len(raw)

    res = analytics.refresh_run(db, rid)
    assert res["refreshed"] and res["buckets"] > 0
    with connect_direct(db) as conn:
        out2 = analytics.timeseries(conn, rid)
        bench = analytics.compare_raw_vs_aggregate(conn, rid, repeats=2)
    assert out2["source"]["mode"] == "aggregate_plus_raw_tail" and out2["source"]["materialized_buckets"] > 0
    assert bench["identical_results"] is True and bench["rows"] > 0
    # Aggregate + tail equals raw GROUP BY exactly (events, 401s, suspicious).
    got = [(r["bucket"], r["account"], r["events"], r["c401"], r["suspicious"]) for r in out2["rows"]]
    exp = [(r["b"], r["a"], r["n"], r["c401"], r["s"]) for r in raw]
    assert got == exp
    assert sum(r["suspicious"] for r in out2["rows"]) == 1

    # A02: a pinned view at an earlier cutoff uses raw records only and excludes later-processed events even though
    # the aggregate already contains them.
    cut = run["processed_seq"] // 2
    with connect_direct(db) as conn:
        pinned = analytics.timeseries(conn, rid, as_of_seq=cut)
    assert pinned["source"]["mode"] == "raw_as_of"
    exp_cut = _raw_grouped(db, rid, cut)
    assert [(r["bucket"], r["account"], r["events"]) for r in pinned["rows"]] == [(r["b"], r["a"], r["n"]) for r in exp_cut]
    assert sum(r["events"] for r in pinned["rows"]) < sum(r["events"] for r in out2["rows"])
    # Second run on the same dataset is isolated in the aggregate too.
    rid2 = start_run(db, cfg, ds)
    drive(db, cfg, rid2)
    analytics.refresh_run(db, rid2)
    assert q(db, "select count(*) n from processed_events_5m where run_id=%s", rid)[0]["n"] == res["buckets"]
    assert q(db, "select count(distinct run_id) n from processed_events_5m")[0]["n"] == 2


def test_pause_drains_only_bounded_admitted_work_then_resume_completes(db, tmp_path):
    cfg = _cfg(tmp_path, **{"replay.queue_cap": 150, "replay.microbatch": 50})
    w = _world(days=24)
    ds = import_world(w, tmp_path, db)
    rid = start_run(db, cfg, ds)
    det = Detector(db, cfg)
    conn = connect_direct(db)
    # A few steps into warmup, pause. Admission must stop; processing drains at most the queue cap.
    for _ in range(3):
        det.step(conn, rid)
    runs_mod.control(conn, rid, "pause")
    conn.commit()
    paused = runs_mod.get_run(conn, rid)
    conn.commit()
    admitted_at_pause = int(paused["admitted_seq"])
    assert admitted_at_pause - int(paused["processed_seq"]) <= 150
    for _ in range(20):
        det.step(conn, rid)
    after = runs_mod.get_run(conn, rid)
    conn.commit()
    assert after["state"] == "paused"
    assert int(after["admitted_seq"]) == admitted_at_pause  # no new admission while paused
    assert int(after["processed_seq"]) == admitted_at_pause  # backlog fully drained
    total = q(db, "select count(*) n from event_registry")[0]["n"]
    assert int(after["processed_seq"]) < total
    runs_mod.control(conn, rid, "resume")
    conn.commit()
    conn.close()
    final = drive(db, cfg, rid)
    assert final["state"] == "completed" and final["processed_seq"] == total
    assert q(db, "select count(*) n from run_events where run_id=%s and processing_state<>'processed'", rid)[0]["n"] == 0


def test_virtual_clock_gates_visible_admission_by_speed(db, tmp_path):
    cfg = _cfg(tmp_path)
    w = _world(days=24)
    ds = import_world(w, tmp_path, db)
    # speed 36000: one wall second == ten virtual hours (synthetic traffic starts at 08:00 local). Pause at the boundary first.
    rid = start_run(db, cfg, ds, speed=36000.0, pause_at_visible_start=True)
    st = drive(db, cfg, rid)
    assert st["state"] == "paused" and st["phase"] == "visible"
    vis_start = st["visible_start"]
    warm_processed = st["processed_seq"]
    with connect_direct(db) as conn:
        runs_mod.control(conn, rid, "resume")
        conn.commit()
        det = Detector(db, cfg)
        time.sleep(1.0)  # ~10 virtual hours
        for _ in range(10):
            det.step(conn, rid)
        run = runs_mod.get_run(conn, rid)
        conn.commit()
        vt = runs_mod.current_virtual_time(run, datetime.now(UTC))
    assert run["state"] == "running" and vt is not None
    assert vis_start + timedelta(hours=8) <= vt <= vis_start + timedelta(hours=60)  # steps take wall time too
    newest = q(db, "select max(event_time) m from processed_events where run_id=%s", rid)[0]["m"]
    assert newest <= vt  # nothing admitted beyond the virtual clock
    assert run["processed_seq"] > warm_processed  # but visible-phase events did flow
    later = q(db, "select count(*) n from event_registry where event_time > %s", vt)[0]["n"]
    assert later > 0  # future rows exist in storage yet are absent from the run
    assert q(db, "select count(*) n from processed_events where run_id=%s and event_time > %s", rid, vt)[0]["n"] == 0
