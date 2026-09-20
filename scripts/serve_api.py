"""Run the API with uvicorn bound to the configured (loopback by default) address.

Platforms that assign a port (Railway, Fly, Heroku) set PORT; it wins over API_PORT so one image works everywhere.
"""
from __future__ import annotations

import os

import uvicorn

from app.settings import get_settings


def main() -> None:
    s = get_settings()
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
