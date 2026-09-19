"""Shared helpers for integration/e2e tests: per-test config dirs, synthetic imports and synchronous replay."""
from __future__ import annotations

import shutil
from datetime import date, datetime
from pathlib import Path
from typing import Any

import yaml

from app.config import DetectionConfig, load_config
from app.db.engine import connect_direct
from app.ingest.importer import import_dataset
from app.settings import REPO_ROOT
from app.workers import runs as runs_mod
from app.workers.detector import Detector
from tests.fixtures.synth import World


def make_config(tmp_path: Path, bootstrap: tuple[date, date], train: tuple[date, date], calibration: tuple[date, date],
                evaluation: tuple[date, date], policy_overrides: dict[str, Any] | None = None) -> DetectionConfig:
    cdir = tmp_path / "config"
    cdir.mkdir(exist_ok=True)
    src = REPO_ROOT / "config"
    shutil.copy(src / "routes.yaml", cdir / "routes.yaml")
    shutil.copy(src / "playbooks.yaml", cdir / "playbooks.yaml")
    policy = yaml.safe_load((src / "policy.yaml").read_text(encoding="utf-8"))
    for k, v in (policy_overrides or {}).items():
        _deep_set(policy, k, v)
    (cdir / "policy.yaml").write_text(yaml.safe_dump(policy), encoding="utf-8")
    parts = {
        "version": 1,
        "dataset_sha256": None,
        "utc_offset_minutes": -240,
        "partitions": {
            "bootstrap": {"start": bootstrap[0].isoformat(), "end_exclusive": bootstrap[1].isoformat()},
            "train": {"start": train[0].isoformat(), "end_exclusive": train[1].isoformat()},
            "calibration": {"start": calibration[0].isoformat(), "end_exclusive": calibration[1].isoformat()},
            "evaluation": {"start": evaluation[0].isoformat(), "end_exclusive": evaluation[1].isoformat()},
        },
    }
    (cdir / "partitions.yaml").write_text(yaml.safe_dump(parts), encoding="utf-8")
    return load_config(cdir)


def _deep_set(d: dict[str, Any], dotted: str, value: Any) -> None:
    keys = dotted.split(".")
    for k in keys[:-1]:
        d = d.setdefault(k, {})
    d[keys[-1]] = value


def import_world(w: World, tmp_path: Path, db_url: str, name: str = "synth.log") -> str:
    p = tmp_path / name
    p.write_text(w.render(), encoding="utf-8")
    res = import_dataset(p, db_url)
    assert res.import_state == "ready", res
    assert res.rejected_count == 0, res
    return res.dataset_id


def start_run(db_url: str, cfg: DetectionConfig, dataset_id: str, **kw: Any) -> str:
    kw.setdefault("speed", 0)  # unbounded fast-forward unless a test exercises the virtual clock
    with connect_direct(db_url) as conn:
        run = runs_mod.create_run(conn, cfg, dataset_id=dataset_id, **kw)
        runs_mod.control(conn, run["run_id"], "start")
        conn.commit()
        return run["run_id"]


def drive(db_url: str, cfg: DetectionConfig, run_id: str, max_steps: int = 10_000, fault_hook=None) -> dict[str, Any]:
    """Run admission + processing synchronously until the run is completed/blocked/paused with an empty backlog."""
    det = Detector(db_url, cfg, fault_hook=fault_hook)
    conn = connect_direct(db_url)
    try:
        for _ in range(max_steps):
            det.step(conn, run_id)
            run = runs_mod.get_run(conn, run_id)
            conn.commit()
            assert run is not None
            if run["state"] in ("completed", "blocked"):
                return run
            if run["state"] == "paused" and run["admitted_seq"] == run["processed_seq"]:
                return run
        raise AssertionError("run did not finish within step budget")
    finally:
        conn.close()


def q(db_url: str, sql: str, *args: Any) -> list[dict[str, Any]]:
    with connect_direct(db_url) as conn, conn.cursor() as cur:
        cur.execute(sql, args)
        return [dict(r) for r in cur.fetchall()]


def local(dt: datetime) -> datetime:
    return dt
