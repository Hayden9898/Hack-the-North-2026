"""Database access: one psycopg connection pool per process, explicit transactions."""
from __future__ import annotations

import contextlib
from collections.abc import Iterator
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from app.settings import get_settings

_pools: dict[str, ConnectionPool] = {}


def normalize_url(url: str) -> str:
    # SQLAlchemy-style prefixes are accepted for convenience.
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def get_pool(url: str | None = None) -> ConnectionPool:
    url = normalize_url(url or get_settings().database_url)
    pool = _pools.get(url)
    if pool is None:
        pool = ConnectionPool(
            url,
            min_size=1,
            max_size=8,
            open=True,
            kwargs={"row_factory": dict_row, "autocommit": False},
            timeout=10,
        )
        _pools[url] = pool
    return pool


def close_pools() -> None:
    for p in _pools.values():
        p.close()
    _pools.clear()


@contextlib.contextmanager
def transaction(url: str | None = None) -> Iterator[psycopg.Connection[Any]]:
    """Yield a connection inside one transaction; commit on success, roll back on error."""
    pool = get_pool(url)
    with pool.connection() as conn:
        try:
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise


def connect_direct(url: str | None = None) -> psycopg.Connection[Any]:
    """A standalone (non-pooled) connection; caller manages lifecycle. Used by workers/tests."""
    return psycopg.connect(normalize_url(url or get_settings().database_url), row_factory=dict_row, autocommit=False)


def jsonb(value: Any) -> Jsonb:
    return Jsonb(value)


def ping(url: str | None = None, timeout: float = 3.0) -> tuple[bool, str]:
    try:
        with psycopg.connect(normalize_url(url or get_settings().database_url), connect_timeout=int(timeout)) as conn:
            with conn.cursor() as cur:
                cur.execute("select extversion from pg_extension where extname='timescaledb'")
                row = cur.fetchone()
                return True, f"timescaledb {row[0]}" if row else "postgres (no timescaledb extension)"
    except Exception as exc:  # noqa: BLE001
        return False, type(exc).__name__


def one(cur: Any) -> Any:
    """fetchone() that fails loudly instead of returning None (for rows that must exist)."""
    row = cur.fetchone()
    if row is None:
        raise LookupError("expected a row")
    return row
