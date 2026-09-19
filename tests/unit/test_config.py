from datetime import datetime, timezone

import pytest

from app.config import canonical_hash, load_config, parse_partitions


def test_routes_classify_families_and_object_ids():
    cfg = load_config()
    r = cfg.routes
    assert r.classify("/api/auth/login") == ("login", None)
    assert r.classify("/intranet/forum/view/1042") == ("forum_view", "1042")
    assert r.classify("/intranet/forum/edit/7") == ("forum_edit", "7")
    assert r.classify("/api/admin/role_update") == ("admin", None)
    assert r.classify("/finance/reports/q1_draft_CONFIDENTIAL.zip") == ("document", None)
    assert r.classify("/assets/avatar_1042.png") == ("assets", None)
    assert r.classify("/something/unknown")[0] == "other"


def test_sensitive_flag_is_heuristic_config_not_hardcoded():
    cfg = load_config()
    assert cfg.routes.is_sensitive("/finance/reports/q1_draft_CONFIDENTIAL.zip")
    assert cfg.routes.is_sensitive("/hr/directory_full_confidential.csv")
    assert cfg.routes.is_sensitive("/it/scripts/backup.sh")
    assert not cfg.routes.is_sensitive("/finance/reports/public_summary.pdf")


def test_partitions_are_chronological_and_utc_converted():
    cfg = load_config()
    p = cfg.partitions
    assert p["bootstrap"].end_exclusive == p["train"].start
    assert p["train"].end_exclusive == p["calibration"].start
    assert p["calibration"].end_exclusive == p["evaluation"].start
    # 2026-03-01 00:00 at -04:00 is 04:00 UTC
    assert p["evaluation"].start == datetime(2026, 3, 1, 4, 0, tzinfo=timezone.utc)


def test_overlapping_partitions_rejected():
    doc = {
        "version": 1,
        "utc_offset_minutes": -240,
        "partitions": {
            "bootstrap": {"start": "2025-08-01", "end_exclusive": "2025-10-01"},
            "train": {"start": "2025-09-01", "end_exclusive": "2026-01-01"},
        },
    }
    with pytest.raises(ValueError):
        parse_partitions(doc)


def test_config_hash_is_stable_and_order_independent():
    assert canonical_hash({"a": 1, "b": 2}) == canonical_hash({"b": 2, "a": 1})
    assert canonical_hash({"a": 1}) != canonical_hash({"a": 2})
    assert len(load_config().config_hash) == 64
