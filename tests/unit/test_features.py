"""Feature vector contract: ordered schema, smoothing, causality of inputs, no identity encoding."""
import math
from datetime import UTC, datetime

from app.config import load_config
from app.features.events import Event
from app.features.history import WindowCounts, _account_default, _account_path_default, _pair_default
from app.features.reference import Reference
from app.features.vector import FEATURE_NAMES, compute_features

CFG = load_config()


def _ev(**kw):
    base = dict(
        run_seq=10, event_id="e", event_time=datetime(2026, 3, 15, 15, 26, 59, tzinfo=UTC), phase="visible",
        username="acct_a", ip_raw="10.0.0.1", method="GET", path="/finance/reports/q1_draft_CONFIDENTIAL.zip",
        raw_target="/finance/reports/q1_draft_CONFIDENTIAL.zip", query_keys=(), route_family="document", object_id=None,
        status=200, response_bytes=8459200, offset_minutes=-240, line_number=1, raw_line="",
    )
    base.update(kw)
    return Event(**base)


def _ref(familiar=None):
    r = Reference.empty()
    r.familiar_pairs = familiar or {"acct_a": ["10.0.0.1"]}
    r.accounts_with_support = sorted(r.familiar_pairs)
    r.family_query_keys = {"forum_new": ["topic"]}
    r.bytes_median_log1p = {"document|200": math.log1p(8459200)}
    return r


def test_vector_length_matches_schema_and_has_no_nan():
    fr = compute_features(_ev(), WindowCounts(), _account_default(), _pair_default(), _account_path_default(), _ref(), CFG)
    assert len(fr.vector) == len(FEATURE_NAMES) == 30
    assert all(not math.isnan(v) for v in fr.vector)


def test_cold_start_and_unknown_reference_flags():
    ref = _ref(familiar={"other": ["1.1.1.1"]})
    fr = compute_features(_ev(), WindowCounts(), _account_default(), _pair_default(), _account_path_default(), ref, CFG)
    f = dict(zip(FEATURE_NAMES, fr.vector, strict=True))
    assert f["reference_unknown"] == 1.0 and f["pair_unfamiliar"] == 0.0
    assert f["cold_start"] == 1.0
    assert fr.observed["familiarity"] == "reference_unknown"


def test_unfamiliar_pair_flag_and_rarity_use_prior_counts_only():
    acct = _account_default()
    acct["n"] = 1000
    acct["ips"] = {"10.0.0.1": 1000}
    pair = _pair_default()  # never seen this pair before → count 0
    fr = compute_features(_ev(ip_raw="10.0.0.99"), WindowCounts(), acct, pair, _account_path_default(), _ref(), CFG)
    f = dict(zip(FEATURE_NAMES, fr.vector, strict=True))
    assert f["pair_unfamiliar"] == 1.0
    assert f["pair_rarity"] == -math.log(1 / (1000 + 1 + 1))
    assert f["cold_start"] == 0.0


def test_first_200_after_denials_uses_prior_counters():
    ap = _account_path_default()
    ap["get403"] = 77
    fr = compute_features(_ev(), WindowCounts(), _account_default(), _pair_default(), ap, _ref(), CFG)
    f = dict(zip(FEATURE_NAMES, fr.vector, strict=True))
    assert f["first_200_after_denials"] == 1.0
    assert f["acct_path_denials_log1p"] == math.log1p(77)
    ap["get200"] = 1
    fr2 = compute_features(_ev(), WindowCounts(), _account_default(), _pair_default(), ap, _ref(), CFG)
    assert dict(zip(FEATURE_NAMES, fr2.vector, strict=True))["first_200_after_denials"] == 0.0


def test_bytes_delta_relative_to_bootstrap_median_and_missing_indicator():
    fr = compute_features(_ev(), WindowCounts(), _account_default(), _pair_default(), _account_path_default(), _ref(), CFG)
    f = dict(zip(FEATURE_NAMES, fr.vector, strict=True))
    assert abs(f["bytes_delta_vs_bootstrap"]) < 1e-9 and f["bytes_reference_missing"] == 0.0
    fr2 = compute_features(_ev(status=302), WindowCounts(), _account_default(), _pair_default(), _account_path_default(), _ref(), CFG)
    f2 = dict(zip(FEATURE_NAMES, fr2.vector, strict=True))
    assert f2["bytes_reference_missing"] == 1.0 and f2["bytes_delta_vs_bootstrap"] == 0.0


def test_unusual_query_keys_count_relative_to_bootstrap_family_keys():
    ev = _ev(path="/intranet/forum/new", route_family="forum_new", method="POST", status=302, query_keys=("topic", "script"))
    fr = compute_features(ev, WindowCounts(), _account_default(), _pair_default(), _account_path_default(), _ref(), CFG)
    f = dict(zip(FEATURE_NAMES, fr.vector, strict=True))
    assert f["unusual_query_key_count"] == 1.0
    assert fr.observed["unusual_query_keys"] == ["script"]


def test_local_hour_uses_recorded_offset_not_utc():
    fr = compute_features(_ev(), WindowCounts(), _account_default(), _pair_default(), _account_path_default(), _ref(), CFG)
    assert fr.observed["local_hour"] == 11  # 15:26Z at -04:00


def test_no_identity_features_present():
    assert not any(n in ("username", "ip", "ip_raw", "account_id") for n in FEATURE_NAMES)
