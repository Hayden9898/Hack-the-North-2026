"""Feature vector v1: one ordered schema shared by training and inference (architecture.md §6).

Pure function of (current event, prior history, frozen reference, policy). No account/IP identity encoding, no URL
text embedding, no NaN (smoothing + explicit missing indicators).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from app.config import DetectionConfig
from app.features.events import Event
from app.features.history import WindowCounts
from app.features.reference import Reference

FEATURE_VERSION = "v1"

FEATURE_NAMES: tuple[str, ...] = (
    # recent volume
    "acct_req_5m_log1p",
    "ip_req_5m_log1p",
    "acct_req_1h_log1p",
    # authentication
    "pair_401_5m_log1p",
    "pair_fail_ratio",
    # familiarity
    "pair_unfamiliar",
    "reference_unknown",
    "pair_rarity",
    # resource history
    "acct_family_rarity",
    "acct_path_denials_log1p",
    "first_200_after_denials",
    # request characteristics
    "is_login",
    "is_admin",
    "is_forum",
    "is_sensitive",
    "status_2xx",
    "status_3xx",
    "status_401",
    "status_403",
    "status_other",
    "unusual_query_key_count",
    # size
    "bytes_log1p",
    "bytes_delta_vs_bootstrap",
    "bytes_reference_missing",
    # timing
    "hour_sin",
    "hour_cos",
    "weekend",
    "acct_hour_rarity",
    # evidence maturity
    "acct_history_log1p",
    "cold_start",
)


@dataclass(frozen=True)
class FeatureResult:
    vector: list[float]
    observed: dict[str, Any]  # raw measured quantities used for deterministic explanations
    history_count: int


def compute_features(
    ev: Event,
    win: WindowCounts,
    acct: dict[str, Any],
    pair: dict[str, Any],
    acct_path: dict[str, Any],
    ref: Reference,
    cfg: DetectionConfig,
) -> FeatureResult:
    routes = cfg.routes
    fcfg = cfg.policy["features"]
    acct_n = int(acct["n"])
    distinct_ips = len(acct["ips"])
    pair_n = int(pair["n"])
    fam_n = int(acct["families"].get(ev.route_family, 0))
    n_families = len(acct["families"])
    denials = int(acct_path["get403"])
    prior_200 = int(acct_path["get200"])
    familiarity = ref.familiarity(ev.username, ev.ip_raw)

    expected_keys = set(routes.expected_query_keys.get(ev.route_family, ())) | set(ref.family_query_keys.get(ev.route_family, ()))
    unusual_keys = [k for k in ev.query_keys if k not in expected_keys]

    bytes_log = math.log1p(float(ev.response_bytes or 0))
    bref = ref.bytes_reference(ev.route_family, ev.status)
    bytes_delta = (bytes_log - bref) if bref is not None else 0.0

    local = ev.local_time
    hour = local.hour
    hour_count = int(acct["hours"].get(str(hour), 0))
    cold = acct_n < int(fcfg["cold_start_events"])

    vec = [
        math.log1p(win.acct_5m),
        math.log1p(win.ip_5m),
        math.log1p(win.acct_1h),
        math.log1p(win.pair_401_5m),
        (int(pair["login_failures"]) + 1) / (int(pair["login_attempts"]) + 2),
        1.0 if familiarity == "unfamiliar" else 0.0,
        1.0 if familiarity == "reference_unknown" else 0.0,
        -math.log((pair_n + 1) / (acct_n + distinct_ips + 1)),
        -math.log((fam_n + 1) / (acct_n + n_families + 1)),
        math.log1p(denials),
        1.0 if (ev.method == "GET" and ev.status == 200 and denials > 0 and prior_200 == 0) else 0.0,
        1.0 if routes.in_category(ev.route_family, "login_families") else 0.0,
        1.0 if routes.in_category(ev.route_family, "admin_families") else 0.0,
        1.0 if routes.in_category(ev.route_family, "forum_families") else 0.0,
        1.0 if routes.is_sensitive(ev.path) else 0.0,
        1.0 if 200 <= ev.status < 300 else 0.0,
        1.0 if 300 <= ev.status < 400 else 0.0,
        1.0 if ev.status == 401 else 0.0,
        1.0 if ev.status == 403 else 0.0,
        1.0 if not (200 <= ev.status < 400 or ev.status in (401, 403)) else 0.0,
        float(len(unusual_keys)),
        bytes_log,
        bytes_delta,
        1.0 if bref is None else 0.0,
        math.sin(2 * math.pi * hour / 24),
        math.cos(2 * math.pi * hour / 24),
        1.0 if local.weekday() >= 5 else 0.0,
        -math.log((hour_count + 1) / (acct_n + 24)),
        math.log1p(acct_n),
        1.0 if cold else 0.0,
    ]
    assert len(vec) == len(FEATURE_NAMES)
    for v in vec:
        if math.isnan(v) or math.isinf(v):
            raise ValueError("feature produced NaN/inf")
    observed = {
        "acct_req_5m": win.acct_5m,
        "ip_req_5m": win.ip_5m,
        "acct_req_1h": win.acct_1h,
        "pair_401_5m": win.pair_401_5m,
        "pair_401_60s": win.pair_401_60s,
        "pair_login_attempts": int(pair["login_attempts"]),
        "pair_login_failures": int(pair["login_failures"]),
        "pair_login_success": int(pair["login_success"]),
        "pair_count": pair_n,
        "acct_count": acct_n,
        "acct_distinct_ips": distinct_ips,
        "acct_family_count": fam_n,
        "acct_path_denials": denials,
        "acct_path_prior_200": prior_200,
        "acct_path_prior_post2xx": int(acct_path["post2xx"]),
        "familiarity": familiarity,
        "unusual_query_keys": unusual_keys,
        "bytes_reference_log1p": bref,
        "local_hour": hour,
        "acct_hour_count": hour_count,
        "weekend": local.weekday() >= 5,
        "cold_start": cold,
        "is_sensitive": routes.is_sensitive(ev.path),
    }
    return FeatureResult(vector=vec, observed=observed, history_count=acct_n)
