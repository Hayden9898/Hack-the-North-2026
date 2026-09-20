"""Safety checks shared by the verification runner and destructive test fixtures."""

from __future__ import annotations

import os
from urllib.parse import unquote, urlsplit

TEST_LOCK_ID = 627043611337


def validate_test_database(test_url: str, application_url: str, *, allow_remote: bool = False) -> None:
    """Refuse ambiguous/production targets before opening a connection or truncating tables."""

    def identity(url: str) -> tuple[str, int, str]:
        parsed = urlsplit(url.replace("postgresql+psycopg://", "postgresql://", 1))
        if parsed.scheme not in {"postgresql", "postgres"} or not parsed.hostname or parsed.query:
            raise ValueError("Use an explicit PostgreSQL test URL without query overrides.")
        host = parsed.hostname.lower()
        if host in {"localhost", "127.0.0.1", "::1"}:
            host = "loopback"
        return host, parsed.port or 5432, unquote(parsed.path.lstrip("/"))

    target = identity(test_url)
    # Production URLs may carry TLS options. They cannot change the database identity.
    app = urlsplit(application_url)
    app_identity = identity(app._replace(query="").geturl())
    if target == app_identity:
        raise ValueError("TEST_DATABASE_URL must not point to the application database.")
    if not target[2].endswith("_test"):
        raise ValueError("Destructive tests require a dedicated database whose name ends in _test.")
    if target[0] != "loopback" and not allow_remote:
        raise ValueError("Remote test databases require explicit LOGORDER_ALLOW_REMOTE_TEST_DB=1.")


def check() -> int:
    from app.db.engine import ping
    from app.settings import get_settings

    settings = get_settings()
    try:
        validate_test_database(
            settings.test_database_url,
            settings.database_url,
            allow_remote=os.environ.get("LOGORDER_ALLOW_REMOTE_TEST_DB") == "1",
        )
    except ValueError as exc:
        print(str(exc))
        return 1
    ok, detail = ping(settings.test_database_url)
    if not ok or not detail.startswith("timescaledb "):
        print(
            "Dedicated test database is unavailable or TimescaleDB is not initialized. Run db-up and migrate."
        )
        return 1
    print(
        "Dedicated test database is reachable. Its tables are disposable; application data is out of scope."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(check())
