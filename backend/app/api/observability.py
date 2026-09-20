"""Explicit operator-only diagnostics; never reads investigation data."""

from typing import Any

from fastapi import APIRouter, Depends

from app.api.deps import require_operator
from app.observability import sentry

router = APIRouter(tags=["observability"])


@router.post("/observability/check", dependencies=[Depends(require_operator)])
def check() -> dict[str, Any]:
    return {**sentry.diagnostic(), "delivery_verified": False}
