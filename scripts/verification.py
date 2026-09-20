"""Reproducible verification gates and a human-readable evidence report. Standard library only.

The frontend gate never needs a database. The backend gate only uses a protected test database.
The live gate only reads an explicitly selected completed replay; it never creates or resumes one.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import platform
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
NPM = "npm.cmd" if os.name == "nt" else "npm"
VENV = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
PYTHON = str(VENV if VENV.exists() else Path(sys.executable))
OUTPUT = ROOT / "reports" / "verification"


@dataclass
class Check:
    name: str
    status: str
    detail: str
    command: str = ""
    seconds: float = 0


def safe_environment() -> dict[str, str]:
    """Never call real external integrations from verification, even if the shell has credentials."""
    return {
        **os.environ,
        "PYTHONPATH": os.pathsep.join([str(ROOT / "backend"), str(ROOT)]),
        "PYTHONUTF8": "1",
        "NO_COLOR": "1",
        "LOGORDER_ALLOW_SKIP_DB": "0",
        "SLACK_MODE": "preview",
        "SLACK_WEBHOOK_URL": "",
        "SENTRY_DSN": "",
        "VITE_SENTRY_DSN": "",
        "LLM_API_KEY": "",
        "APP_AUTH_SECRET": "",
        "INGEST_TOKEN": "",
        "API_HOST": "127.0.0.1",
        # Do not inherit a caller's pytest selection, parallelization or skip configuration.
        "PYTEST_ADDOPTS": "",
        "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
    }


def redact(text: str) -> str:
    import re

    text = re.sub(r"\x1b\[[0-9;]*m", "", text)
    text = re.sub(r"(postgres(?:ql)?(?:\+psycopg)?://)[^\s/@]+(?::[^\s/@]*)?@", r"\1[redacted]@", text)
    for name in ("APP_AUTH_SECRET", "INGEST_TOKEN", "SLACK_WEBHOOK_URL", "SENTRY_DSN", "LLM_API_KEY"):
        value = os.environ.get(name)
        if value:
            text = text.replace(value, "[redacted]")
    return text


def stop_process(proc: subprocess.Popen) -> None:
    """Stop only the process group that this runner created (including npm's browser/server children)."""
    if os.name == "nt":
        if proc.poll() is None:
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True, check=False)
    else:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
    proc.wait(timeout=10)


