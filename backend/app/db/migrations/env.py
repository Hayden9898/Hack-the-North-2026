"""Alembic environment. The database URL comes from the runtime (never from alembic.ini)."""
from __future__ import annotations

import os

from alembic import context
from sqlalchemy import create_engine

from app.db.engine import normalize_url
from app.settings import get_settings

config = context.config


def _url() -> str:
    url = config.get_main_option("app.database_url") or os.environ.get("ALEMBIC_DATABASE_URL") or get_settings().database_url
    url = normalize_url(url)
    return url.replace("postgresql://", "postgresql+psycopg://", 1)


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=None)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=None, transaction_per_migration=True)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run_migrations_online()
