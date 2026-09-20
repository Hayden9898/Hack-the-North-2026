"""Test the verification machinery itself: safety, failure status and unambiguous reports."""

import json
import sys

import pytest
import tasks
from scripts import verification
from scripts.test_database import validate_test_database

APP = "postgresql://operator:secret@localhost:5433/logorder"
TEST = "postgresql://operator:secret@127.0.0.1:5433/logorder_test"


def test_test_database_requires_distinct_explicit_disposable_target():
    validate_test_database(TEST, APP)
    for target in (
        APP,
        TEST.replace("logorder_test", "logorder"),
        TEST + "?dbname=production",
        TEST.replace("127.0.0.1", "prod.example.com"),
        "service=production",
    ):
        with pytest.raises(ValueError):
            validate_test_database(target, APP)
    with pytest.raises(ValueError, match="application database"):
        validate_test_database(TEST, TEST.replace("127.0.0.1", "localhost"))


def test_verification_disables_external_side_effects_and_pytest_overrides(monkeypatch):
    monkeypatch.setenv("SLACK_MODE", "live")
    monkeypatch.setenv("LLM_API_KEY", "private-test-key")
    monkeypatch.setenv("PYTEST_ADDOPTS", "-n auto")
    env = verification.safe_environment()
    assert env["SLACK_MODE"] == "preview" and env["LLM_API_KEY"] == ""
    assert env["LOGORDER_ALLOW_SKIP_DB"] == "0" and env["PYTEST_ADDOPTS"] == ""
    assert "private-test-key" not in verification.redact("token=private-test-key")
    assert "secret" not in verification.redact(APP)


def test_blocked_check_is_nonzero_and_html_escapes_process_output(tmp_path, monkeypatch):
    monkeypatch.setattr(verification, "OUTPUT", tmp_path)
    result = verification.Verification("frontend")
    result.add("Unavailable dependency", "blocked", "<script>alert('unsafe')</script>")
    assert result.finish() == 1
    assert json.loads((result.run_dir / "results.json").read_text())["status"] == "blocked"
    html = (result.run_dir / "index.html").read_text()
    assert "&lt;script&gt;" in html and "<script>" not in html


def test_flaky_skipped_or_empty_browser_runs_do_not_pass(tmp_path, monkeypatch):
    monkeypatch.setattr(verification, "OUTPUT", tmp_path)
    for stats in (
        {"unexpected": 0, "flaky": 1, "skipped": 0, "expected": 1},
        {"unexpected": 0, "flaky": 0, "skipped": 1, "expected": 1},
        {"unexpected": 0, "flaky": 0, "skipped": 0, "expected": 0},
    ):
        result = verification.Verification("frontend")
        (result.run_dir / "browser-results.json").write_text(json.dumps({"stats": stats}))
        assert not result.browser_result_complete()


def test_command_failure_and_timeout_are_not_hidden(tmp_path, monkeypatch):
    monkeypatch.setattr(verification, "OUTPUT", tmp_path)
    result = verification.Verification("frontend")
    assert not result.step("Deliberate failure", [sys.executable, "-c", "raise SystemExit(7)"])
    assert result.checks[-1].status == "failed"
    rc, output = verification.execute([sys.executable, "-c", "import time; time.sleep(5)"], timeout=1)
    assert rc == 124 and "Timed out" in output


def test_task_runner_translates_boolean_flags_without_bogus_values():
    assert tasks._passthrough({"NO_DRIVE": "1", "SPEED": "0"}) == ["--no-drive", "--speed", "0"]
    assert tasks._passthrough({"ACTIVATE": "1", "MODEL_ID": "reviewed-model"}) == [
        "--activate",
        "--model-id",
        "reviewed-model",
    ]
    assert tasks._passthrough({"NO_DRIVE": "0"}) == []


def test_python_reports_cannot_hide_skips(tmp_path, monkeypatch):
    monkeypatch.setattr(verification, "OUTPUT", tmp_path)
    result = verification.Verification("backend")
    assert not result.python_result_complete()
    for name in ("python-unit.xml", "python-database.xml"):
        (result.run_dir / name).write_text(
            '<testsuites><testsuite><testcase name="case" /></testsuite></testsuites>'
        )
    assert result.python_result_complete()
    (result.run_dir / "python-database.xml").write_text(
        "<testsuites><testsuite><testcase><skipped /></testcase></testsuite></testsuites>"
    )
    assert not result.python_result_complete()
