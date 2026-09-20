"""The adversarial matrix is a real database gate, not a fixture-only unit test."""

from __future__ import annotations

import pytest
from scripts.adversarial_evaluation import SCENARIOS, evaluate_scenario

pytestmark = pytest.mark.integration


def test_seeded_adversarial_matrix_against_actual_detector(db, tmp_path):
    results = [evaluate_scenario(db, tmp_path / scenario.scenario_id, scenario) for scenario in SCENARIOS]
    failed = [result for result in results if not result.passed]
    assert not failed, failed
