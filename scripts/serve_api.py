"""Run the API with uvicorn bound to the configured (loopback by default) address."""
from __future__ import annotations

import uvicorn

from app.settings import get_settings


def main() -> None:
    s = get_settings()
    uvicorn.run("app.api.main:app", host=s.api_host, port=s.api_port, reload=False, log_level="info")


if __name__ == "__main__":
    main()
