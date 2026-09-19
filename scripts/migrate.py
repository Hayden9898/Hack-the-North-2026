"""Apply migrations to DATABASE_URL (and TEST_DATABASE_URL when reachable)."""
from __future__ import annotations

import sys

from app.db import migrate
from app.db.engine import ping
from app.settings import get_settings


def main() -> int:
    s = get_settings()
    ok, detail = ping(s.database_url)
    if not ok:
        print(f"database unavailable: {detail}", file=sys.stderr)
        return 1
    migrate.upgrade(s.database_url)
    print("migrated", migrate.current_and_head(s.database_url))
    ok, _ = ping(s.test_database_url)
    if ok:
        migrate.upgrade(s.test_database_url)
        print("migrated test db", migrate.current_and_head(s.test_database_url))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
