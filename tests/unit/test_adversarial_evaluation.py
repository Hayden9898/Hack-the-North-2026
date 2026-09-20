from __future__ import annotations

from scripts.adversarial_evaluation import SCENARIOS, build_world


def test_adversarial_matrix_has_distinct_generic_cases() -> None:
    ids = [scenario.scenario_id for scenario in SCENARIOS]
    assert len(ids) == len(set(ids))
    assert {"R1", "R2", "R3", "R4", "R5", "R6"} <= {
        rule for scenario in SCENARIOS for rule in scenario.expected_match_counts
    }
    assert any(not scenario.expected_match_counts for scenario in SCENARIOS)


def test_every_adversarial_case_builds_a_replayable_generic_log() -> None:
    for scenario in SCENARIOS:
        world, anchor = build_world(scenario.scenario_id)
        rendered = world.render()
        assert rendered.endswith("\n")
        assert "acct_" in rendered
        assert anchor.tzinfo is not None
