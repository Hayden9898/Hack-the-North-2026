"""Fit one pooled Isolation Forest on the training partition of a completed causal run; calibrate the threshold on the
calibration partition; write a manifest + artifact + calibration scores; register the model as a candidate.

Never touches evaluation-partition data. Only artifacts written here are ever loaded by the detector."""
from __future__ import annotations

import argparse
import json
import platform
import time
from datetime import UTC, datetime
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import IsolationForest

from app.config import get_config
from app.db.engine import connect_direct, jsonb
from app.detection.novelty import fit_envelope
from app.features.vector import FEATURE_NAMES, FEATURE_VERSION
from app.settings import get_settings
from ml.common import anomaly_scores, load_matrix, pick_source_run, sha256_file


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source-run", default=None, help="completed replay run providing causal feature snapshots")
    ap.add_argument("--model-id", default=None)
    ap.add_argument("--percentile", type=float, default=None, help="calibration percentile for the threshold (default: policy)")
    ap.add_argument("--database-url", default=None)
    args = ap.parse_args()
    settings = get_settings()
    cfg = get_config()
    mcfg = cfg.policy["model"]
    pct = float(args.percentile if args.percentile is not None else mcfg["calibration_percentile"])
    model_dir = Path(settings.model_dir)
    model_id = args.model_id or f"if_{FEATURE_VERSION}_{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}"
    out = model_dir / model_id
    out.mkdir(parents=True, exist_ok=False)

    conn = connect_direct(args.database_url or settings.database_url)
    run = pick_source_run(conn, args.source_run, cfg)
    train = load_matrix(conn, run["run_id"], cfg, "train")
    cal = load_matrix(conn, run["run_id"], cfg, "calibration")
    print(f"source run {run['run_id']} train={train.X.shape} calibration={cal.X.shape}")

    t0 = time.perf_counter()
    est = IsolationForest(
        n_estimators=int(mcfg["n_estimators"]),
        max_samples=mcfg["max_samples"],
        contamination=mcfg["contamination"],
        random_state=int(mcfg["random_state"]),
        n_jobs=int(mcfg.get("n_jobs", 1)),
    )
    est.fit(train.X)
    fit_s = time.perf_counter() - t0
    cal_scores = anomaly_scores(est, cal.X)
    train_scores = anomaly_scores(est, train.X)
    candidates = {str(p): float(np.percentile(cal_scores, p)) for p in mcfg["candidate_percentiles"]}
    threshold = float(np.percentile(cal_scores, pct))
    burden = {p: int((cal_scores > t).sum()) for p, t in candidates.items()}
    ties = int((cal_scores == threshold).sum())
    cal_days = max(1, (cfg.partitions["calibration"].end_exclusive - cfg.partitions["calibration"].start).days)

    # Second channel: the bounded dimensions the forest provably cannot use. Fitted on the train
    # partition only, and its burden measured on calibration, exactly like the density threshold.
    ncfg = cfg.policy.get("novelty", {"enabled": False, "max_cardinality": 4})
    envelope = fit_envelope(train.X, FEATURE_NAMES, FEATURE_VERSION, int(ncfg["max_cardinality"]))
    nov_cal = envelope.score_matrix(cal.X)
    nov_train = envelope.score_matrix(train.X)
    split_counts = np.zeros(train.X.shape[1], dtype=int)
    for e in est.estimators_:
        f = e.tree_.feature
        split_counts[f[f >= 0]] += 1
    unreachable = [n for i, n in enumerate(FEATURE_NAMES) if split_counts[i] == 0]

    artifact = out / "isolation_forest.joblib"
    joblib.dump(est, artifact)
    cal_file = out / "calibration_scores.json"
    cal_file.write_text(json.dumps([float(x) for x in cal_scores]), encoding="utf-8")
    env_file = out / "support_envelope.json"
    env_file.write_text(json.dumps(envelope.to_dict(), indent=2), encoding="utf-8")
    manifest = {
        "generator": "logorder.ml.train",
        "model_id": model_id,
        "algorithm": "IsolationForest",
        "params": {k: mcfg[k] for k in ("n_estimators", "max_samples", "contamination", "random_state")},
        "feature_version": FEATURE_VERSION,
        "feature_names": list(FEATURE_NAMES),
        "config_hash": cfg.config_hash,
        "reference_hash": (run["config"] or {}).get("reference_hash"),
        "source_run_id": run["run_id"],
        "dataset_id": run["dataset_id"],
        "partitions": {k: {"start": v.start.isoformat(), "end_exclusive": v.end_exclusive.isoformat()} for k, v in cfg.partitions.partitions.items()},
        "train_rows": int(train.X.shape[0]),
        "calibration_rows": int(cal.X.shape[0]),
        "artifact_file": artifact.name,
        "artifact_sha256": sha256_file(artifact),
        "calibration_scores_file": cal_file.name,
        "support_envelope_file": env_file.name,
        "novelty": {
            "enabled": bool(ncfg.get("enabled", False)),
            "max_cardinality": int(ncfg["max_cardinality"]),
            "bounded_features": sorted(envelope.bounded_values),
            "weight_per_violated_dim": envelope.weight,
            # A channel that fires during the window it was fitted on would be measuring drift, not
            # novelty. Both numbers below are expected to be zero on train and near zero on calibration.
            "train_alerts": int((nov_train > 0).sum()),
            "calibration_alerts": int((nov_cal > 0).sum()),
            "calibration_alerts_per_day": round(float((nov_cal > 0).sum()) / max(1, (cfg.partitions["calibration"].end_exclusive - cfg.partitions["calibration"].start).days), 4),
        },
        # Density-channel reachability: a feature with no split in any tree cannot affect the score at
        # inference, whatever value it takes. Recorded so the blind spot is auditable, not folklore.
        "density_feature_reachability": {
            "total_splits": int(split_counts.sum()),
            "features_with_zero_splits": unreachable,
            "splits_by_feature": {n: int(split_counts[i]) for i, n in enumerate(FEATURE_NAMES)},
        },
        "threshold": threshold,
        "threshold_percentile": pct,
        "threshold_ties": ties,
        "candidate_thresholds": candidates,
        "calibration_alert_burden": {p: {"alerts": n, "per_day": round(n / cal_days, 2)} for p, n in burden.items()},
        "train_score_summary": {"min": float(train_scores.min()), "median": float(np.median(train_scores)), "p99": float(np.percentile(train_scores, 99)), "max": float(train_scores.max())},
        "fit_seconds": round(fit_s, 2),
        "dependencies": {"scikit-learn": sklearn.__version__, "numpy": np.__version__, "joblib": joblib.__version__, "python": platform.python_version()},
        "created_at": datetime.now(UTC).isoformat(),
        "evaluation_notes": "March (evaluation partition) was never used for fitting or calibration. Percentile is rarity, not attack probability.",
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO models (model_id, feature_version, artifact_path, artifact_sha256, training_start, training_end, calibration_start,
                   calibration_end, reference_hash, threshold, dependency_versions, manifest, status)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'candidate')""",
            (model_id, FEATURE_VERSION, str(artifact), manifest["artifact_sha256"], cfg.partitions["train"].start, cfg.partitions["train"].end_exclusive,
             cfg.partitions["calibration"].start, cfg.partitions["calibration"].end_exclusive, manifest["reference_hash"], threshold,
             jsonb(manifest["dependencies"]), jsonb(manifest), ),
        )
    conn.commit()
    conn.close()
    summary = {k: manifest[k] for k in ("model_id", "train_rows", "calibration_rows", "threshold", "threshold_percentile", "threshold_ties", "candidate_thresholds", "calibration_alert_burden", "fit_seconds", "artifact_sha256")}
    summary["novelty"] = manifest["novelty"]
    summary["density_features_with_zero_splits"] = unreachable
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
