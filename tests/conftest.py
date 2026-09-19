"""Shared fixtures. Integration/e2e tests use a real TimescaleDB (TEST_DATABASE_URL); they fail loudly when it
is unreachable rather than silently skipping, unless LOGORDER_ALLOW_SKIP_DB=1 is set explicitly."""
from __future__ import annotations

import os
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))

from app.db import migrate  # noqa: E402
from app.db.engine import close_pools, connect_direct, ping  # noqa: E402
from app.settings import get_settings  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"

TRUNCATE_ORDER = [
    "analyst_feedback",
    "ui_updates",
    "notification_outbox",
    "explanations",
    "explanation_jobs",
    "fact_packets",
    "incident_relations",
    "incident_evidence",
    "incident_versions",
    "incidents",
    "rule_matches",
    "processed_events",
    "detections",
    "feature_snapshots",
    "entity_stats",
    "run_late_events",
    "run_events",
    "runs",
    "models",
    "ingestion_rejects",
    "raw_events",
    "event_registry",
    "datasets",
]


def _needs_db(request: pytest.FixtureRequest) -> bool:
    return any(m.name in ("integration", "e2e") for m in request.node.iter_markers())


@pytest.fixture(scope="session")
def test_db_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL") or get_settings().test_database_url
    ok, detail = ping(url)
    if not ok:
        if os.environ.get("LOGORDER_ALLOW_SKIP_DB") == "1":
            pytest.skip(f"test database unavailable ({detail}); skipped explicitly via LOGORDER_ALLOW_SKIP_DB=1")
        pytest.fail(f"test database unavailable at TEST_DATABASE_URL ({detail}). Start it with `docker compose up -d db`.")
    migrate.upgrade(url)
    return url


@pytest.fixture
def db(test_db_url: str) -> Iterator[str]:
    """Clean database per test. Yields the URL; tests open their own connections."""
    _truncate(test_db_url)
    yield test_db_url
    close_pools()


def _truncate(url: str) -> None:
    with connect_direct(url) as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE " + ", ".join(TRUNCATE_ORDER) + " CASCADE")
        conn.commit()


@pytest.fixture
def dataset_path() -> Path:
    p = Path(os.environ.get("DATASET_PATH") or get_settings().dataset_path)
    if not p.exists():
        pytest.fail(f"supplied dataset not found at {p}; set DATASET_PATH")
    return p
