"""FastAPI application factory. Business logic lives in the domain packages, not in routers."""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import health
from app.db.engine import close_pools
from app.observability import sentry
from app.settings import get_settings

log = logging.getLogger("logorder.api")


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    sentry.init("api")
    yield
    close_pools()
    sentry.flush()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Log & Order", version="0.1.0", lifespan=_lifespan, openapi_url="/api/v1/openapi.json")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Authorization", "X-Ingest-Token", "Last-Event-ID"],
    )
    app.include_router(health.router)
    _include_optional_routers(app)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Never leak secrets or stack traces to clients; keep the class name for diagnostics.
        sentry.capture_exception(exc, path=request.url.path)
        return JSONResponse(status_code=500, content={"error": "internal_error", "type": type(exc).__name__})

    return app


def _include_optional_routers(app: FastAPI) -> None:
    """Routers are added as milestones land; missing modules are not an error during early development."""
    for module_name in ("datasets", "runs", "incidents", "updates", "analytics"):
        try:
            module = __import__(f"app.api.{module_name}", fromlist=["router"])
        except ImportError:
            continue
        app.include_router(module.router, prefix="/api/v1")


app = create_app()