def execute(
    command: list[str], *, cwd: Path = ROOT, timeout: int = 120, env: dict[str, str] | None = None
) -> tuple[int, str]:
    proc = subprocess.Popen(
        command,
        cwd=cwd,
        env=env or safe_environment(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=os.name != "nt",
    )
    try:
        output, _ = proc.communicate(timeout=timeout)
        return proc.returncode, redact(output)
    except subprocess.TimeoutExpired:
        stop_process(proc)
        output, _ = proc.communicate()
        return 124, redact(output + f"\nTimed out after {timeout}s. Owned child processes were stopped.")
    except KeyboardInterrupt:
        stop_process(proc)
        raise


class Verification:
    def __init__(self, profile: str):
        self.profile = profile
        self.checks: list[Check] = []
        self.started = datetime.now(UTC).isoformat()
        self.run_dir = OUTPUT / f"{datetime.now(UTC):%Y%m%dT%H%M%S.%fZ}-{profile}"
        self.run_dir.mkdir(parents=True, exist_ok=False)

    def add(self, name: str, status: str, detail: str, command: str = "", seconds: float = 0) -> bool:
        self.checks.append(Check(name, status, redact(detail), command, seconds))
        print(f"[{status.upper():7}] {name}" + (f" ({seconds:.1f}s)" if seconds else ""), flush=True)
        if status != "passed":
            lines = redact(detail).splitlines()
            summary = next(
                (line for line in lines if "Error:" in line or "FAILED" in line),
                lines[-1] if lines else "No detail",
            )
            print(f"          {summary}", flush=True)
        return status == "passed"

    def step(
        self,
        name: str,
        command: list[str],
        *,
        cwd: Path = ROOT,
        timeout: int = 120,
        prerequisite: bool = False,
        env: dict[str, str] | None = None,
    ) -> bool:
        print(f"[RUNNING] {name}", flush=True)
        start = time.monotonic()
        try:
            rc, output = execute(command, cwd=cwd, timeout=timeout, env=env)
        except OSError as exc:
            rc, output = 127, f"{type(exc).__name__}: required executable unavailable."
        status = "passed" if rc == 0 else "blocked" if prerequisite else "failed"
        return self.add(name, status, output or f"Exit {rc}", " ".join(command), time.monotonic() - start)

    def frontend(self, *, headed: bool = False) -> bool:
        if not (FRONTEND / "node_modules/.bin/playwright").exists():
            return self.add(
                "Frontend dependencies",
                "blocked",
                "Run: cd frontend && npm ci && npx playwright install chromium",
            )
        for label, script in [
            ("TypeScript", "typecheck"),
            ("Frontend lint", "lint"),
            ("Production build", "build"),
        ]:
            if not self.step(label, [NPM, "run", script], cwd=FRONTEND, timeout=180):
                self.add(
                    "Browser gate",
                    "blocked",
                    "Fix the preceding source/build failure before browser sign-off.",
                )
                return False
        env = {
            **safe_environment(),
            "PLAYWRIGHT_HTML_OUTPUT_DIR": str(self.run_dir / "browser"),
            "PLAYWRIGHT_JSON_OUTPUT_FILE": str(self.run_dir / "browser-results.json"),
        }
        command = [NPM, "run", "test:e2e"] + (["--", "--headed"] if headed else [])
        ok = self.step(
            "Production-browser multipart upload workflow",
            command,
            cwd=FRONTEND,
            timeout=300,
            env=env,
        )
        if ok:
            ok = self.browser_result_complete()
        if ok:
            env["PLAYWRIGHT_HTML_OUTPUT_DIR"] = str(self.run_dir / "monitoring")
            env["PLAYWRIGHT_JSON_OUTPUT_FILE"] = str(self.run_dir / "monitoring-results.json")
            ok = self.step(
                "Real browser Sentry SDK (local synthetic transport)",
                [NPM, "run", "test:monitoring"],
                cwd=FRONTEND,
                timeout=180,
                env=env,
            )
            if ok:
                ok = self.browser_result_complete("monitoring-results.json")
        return ok

    def browser_result_complete(self, filename: str = "browser-results.json") -> bool:
        try:
            result = json.loads((self.run_dir / filename).read_text())
            stats = result["stats"]
            if stats["unexpected"] or stats["flaky"] or stats["skipped"] or not stats["expected"]:
                return self.add(
                    "Browser result completeness",
                    "failed",
                    "Zero skipped, flaky or failed tests are required.",
                )
            return self.add(
                "Browser result completeness",
                "passed",
                f"{stats['expected']} tests passed; none skipped or retried.",
            )
        except (OSError, KeyError, ValueError):
            return self.add(
                "Browser result completeness",
                "failed",
                "The machine-readable browser result is missing or invalid.",
            )

    def backend(self) -> bool:
        deps = self.step(
            "Backend environment",
            [
                PYTHON,
                "-c",
                "import sys; assert (3,12) <= sys.version_info[:2] < (3,14); "
                "import pytest, psycopg, fastapi, sklearn; print('Python and backend imports ready')",
            ],
            prerequisite=True,
        )
        if not deps:
            self.add("Backend suite", "blocked", "Create a Python 3.12 .venv and install requirements.txt.")
            return False
        if not self.step(
            "Python lint", [PYTHON, "-m", "ruff", "check", "backend", "ml", "scripts", "tests", "tasks.py"]
        ):
            return False
        if not self.step("Python types", [PYTHON, "-m", "mypy"], timeout=180):
            return False
        if not self.step(
            "Non-database tests",
            [
                PYTHON,
                "-m",
                "pytest",
                "-m",
                "not integration and not e2e and not external and not slow",
                f"--junitxml={self.run_dir / 'python-unit.xml'}",
            ],
            timeout=180,
        ):
            return False
        if not self.step(
            "Test database safety and readiness", [PYTHON, "-m", "scripts.test_database"], prerequisite=True
        ):
            self.add(
                "Database tests",
                "blocked",
                "Start Docker, run db-up then migrate. Never use the application database as the test target.",
            )
            return False
        # One pytest invocation; a session advisory lock also rejects competing processes.
        ok = self.step(
            "Database integration and API/worker tests (serial)",
            [
                PYTHON,
                "-m",
                "pytest",
                "-m",
                "(integration or e2e) and not slow and not external",
                f"--junitxml={self.run_dir / 'python-database.xml'}",
            ],
            timeout=1200,
        )
        return ok and self.python_result_complete()

    def python_result_complete(self) -> bool:
        try:
            for filename in ("python-unit.xml", "python-database.xml"):
                root = ET.parse(self.run_dir / filename).getroot()
                cases = root.findall(".//testcase")
                if not cases or any(
                    case.find(status) is not None
                    for case in cases
                    for status in ("skipped", "error", "failure")
                ):
                    return self.add(
                        "Python result completeness",
                        "failed",
                        "Both Python suites require nonempty results with zero skips/errors/failures.",
                    )
            return self.add(
                "Python result completeness",
                "passed",
                "Both Python suites produced nonempty, clean JUnit evidence.",
            )
        except (OSError, ET.ParseError):
            return self.add("Python result completeness", "failed", "Missing or invalid Python JUnit report.")

    def live(self, run_id: str, base_url: str) -> bool:
        if not run_id:
            return self.add(
                "Real replay selection",
                "blocked",
                "Specify RUN_ID=<completed execution ID>. The live gate never creates or resumes data.",
            )
        if not (FRONTEND / "node_modules/.bin/playwright").exists():
            return self.add(
                "Browser dependencies",
                "blocked",
                "Run npm ci and npx playwright install chromium in frontend.",
            )
        from urllib.parse import urlsplit

        target = urlsplit(base_url)
        if (
            target.scheme not in {"http", "https"}
            or target.hostname not in {"localhost", "127.0.0.1", "::1"}
            or target.username
            or target.password
            or target.query
            or target.fragment
        ):
            return self.add(
                "Live target",
                "blocked",
                "Use a loopback HTTP(S) base URL without credentials, query or fragment.",
            )
        try:
            with urllib.request.urlopen(base_url.rstrip("/") + "/health/ready", timeout=5) as response:
                if json.loads(response.read()).get("status") != "ready":
                    raise ValueError("not ready")
        except (OSError, ValueError):
            return self.add(
                "Live API readiness",
                "blocked",
                "The selected app/API is not ready. Start dev after its prerequisites pass.",
            )
        env = {
            **safe_environment(),
            "VERIFY_RUN_ID": run_id,
            "VERIFY_BASE_URL": base_url,
            "PLAYWRIGHT_HTML_OUTPUT_DIR": str(self.run_dir / "browser"),
            "PLAYWRIGHT_JSON_OUTPUT_FILE": str(self.run_dir / "browser-results.json"),
        }
        ok = self.step(
            "Canonical replay acceptance — real API and UI, read-only",
            [NPM, "run", "test:live"],
            cwd=FRONTEND,
            timeout=180,
            env=env,
        )
        return self.browser_result_complete() if ok else False

    def doctor(self) -> None:
        self.step("Selected Python", [PYTHON, "--version"], prerequisite=True)
        self.step("Node", ["node", "--version"], prerequisite=True)
        self.step(
            "Backend dependencies",
            [PYTHON, "-c", "import fastapi, psycopg, sklearn; print('Imports ready')"],
            prerequisite=True,
        )
        self.add(
            "Frontend dependencies",
            "passed" if (FRONTEND / "node_modules").exists() else "blocked",
            "Run npm ci inside frontend if missing.",
        )
        self.step(
            "Docker daemon",
            ["docker", "info", "--format", "{{.ServerVersion}}"],
            timeout=10,
            prerequisite=True,
        )
        self.step(
            "Dedicated test database", [PYTHON, "-m", "scripts.test_database"], timeout=15, prerequisite=True
        )
        for label, url in [
            ("API readiness", "http://127.0.0.1:8000/health/ready"),
            ("Frontend HTTP", "http://127.0.0.1:5173/"),
        ]:
            try:
                with urllib.request.urlopen(url, timeout=5) as response:
                    body = response.read()
                    if label == "API readiness" and json.loads(body).get("status") != "ready":
                        raise ValueError("not ready")
                self.add(label, "passed", url)
            except (OSError, ValueError):
                self.add(
                    label,
                    "blocked",
                    f"{url} is not ready. Start python3 tasks.py dev after prerequisites pass.",
                )
        dataset = Path(os.environ.get("DATASET_PATH", str(ROOT / "htn_challenge_logs_2026.txt")))
        self.add(
            "Canonical dataset",
            "passed" if dataset.is_file() else "not_checked",
            "Dataset file found; hash is validated by the full-file test."
            if dataset.is_file()
            else "Supply the original file for canonical acceptance; synthetic tests do not need it.",
        )
        self.add(
            "Model artifacts",
            "passed" if list((ROOT / "ml/artifacts").glob("*/manifest.json")) else "not_checked",
            "Artifact presence only; evaluation/activation is a separate gate. Rules-only mode does not require a model.",
        )

    def finish(self) -> int:
        status = (
            "failed"
            if any(c.status == "failed" for c in self.checks)
            else "blocked"
            if any(c.status == "blocked" for c in self.checks)
            else "passed"
        )
        try:
            _, commit = execute(["git", "rev-parse", "HEAD"])
            _, changes = execute(["git", "status", "--porcelain"])
            _, diff = execute(["git", "diff", "--no-ext-diff"])
            revision = {
                "commit": commit.strip(),
                "dirty": bool(changes.strip()),
                "tracked_diff_sha256": hashlib.sha256(diff.encode()).hexdigest(),
            }
        except OSError:
            revision = {"commit": "unavailable"}
        report = {
            "profile": self.profile,
            "status": status,
            "started": self.started,
            "finished": datetime.now(UTC).isoformat(),
            "platform": platform.platform(),
            "revision": revision,
            "checks": [asdict(check) for check in self.checks],
            "limits": "Passing a gate is not proof of defect-free software. External integrations, model accuracy, deployment security and live-source latency require separate evidence.",
        }
        (self.run_dir / "results.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        cards = "".join(
            f'<section><h2><span class="{c.status}">{html.escape(c.status.upper())}</span> {html.escape(c.name)}</h2>'
            f"<p>{c.seconds:.1f}s</p><details><summary>Command and output</summary><pre>{html.escape(c.command)}\n\n{html.escape(c.detail)}</pre></details></section>"
            for c in self.checks
        )
        browser = (
            '<p><a href="browser/index.html">Open browser evidence: steps, screenshots and failure traces →</a></p>'
            if (self.run_dir / "browser/index.html").exists()
            else ""
        )
        if (self.run_dir / "monitoring/index.html").exists():
            browser += (
                '<p><a href="monitoring/index.html">Open Sentry SDK privacy/transport evidence →</a></p>'
            )
        page = f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Log &amp; Order verification</title><link rel="icon" href="data:,"><style>
body{{font:15px/1.6 system-ui;margin:0;background:#f7f8fa;color:#202b3c}}main{{max-width:1000px;margin:48px auto;padding:0 24px}}
h1{{font-size:28px}}h2{{font-size:16px;margin:0}}section{{border:1px solid #d7dde6;background:white;padding:20px;margin:14px 0;border-radius:6px}}
span{{margin-right:12px;font-size:12px}}.passed{{color:#176240}}.failed{{color:#ad3030}}.blocked{{color:#86550d}}.not_checked{{color:#59697d}}
pre{{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 monospace}}a{{color:#2255a7}}summary{{cursor:pointer}}p{{color:#526176}}code{{overflow-wrap:anywhere}}
</style><main><p>LOG &amp; ORDER / VERIFICATION</p><h1>{html.escape(self.profile.title())} gate: {status.upper()}</h1>
<p>{html.escape(self.started)} · {html.escape(platform.platform())}<br>Commit <code>{html.escape(str(revision["commit"]))}</code> · Uncommitted changes: {revision.get("dirty", "unknown")}</p>
<p>Frontend = synthetic API fixtures against the production build. Backend = protected, disposable test database. Live = explicit real replay, read-only.</p>
{browser}{cards}<section><h2>Human sign-off is separate</h2><p>Review screenshots, keyboard/focus behavior and the real replay before release. Do not publish traces containing real HTTP logs or personal data.</p>
<p>{html.escape(report["limits"])}</p><p>Operator checklist: <code>docs/verification-guide.md</code> · <a href="results.json">Machine-readable results</a></p></section></main></html>"""
        (self.run_dir / "index.html").write_text(page, encoding="utf-8")
        # A small redirect preserves each run rather than mixing stale screenshots with new results.
        latest = f'<!doctype html><html lang="en"><meta charset="utf-8"><title>Latest verification</title><meta http-equiv="refresh" content="0;url={self.run_dir.name}/index.html"><a href="{self.run_dir.name}/index.html">Latest verification report</a></html>'
        (OUTPUT / "index.html").write_text(latest, encoding="utf-8")
        print(f"\n{status.upper()}: {self.profile}. Report: {self.run_dir / 'index.html'}", flush=True)
        return 0 if status == "passed" else 1


def port_available(port: int) -> bool:
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile", choices=["doctor", "frontend", "backend", "full", "live"])
    parser.add_argument("--run-id", default="")
    parser.add_argument("--base-url", default="http://127.0.0.1:5173")
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args(argv)
    report = Verification(args.profile)
    try:
        if args.profile == "doctor":
            report.doctor()
        elif args.profile == "frontend":
            report.frontend(headed=args.headed)
        elif args.profile == "backend":
            report.backend()
        elif args.profile == "live":
            report.live(args.run_id, args.base_url)
        elif report.frontend(headed=args.headed):
            report.backend()
        else:
            report.add("Backend gate", "blocked", "Frontend verification must pass first.")
    except KeyboardInterrupt:
        report.add(
            "Verification interrupted",
            "blocked",
            "Interrupted by the operator. Remaining checks were not run.",
        )
    return report.finish()


if __name__ == "__main__":
    raise SystemExit(main())
