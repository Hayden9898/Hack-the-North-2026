#!/usr/bin/env python
"""Cross-platform task runner mirroring the Makefile targets (make is not always available on Windows).

Usage: python tasks.py <target> [KEY=VALUE ...]
Use python3 on macOS/Linux; python may still resolve to Python 2.
Targets: doctor verify verify-frontend verify-backend verify-live verify-report dev migrate import train calibrate evaluate
         replay-demo test benchmark build lint typecheck db-up db-down investigate demo-inject
Verification: verify runs frontend first, then protected backend tests. verify-live RUN_ID=... is read-only.
"""

from __future__ import annotations

import os
import shlex
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_PY = (
    ROOT
    / ".venv"
    / ("Scripts" if os.name == "nt" else "bin")
    / ("python.exe" if os.name == "nt" else "python")
)
PY = str(VENV_PY if VENV_PY.exists() else Path(sys.executable))
ENV = {**os.environ, "PYTHONPATH": str(ROOT / "backend") + os.pathsep + str(ROOT), "PYTHONUTF8": "1"}


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> int:
    print("+", " ".join(shlex.quote(c) for c in cmd), flush=True)
    return subprocess.run(cmd, cwd=str(cwd or ROOT), env=ENV, check=check).returncode


def npm(*args: str) -> int:
    exe = "npm.cmd" if os.name == "nt" else "npm"
    return run([exe, *args], cwd=ROOT / "frontend")


def target_db_up(**_: str) -> None:
    run(["docker", "compose", "up", "-d", "db"])


def target_db_down(**_: str) -> None:
    run(["docker", "compose", "down"])


def target_migrate(**_: str) -> None:
    run([PY, "-m", "scripts.migrate"])


def target_dev(**_: str) -> None:
    """Start database, run migrations, then API + workers + frontend dev server in one terminal."""
    from scripts.verification import port_available, stop_process

    for port in (8000, 5173):
        if not port_available(port):
            raise RuntimeError(
                f"Port {port} is already in use. Stop the existing service before starting dev; no process was killed."
            )
    run([PY, "-c", "import fastapi, psycopg, sklearn; print('Backend dependencies ready')"])
    if not (ROOT / "frontend/node_modules").is_dir():
        raise RuntimeError("Frontend dependencies missing. Run npm ci inside frontend.")
    target_db_up()
    run([PY, "-m", "scripts.wait_for_db"])
    target_migrate()
    services = [
        ("API", [PY, "-m", "scripts.serve_api"], ROOT),
        ("detector worker", [PY, "-m", "app.workers.detector"], ROOT),
        ("side-effect worker", [PY, "-m", "app.workers.side_effects"], ROOT),
        ("frontend", ["npm.cmd" if os.name == "nt" else "npm", "run", "dev"], ROOT / "frontend"),
    ]
    procs: list[tuple[str, subprocess.Popen]] = []
    try:
        for name, command, cwd in services:
            procs.append(
                (name, subprocess.Popen(command, cwd=cwd, env=ENV, start_new_session=os.name != "nt"))
            )
        print("Starting API http://127.0.0.1:8000/docs and UI http://127.0.0.1:5173", flush=True)
        print(
            "Readiness: python3 tasks.py doctor. Dev does not import logs, train models or run verification.",
            flush=True,
        )
        print("Ctrl+C stops API/workers/UI. Docker and its persistent database remain running.", flush=True)
        while True:
            for name, proc in procs:
                code = proc.poll()
                if code is not None:
                    raise RuntimeError(
                        f"{name} exited unexpectedly (exit {code}). Stopping the other dev processes."
                    )
            time.sleep(0.25)
    except KeyboardInterrupt:
        print("\nStopping dev processes; database data is preserved.", flush=True)
    finally:
        for _, proc in reversed(procs):
            stop_process(proc)


def target_doctor(**_: str) -> None:
    run([PY, "-m", "scripts.verification", "doctor"])


