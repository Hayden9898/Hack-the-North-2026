from app.detection.policy import classify
from app.detection.rules import RuleMatch


def _m(rule, outcome, incomplete=False):
    return RuleMatch(rule_id=rule, outcome=outcome, key_type="pair", key_value="a|b", legs=[], params={}, incomplete=incomplete)


def test_high_risk_rule_wins_regardless_of_low_model_score():
    d = classify([_m("R4", "high_risk")], model_score=-10.0, threshold=0.5)
    assert d.threat_class == "high_risk"
    assert d.model_flagged is False
    assert "rule:R4:high_risk" in d.reason_codes


def test_suspicious_rule_not_vetoed_by_model():
    d = classify([_m("R1", "suspicious")], model_score=0.0, threshold=0.5)
    assert d.threat_class == "suspicious"


def test_model_alone_is_at_most_suspicious_and_strict_threshold():
    assert classify([], model_score=0.6, threshold=0.5).threat_class == "suspicious"
    assert classify([], model_score=0.5, threshold=0.5).threat_class == "normal"  # tie is not an alert
    assert classify([], model_score=0.1, threshold=0.5).threat_class == "normal"


def test_no_model_gives_null_flag_not_normal_by_default():
    d = classify([], model_score=None, threshold=None)
    assert d.model_flagged is None
    assert d.threat_class == "normal"  # no configured detector flagged it; model_health is reported separately


def test_incomplete_evaluation_is_surfaced_as_reason_code():
    d = classify([_m("R2", "suspicious", incomplete=True)], None, None)
    assert "rule:R2:evaluation_incomplete" in d.reason_codes
    assert d.threat_class == "suspicious"
