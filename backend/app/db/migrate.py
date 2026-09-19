"""Programmatic Alembic runner used by the CLI, tests and readiness checks."""
from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine

from app.db.engine import normalize_url

BACKEND_DIR = Path(__file__).resolve().parents[2]


def alembic_config(database_url: str) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "app" / "db" / "migrations"))
    cfg.set_main_option("app.database_url", normalize_url(database_url))
    return cfg


def upgrade(database_url: str, revision: str = "head") -> None:
    command.upgrade(alembic_config(database_url), revision)


def downgrade(database_url: str, revision: str = "base") -> None:
    command.downgrade(alembic_config(database_url), revision)


def current_and_head(database_url: str) -> tuple[str | None, str | None]:
    cfg = alembic_config(database_url)
    head = ScriptDirectory.from_config(cfg).get_current_head()
    engine = create_engine(normalize_url(database_url).replace("postgresql://", "postgresql+psycopg://", 1))
    try:
        with engine.connect() as conn:
            current = MigrationContext.configure(conn).get_current_revision()
    finally:
        engine.dispose()
    return current, head
