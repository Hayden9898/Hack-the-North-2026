"""Run the API with uvicorn bound to the configured (loopback by default) address.

Platforms that assign a port (Railway, Fly, Heroku) set PORT; it wins over API_PORT so one image works everywhere.
"""
from __future__ import annotations

import os
import sys

import uvicorn

from app.settings import get_settings


def main() -> None:
    s = get_settings()
    missing = [name for name, value in (("APP_AUTH_SECRET", s.app_auth_secret), ("INGEST_TOKEN", s.ingest_token)) if not value]
    if not s.loopback_only and missing:
        # Every mutation would answer 503 (deps.require_operator / require_ingest_token); fail fast and say why.
        sys.exit(
            f"refusing to bind API_HOST={s.api_host}: {', '.join(missing)} not configured; "
            "set APP_AUTH_SECRET and INGEST_TOKEN for a non-loopback bind"
        )
    port = int(os.environ.get("PORT") or s.api_port)
    uvicorn.run(
        "app.api.main:app",
        host=s.api_host,
        port=port,
        reload=False,
        log_level="info",
        # Behind the platform's TLS proxy: trust the forwarded scheme/host so redirects and links stay https.
        proxy_headers=True,
        forwarded_allow_ips="*" if not s.loopback_only else None,
    )


if __name__ == "__main__":
    main()