def _verify(profile: str, kw: dict[str, str]) -> None:
    command = [PY, "-m", "scripts.verification", profile]
    if kw.get("HEADED") == "1":
        command.append("--headed")
    if profile == "live":
        command += [
            "--run-id",
            kw.get("RUN_ID", ""),
            "--base-url",
            kw.get("BASE_URL", "http://127.0.0.1:5173"),
        ]
    run(command)


def target_verify(**kw: str) -> None:
    _verify("full", kw)


def target_verify_frontend(**kw: str) -> None:
    _verify("frontend", kw)


def target_verify_backend(**kw: str) -> None:
    _verify("backend", kw)


def target_verify_live(**kw: str) -> None:
    _verify("live", kw)


def target_verify_report(**_: str) -> None:
    report_dir = ROOT / "reports" / "verification"
    if not (report_dir / "index.html").exists():
        raise RuntimeError("No verification report yet. Run verify-frontend or verify first.")
    print("Reports only: http://127.0.0.1:8765 · Ctrl+C stops the server", flush=True)
    run([PY, "-m", "http.server", "8765", "--bind", "127.0.0.1", "--directory", str(report_dir)])


def target_import(**kw: str) -> None:
    args = [PY, "-m", "scripts.import_dataset"]
    if kw.get("DATASET_PATH"):
        args += ["--path", kw["DATASET_PATH"]]
    run(args)


def target_train(**kw: str) -> None:
    run([PY, "-m", "ml.train", *_passthrough(kw)])


def target_calibrate(**kw: str) -> None:
    run([PY, "-m", "ml.calibrate", *_passthrough(kw)])


def target_evaluate(**kw: str) -> None:
    run([PY, "-m", "ml.evaluate", *_passthrough(kw)])


def target_replay_demo(**kw: str) -> None:
    run([PY, "-m", "scripts.replay_demo", *_passthrough(kw)])


def target_investigate(**_: str) -> None:
    run([PY, "-m", "scripts.investigate"])


def target_demo_inject(**kw: str) -> None:
    """Labelled fault injection: submit an invalid AI proposal for a real incident and show the rejection."""
    args = [PY, "-m", "scripts.inject_invalid_claim", "--run-id", kw["RUN_ID"]]
    if kw.get("INCIDENT_ID"):
        args += ["--incident-id", kw["INCIDENT_ID"]]
    run(args)


def target_test(**kw: str) -> None:
    extra = shlex.split(kw.get("ARGS", ""))
    run([PY, "-m", "pytest", *extra])


def target_benchmark(**kw: str) -> None:
    run([PY, "-m", "scripts.benchmark", *_passthrough(kw)])


def target_lint(**_: str) -> None:
    run([PY, "-m", "ruff", "check", "backend", "ml", "scripts", "tests", "tasks.py"])
    run([PY, "-m", "ruff", "format", "--check", "backend", "ml", "scripts", "tests", "tasks.py"], check=False)
    npm("run", "lint")


def target_typecheck(**_: str) -> None:
    run([PY, "-m", "mypy"], cwd=ROOT)
    npm("run", "typecheck")


def target_build(**_: str) -> None:
    target_lint()
    target_typecheck()
    npm("run", "build")


def _passthrough(kw: dict[str, str]) -> list[str]:
    out: list[str] = []
    for k, v in kw.items():
        if k in {"ACTIVATE", "NO_DRIVE"}:
            if v.lower() in {"1", "true", "yes"}:
                out.append(f"--{k.lower().replace('_', '-')}")
            elif v.lower() not in {"0", "false", "no"}:
                raise ValueError(f"{k} must be 1 or 0")
            continue
        out += [f"--{k.lower().replace('_', '-')}", v]
    return out


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    name = argv[0].replace("-", "_")
    fn = globals().get(f"target_{name}")
    if fn is None:
        print(f"unknown target {argv[0]}", file=sys.stderr)
        return 2
    kw = dict(a.split("=", 1) for a in argv[1:] if "=" in a)
    try:
        fn(**kw)
    except subprocess.CalledProcessError as exc:
        return exc.returncode
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"Cannot continue: {exc}\nRun python3 tasks.py doctor for prerequisites.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
