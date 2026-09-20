"""Start the Railway API or worker role without config-time shell interpolation."""
from __future__ import annotations

import os
import sys


def main() -> int:
    role = os.environ.get("SERVICE_ROLE", "api").strip().lower()
    if role == "worker":
        from scripts import serve_worker, wait_for_db

        if wait_for_db.main() != 0:
            return 1
        return serve_worker.main()
    if role == "api":
        from scripts import migrate, serve_api

        if migrate.main() != 0:
            return 1
        serve_api.main()
        return 0
    print(f"unknown SERVICE_ROLE: {role!r}; expected 'api' or 'worker'", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
