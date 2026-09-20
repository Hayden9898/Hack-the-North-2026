"""Run a seeded adversarial regression matrix through the actual detector.

This is a generic engineering gate, not a real-world accuracy or CSE-source-data
evaluation. It refuses non-test databases before truncating any tables.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from tests.fixtures.synth import (
    TZ,
    World,
    baseline_traffic,
    default_world,
    scenario_access_change,
    scenario_auth_burst,
    scenario_linked_sequence,
)
from tests.helpers import drive, import_world, start_run

from app.config import DetectionConfig, load_config
from app.db import migrate
from app.db.engine import connect_direct, ping
from app.settings import REPO_ROOT, get_settings
from scripts.test_database import TRUNCATE_ORDER, validate_test_database

MATRIX_VERSION = 1
D0 = date(2025, 1, 6)


@dataclass(frozen=True)
class Scenario:
    """One behavior boundary and its current policy contract."""

    scenario_id: str
    description: str
    mutation: str
    expected_match_counts: dict[str, int]
    expected_incidents: int
    expected_high_risk_incidents: int
    expected_first_alert_seconds: int | None


@dataclass(frozen=True)
class ScenarioResult:
    scenario_id: str
    passed: bool
    expected_match_counts: dict[str, int]
    observed_match_counts: dict[str, int]
    expected_incidents: int
    observed_incidents: int
    expected_high_risk_incidents: int
    observed_high_risk_incidents: int
    expected_first_alert_seconds: int | None
    observed_first_alert_seconds: int | None
    run_state: str


SCENARIOS = (
    Scenario(
        "benign_control", "Routine familiar activity stays silent.", "No attack injected.", {}, 0, 0, None
    ),
    Scenario(
        "rapid_unfamiliar_guessing",
        "Four fast unfamiliar login failures create one R1 warning.",
        "Fast credential guessing from another account's source IP.",
        {"R1": 1},
        1,
        0,
        12,
    ),
    Scenario(
        "slow_unfamiliar_guessing",
        "Six spaced failures create R6 without duplicating R1.",
        "Patient credential guessing: one failure every ten minutes.",
        {"R6": 1},
        1,
        0,
        3000,
    ),
    Scenario(
        "slow_guessing_window_boundary",
        "Failures just outside R6's one-hour window stay silent.",
        "Six failures separated by 721 seconds, so the oldest is outside the boundary.",
        {},
        0,
        0,
        None,
    ),
    Scenario(
        "denial_then_sensitive_success",
        "First sensitive success after denials creates R2.",
        "Six historical denials followed by a first successful sensitive GET.",
        {"R2": 1},
        1,
        0,
        0,
    ),
    Scenario(
        "prior_success_suppresses_access_change",
        "Prior authorized access prevents an R2 access-change claim.",
        "The same denial sequence, but with an earlier successful access.",
        {},
        0,
        0,
        None,
    ),
    Scenario(
        "forum_then_admin",
        "A forum-object view immediately followed by an admin request creates R3.",
        "Admin transition inside the 60-second causal window.",
        {"R3": 1},
        1,
        0,
        0,
    ),
    Scenario(
        "forum_admin_window_boundary",
        "A forum view 61 seconds earlier does not create R3.",
        "Admin request immediately outside the R3 view window.",
        {},
        0,
        0,
        None,
    ),
    Scenario(
        "rapid_guessing_then_takeover",
        "R1 escalates to high-risk R4 only after login plus sensitive access.",
        "Fast guessing, then an unfamiliar successful login and sensitive download.",
        {"R1": 1, "R4": 1},
        1,
        1,
        12,
    ),
    Scenario(
        "slow_guessing_then_takeover",
        "R6 escalates to high-risk R4 after the same corroborating sequence.",
        "Slow guessing, then an unfamiliar successful login and sensitive download.",
        {"R6": 1, "R4": 1},
        1,
        1,
        3000,
    ),
    Scenario(
        "login_window_boundary",
        "R1 stays suspicious when login is outside R4's 30-minute window.",
        "Sensitive access occurs 30 minutes and one second after a successful login.",
        {"R1": 1},
        1,
        0,
        12,
    ),
    Scenario(
        "linked_cross_account_escalation",
        "Independent R2 and R3 evidence links into high-risk R5 without merging unrelated episodes.",
        "Two accounts view one object; one transitions to admin while the other gains sensitive access.",
        {"R1": 4, "R2": 1, "R3": 1, "R4": 1, "R5": 1},
        3,
        2,
        12,
    ),
)


def _config(tmp_path: Path) -> DetectionConfig:
    """Build generic chronological partitions without inheriting source-dataset dates."""
    cdir = tmp_path / "config"
    cdir.mkdir(parents=True, exist_ok=True)
    for name in ("routes.yaml", "playbooks.yaml", "policy.yaml"):
        shutil.copy(REPO_ROOT / "config" / name, cdir / name)
    (cdir / "partitions.yaml").write_text(
        "\n".join(
            (
                "version: 1",
                "dataset_sha256: null",
                "utc_offset_minutes: -240",
                "partitions:",
                "  bootstrap: {start: '2025-01-06', end_exclusive: '2025-01-16'}",
                "  train: {start: '2025-01-16', end_exclusive: '2025-01-22'}",
                "  calibration: {start: '2025-01-22', end_exclusive: '2025-01-28'}",
                "  evaluation: {start: '2025-01-28', end_exclusive: '2025-02-15'}",
                "",
            )
        ),
        encoding="utf-8",
    )
    return load_config(cdir)


def _base_world() -> World:
    world = default_world(start=datetime(D0.year, D0.month, D0.day, tzinfo=TZ))
    # Multiple successful logins across dates establish pair familiarity without a toy, one-event background.
    baseline_traffic(world, days=30, events_per_day=12)
    return world


def build_world(scenario_id: str) -> tuple[World, datetime]:
    """Return a generic log world and the moment from which alert latency is measured."""
    world = _base_world()
    actor, victim = world.accounts[3], world.accounts[1]
    source_ip = world.ips[actor]
    sensitive = world.sensitive_paths[0]
    rapid_at = world.start + timedelta(days=23, hours=9)

    if scenario_id == "benign_control":
        return world, rapid_at
    if scenario_id == "rapid_unfamiliar_guessing":
        scenario_auth_burst(world, rapid_at, victim, source_ip, n=4, spacing=4)
        return world, rapid_at
    if scenario_id == "slow_unfamiliar_guessing":
        scenario_auth_burst(world, rapid_at, victim, source_ip, n=6, spacing=600)
        return world, rapid_at
    if scenario_id == "slow_guessing_window_boundary":
        scenario_auth_burst(world, rapid_at, victim, source_ip, n=6, spacing=721)
        return world, rapid_at
    if scenario_id == "denial_then_sensitive_success":
        trigger = rapid_at + timedelta(days=3)
        scenario_access_change(world, trigger, actor, sensitive, denials=6)
        return world, trigger
    if scenario_id == "prior_success_suppresses_access_change":
        trigger = rapid_at + timedelta(days=3)
        # A path absent from the background avoids accidentally making the
        # counterfactual success itself a prior-denials R2 case during warmup.
        counterfactual_path = "/exec/project_CONFIDENTIAL.json"
        world.emit(
            trigger - timedelta(days=7), world.ips[actor], actor, "GET", counterfactual_path, 200, 8459200
        )
        scenario_access_change(world, trigger, actor, counterfactual_path, denials=6)
        return world, trigger
    if scenario_id in {"forum_then_admin", "forum_admin_window_boundary"}:
        view = rapid_at + timedelta(days=1)
        world.emit(
            view, world.ips[actor], actor, "GET", f"/intranet/forum/view/{world.forum_objects[0]}", 200, 3105
        )
        trigger = view + timedelta(seconds=1 if scenario_id == "forum_then_admin" else 61)
        world.emit(trigger, world.ips[actor], actor, "POST", "/api/admin/role_update", 200, 85)
        return world, trigger
    if scenario_id in {"rapid_guessing_then_takeover", "login_window_boundary"}:
        failures = scenario_auth_burst(world, rapid_at, victim, source_ip, n=4, spacing=4)
        login = failures[-1] + timedelta(minutes=5)
        world.emit(login, source_ip, victim, "POST", "/api/auth/login", 200, 128)
        wait = 1801 if scenario_id == "login_window_boundary" else 45
        world.emit(login + timedelta(seconds=wait), source_ip, victim, "GET", sensitive, 200, 8459200)
        return world, rapid_at
    if scenario_id == "slow_guessing_then_takeover":
        failures = scenario_auth_burst(world, rapid_at, victim, source_ip, n=6, spacing=600)
        login = failures[-1] + timedelta(minutes=5)
        world.emit(login, source_ip, victim, "POST", "/api/auth/login", 200, 128)
        world.emit(login + timedelta(seconds=45), source_ip, victim, "GET", sensitive, 200, 8459200)
        return world, rapid_at
    if scenario_id == "linked_cross_account_escalation":
        day = world.start + timedelta(days=27)
        anchor = day - timedelta(days=2) + timedelta(hours=23, minutes=10)
        scenario_linked_sequence(world, day, actor, victim, world.forum_objects[5], sensitive)
        return world, anchor
    raise ValueError(f"unknown scenario: {scenario_id}")


def _truncate(db_url: str) -> None:
    with connect_direct(db_url) as conn, conn.cursor() as cur:
        cur.execute("TRUNCATE TABLE " + ", ".join(TRUNCATE_ORDER) + " CASCADE")
        conn.commit()


def evaluate_scenario(db_url: str, tmp_path: Path, scenario: Scenario) -> ScenarioResult:
    """Evaluate one matrix row through import, replay, detection and incident persistence."""
    _truncate(db_url)
    config = _config(tmp_path)
    world, anchor = build_world(scenario.scenario_id)
    dataset_id = import_world(world, tmp_path, db_url, name=f"{scenario.scenario_id}.log")
    run_id = start_run(db_url, config, dataset_id, name=f"adversarial-{scenario.scenario_id}")
    run = drive(db_url, config, run_id)
    with connect_direct(db_url) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT rule_id, event_time FROM rule_matches WHERE run_id=%s ORDER BY run_seq", (run_id,)
        )
        matches: list[dict[str, Any]] = [dict(row) for row in cur.fetchall()]
        cur.execute("SELECT current_class FROM incidents WHERE run_id=%s", (run_id,))
        classes = [str(row["current_class"]) for row in cur.fetchall()]
    observed_counts = dict(sorted(Counter(str(match["rule_id"]) for match in matches).items()))
    first_alert_seconds = round((matches[0]["event_time"] - anchor).total_seconds()) if matches else None
    high_risk = sum(klass == "high_risk" for klass in classes)
    passed = (
        run["state"] == "completed"
        and observed_counts == scenario.expected_match_counts
        and len(classes) == scenario.expected_incidents
        and high_risk == scenario.expected_high_risk_incidents
        and first_alert_seconds == scenario.expected_first_alert_seconds
    )
    return ScenarioResult(
        scenario_id=scenario.scenario_id,
        passed=passed,
        expected_match_counts=scenario.expected_match_counts,
        observed_match_counts=observed_counts,
        expected_incidents=scenario.expected_incidents,
        observed_incidents=len(classes),
        expected_high_risk_incidents=scenario.expected_high_risk_incidents,
        observed_high_risk_incidents=high_risk,
        expected_first_alert_seconds=scenario.expected_first_alert_seconds,
        observed_first_alert_seconds=first_alert_seconds,
        run_state=str(run["state"]),
    )


def run_matrix(db_url: str, output: Path) -> dict[str, Any]:
    """Run every row against a dedicated test database and write a machine-readable receipt."""
    settings = get_settings()
    validate_test_database(db_url, settings.database_url)
    ok, detail = ping(db_url)
    if not ok:
        raise RuntimeError(f"test database unavailable: {detail}")
    migrate.upgrade(db_url)
    with tempfile.TemporaryDirectory(prefix="logorder-adversarial-") as temp_dir:
        results = [
            evaluate_scenario(db_url, Path(temp_dir) / scenario.scenario_id, scenario)
            for scenario in SCENARIOS
        ]
    receipt = {
        "schema_version": MATRIX_VERSION,
        "kind": "synthetic_adversarial_regression_gate",
        "scope": "Generic seeded behaviors only; not a real-world or CSE dataset benchmark.",
        "policy_version": int(load_config(REPO_ROOT / "config").policy["version"]),
        "scenario_count": len(results),
        "passed": all(result.passed for result in results),
        "results": [asdict(result) for result in results],
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database-url",
        default=None,
        help="Dedicated *_test TimescaleDB URL (defaults to TEST_DATABASE_URL).",
    )
    parser.add_argument("--out", default="reports/adversarial_evaluation.json", help="JSON receipt path.")
    args = parser.parse_args()
    database_url = args.database_url or get_settings().test_database_url
    try:
        receipt = run_matrix(database_url, Path(args.out))
    except (RuntimeError, ValueError) as exc:
        print(f"Cannot run adversarial evaluation: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(receipt, indent=2, sort_keys=True))
    return 0 if receipt["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
