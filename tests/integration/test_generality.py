"""R07: renamed accounts/IPs, shifted dates and different object ids produce the same generic detections after a
coherent bootstrap regeneration — the engine encodes no dataset literals."""
from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest

from tests.fixtures.synth import TZ, baseline_traffic, default_world, scenario_linked_sequence
from tests.helpers import drive, import_world, make_config, q, start_run

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    ("d0", "prefix", "ip_base", "obj_index", "seed"),
    [
        (date(2025, 1, 6), "acct", "192.168.10", 5, 7),
        (date(2027, 6, 14), "zeta", "172.31.200", 9, 99),  # different year/month, names, /24, object id, traffic seed
    ],
)
def test_r07_same_generic_detections_after_renaming_and_shifting(db, tmp_path, d0, prefix, ip_base, obj_index, seed):
    cfg = make_config(tmp_path, bootstrap=(d0, d0 + timedelta(days=10)), train=(d0 + timedelta(days=10), d0 + timedelta(days=16)),
                      calibration=(d0 + timedelta(days=16), d0 + timedelta(days=22)), evaluation=(d0 + timedelta(days=22), d0 + timedelta(days=40)))
    w = default_world(start=datetime(d0.year, d0.month, d0.day, tzinfo=TZ), prefix=prefix, ip_base=ip_base, seed=seed)
    baseline_traffic(w, 30)
    actor, victim, obj, path = w.accounts[3], w.accounts[1], w.forum_objects[obj_index], w.sensitive_paths[0]
    scenario_linked_sequence(w, datetime(d0.year, d0.month, d0.day, tzinfo=TZ) + timedelta(days=26), actor, victim, obj, path)
    ds = import_world(w, tmp_path, db, name=f"{prefix}.log")
    rid = start_run(db, cfg, ds)
    run = drive(db, cfg, rid)
    assert run["state"] == "completed"
    rules = {r["rule_id"] for r in q(db, "select distinct rule_id from rule_matches where run_id=%s", rid)}
    assert rules == {"R1", "R2", "R3", "R4", "R5"}
    classes = {i["primary_rule_id"]: i["current_class"] for i in q(db, "select primary_rule_id, current_class from incidents where run_id=%s", rid)}
    assert classes == {"R1": "high_risk", "R2": "high_risk", "R3": "suspicious"}
    accounts = {i["account"] for i in q(db, "select account from incidents where run_id=%s", rid)}
    assert accounts == {actor, victim}
    # Nothing in the baseline traffic of renamed accounts trips a rule.
    assert q(db, "select count(*) n from rule_matches rm join processed_events p using (run_id, run_seq) where rm.run_id=%s and p.username not in (%s, %s)", rid, actor, victim)[0]["n"] == 0
