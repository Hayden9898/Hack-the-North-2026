#!/usr/bin/env python
"""Cross-platform task runner mirroring the Makefile targets (make is not always available on Windows).

Usage: python tasks.py <target> [KEY=VALUE ...]
Targets: dev migrate import train calibrate evaluate replay-demo test benchmark build lint typecheck db-up db-down investigate demo-inject
"""
from __future__ import annotations

import os
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_PY = ROOT / ".venv" / ("Scripts" if os.name == "nt" else "bin") / ("python.exe" if os.name == "nt" else "python")
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
    target_db_up()
    run([PY, "-m", "scripts.wait_for_db"])
    target_migrate()
    procs = [
        subprocess.Popen([PY, "-m", "scripts.serve_api"], cwd=ROOT, env=ENV),
        subprocess.Popen([PY, "-m", "app.workers.detector"], cwd=ROOT, env=ENV),
        subprocess.Popen([PY, "-m", "app.workers.side_effects"], cwd=ROOT, env=ENV),
        subprocess.Popen(["npm.cmd" if os.name == "nt" else "npm", "run", "dev"], cwd=ROOT / "frontend", env=ENV),
    ]
    print("API http://127.0.0.1:8000/docs  UI http://127.0.0.1:5173  (Ctrl+C stops everything)", flush=True)
    try:
        for p in procs:
            p.wait()
    except KeyboardInterrupt:
        for p in procs:
            p.terminate()


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
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
