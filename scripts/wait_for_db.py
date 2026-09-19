"""Block until the configured database accepts connections (bounded)."""
from __future__ import annotations

import sys
import time

from app.db.engine import ping
from app.settings import get_settings


def main() -> int:
    url = get_settings().database_url
    deadline = time.time() + 60
    while time.time() < deadline:
        ok, detail = ping(url)
        if ok:
            print("database ready:", detail)
            return 0
        time.sleep(1)
    print("database not reachable within 60s", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
