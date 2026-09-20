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
    # An unset TEST_DATABASE_URL means "no test database here" (the normal case for a deployment). It must not
    # fall through to the default connection parameters, which would migrate the main database a second time.
    test_url = s.test_database_url.strip()
    if not test_url:
        print("no TEST_DATABASE_URL configured; skipped")
        return 0
    ok, _ = ping(test_url)
    if ok:
        migrate.upgrade(test_url)
        print("migrated test db", migrate.current_and_head(test_url))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
