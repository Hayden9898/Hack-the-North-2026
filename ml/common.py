"""Shared helpers for the causal ML pipeline: partition-scoped feature matrices from a completed run's snapshots."""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import psycopg

from app.config import DetectionConfig
from app.detection.preprocess import anomaly_scores as _anomaly_scores
from app.features.vector import FEATURE_NAMES, FEATURE_VERSION


@dataclass
class Matrix:
    X: np.ndarray
    run_seqs: np.ndarray
    event_ids: list[str]
    event_times: list[datetime]
    partition: str


def pick_source_run(conn: psycopg.Connection[Any], run_id: str | None, cfg: DetectionConfig) -> dict[str, Any]:
    """A completed replay run over the dataset whose snapshots cover at least bootstrap..calibration."""
    with conn.cursor() as cur:
        if run_id:
            cur.execute("SELECT * FROM runs WHERE run_id=%s", (run_id,))
        else:
            cur.execute(
                """SELECT r.* FROM runs r WHERE r.mode='replay' AND r.state='completed' AND r.dataset_id IS NOT NULL
                   AND r.config_hash=%s ORDER BY r.created_at DESC""",
                (cfg.config_hash,),
            )
        row = cur.fetchone()
    if row is None:
        if run_id:
            raise SystemExit(f"source run {run_id} does not exist")
        raise SystemExit("no completed replay run with the current config; run `python -m scripts.run_replay` first")
    run = dict(row)
    if run_id:
        # An explicit --source-run gets the same guards as the default query: a partial run has partial snapshots and
        # a run under another config produced vectors the current code would not reproduce.
        if run.get("state") != "completed":
            raise SystemExit(f"source run {run_id} is {run.get('state')!r}, not 'completed'; only completed runs provide usable snapshots")
        if run.get("config_hash") != cfg.config_hash:
            raise SystemExit(f"source run {run_id} was produced under config_hash {run.get('config_hash')} but the current config is "
                             f"{cfg.config_hash}; re-run `python -m scripts.run_replay` under the current config or restore the old one")
        if run.get("dataset_id") is None:
            raise SystemExit(f"source run {run_id} has no dataset")
    with conn.cursor() as cur:
        cur.execute("SELECT max(event_time) m, count(*) n, min(feature_version) fv FROM feature_snapshots WHERE run_id=%s", (run["run_id"],))
        s = cur.fetchone()
    if s["fv"] != FEATURE_VERSION:
        raise SystemExit(f"snapshot feature version {s['fv']} != code {FEATURE_VERSION}")
    if s["m"] is None or s["m"] < cfg.partitions["calibration"].end_exclusive:
        raise SystemExit("source run does not cover the calibration partition")
    return run


def load_matrix(conn: psycopg.Connection[Any], run_id: str, cfg: DetectionConfig, partition: str) -> Matrix:
    part = cfg.partitions[partition]
    with conn.cursor() as cur:
        cur.execute(
            """SELECT run_seq, event_id, event_time, numeric_vector FROM feature_snapshots
               WHERE run_id=%s AND event_time >= %s AND event_time < %s ORDER BY run_seq""",
            (run_id, part.start, part.end_exclusive),
        )
        rows = cur.fetchall()
    if not rows:
        raise SystemExit(f"partition {partition} is empty for run {run_id}")
    X = np.asarray([r["numeric_vector"] for r in rows], dtype=float)
    if X.shape[1] != len(FEATURE_NAMES):
        raise SystemExit("snapshot width does not match feature schema")
    return Matrix(X=X, run_seqs=np.asarray([r["run_seq"] for r in rows]), event_ids=[r["event_id"] for r in rows],
                  event_times=[r["event_time"] for r in rows], partition=partition)


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as fh:
        while chunk := fh.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def anomaly_scores(est: Any, X: np.ndarray) -> np.ndarray:
    """Higher = rarer; forest score plus the preprocessing stage's blind-spot penalty when the artifact carries one."""
    return _anomaly_scores(est, X)


def load_manifest(model_dir: Path, model_id: str) -> dict[str, Any]:
    path = model_dir / model_id / "manifest.json"
    if not path.is_file():
        raise SystemExit(f"no artifact for {model_id} in {model_dir}")
    return json.loads(path.read_text(encoding="utf-8"))


def write_manifest(model_dir: Path, model_id: str, manifest: dict[str, Any]) -> None:
    """Atomic replace so the detector never reads a half-written manifest."""
    target = model_dir / model_id / "manifest.json"
    tmp = target.with_name("manifest.json.tmp")
    tmp.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    os.replace(tmp, target)


def check_config_drift(manifest: dict[str, Any], cfg: DetectionConfig, allow: bool) -> None:
    """The artifact's snapshots were produced under manifest['config_hash']; scoring them under a different config
    silently mixes feature semantics. Exit unless the operator explicitly accepts the drift."""
    trained = manifest.get("config_hash")
    if trained is None or trained == cfg.config_hash:
        return
    msg = f"model {manifest.get('model_id')} was trained under config_hash {trained} but the current config is {cfg.config_hash}"
    if allow:
        print(f"warning: {msg}; proceeding because --allow-config-drift was given")
        return
    raise SystemExit(f"{msg}; restore the training config or pass --allow-config-drift")


def rarity_baseline(X: np.ndarray) -> np.ndarray:
    """Simple statistical baseline: sum of the -log rarity features (pair, route family, hour) plus unfamiliar flag.
    Deliberately naive; it is the bar the Isolation Forest must beat to justify itself."""
    idx = {n: i for i, n in enumerate(FEATURE_NAMES)}
    return X[:, idx["pair_rarity"]] + X[:, idx["acct_family_rarity"]] + X[:, idx["acct_hour_rarity"]] + 3.0 * X[:, idx["pair_unfamiliar"]]
