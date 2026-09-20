"""FastAPI application factory. Business logic lives in the domain packages, not in routers."""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from app.api import health
from app.db.engine import close_pools
from app.observability import sentry
from app.settings import Settings, get_settings

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
        allow_headers=["Content-Type", "Authorization", "X-Ingest-Token", "Last-Event-ID", "sentry-trace", "baggage"],
    )
    app.include_router(health.router)
    _include_optional_routers(app)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Never leak secrets or stack traces to clients; keep the class name for diagnostics.
        sentry.capture_exception(exc, path=request.url.path)
        return JSONResponse(status_code=500, content={"error": "internal_error", "type": type(exc).__name__})

    _mount_frontend(app, settings)  # last: API routes always win over the SPA fallback
    return app


def _mount_frontend(app: FastAPI, settings: Settings) -> None:
    """Serve the built UI from the API process so a deployed console is same-origin (no CORS, no token in a URL).

    Absent in development (Vite serves and proxies instead) and whenever STATIC_DIR holds no build.
    """
    if not settings.static_dir:
        return
    dist = Path(settings.static_dir).resolve()
    index = dist / "index.html"
    if not index.is_file():
        log.info("no built frontend at %s; serving the API only", dist)
        return
    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> Response:
        # Unknown API paths stay JSON 404s; everything else is the single-page app.
        if path.startswith(("api/", "health/")):
            raise HTTPException(status_code=404, detail="not found")
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    log.info("serving built frontend from %s", dist)


def _include_optional_routers(app: FastAPI) -> None:
    """Routers are added as milestones land; missing modules are not an error during early development."""
    for module_name in ("datasets", "runs", "models", "incidents", "actions", "updates", "analytics", "observability"):
        try:
            module = __import__(f"app.api.{module_name}", fromlist=["router"])
        except ImportError:
            continue
        app.include_router(module.router, prefix="/api/v1")


app = create_app()
