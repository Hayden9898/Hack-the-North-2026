"""Execution adapters with explicit outcome classes, mirroring the notification adapters.

The default adapter records what would be issued and contacts nothing. A deployment that wants actions to reach a
real system configures ACTION_MODE=live with ACTION_WEBHOOK_URL; the request body is then the same object the
preview shows, so what an operator approved is what is sent.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

log = logging.getLogger("logorder.actions")


@dataclass(frozen=True)
class ActionResult:
    outcome: str  # preview | applied | failed
    adapter: str
    detail: dict[str, Any] = field(default_factory=dict)
    http_status: int | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.outcome in ("preview", "applied")


def build_request(*, phase: str, run_id: str, incident_id: str, version: int, action: dict[str, Any], params: dict[str, Any], params_hash: str, operator: str) -> dict[str, Any]:
    """The exact object a dry run displays and an execute sends. Identical in both phases apart from `phase`."""
    return {
        "schema": "logorder.action/1",
        "phase": phase,
        "action_id": action["action_id"],
        "kind": action["kind"],
        "severity": action["severity"],
        "reversible": action["reversible"],
        "params": params,
        "params_hash": params_hash,
        "incident": {"run_id": run_id, "incident_id": incident_id, "version": version},
        "operator": operator,
        "reversal": action["rollback"],
    }


class PreviewAdapter:
    """Records the request and its stated effect. Nothing leaves the application."""

    name = "preview"

    def apply(self, request: dict[str, Any]) -> ActionResult:
        return ActionResult(
            "preview",
            self.name,
            {
                "applied_to_external_system": False,
                "note": "Recorded as a preview. No external system was contacted; configure ACTION_MODE=live with "
                        "ACTION_WEBHOOK_URL to issue this request for real.",
                "request": request,
            },
        )

    def revert(self, request: dict[str, Any]) -> ActionResult:
        return self.apply({**request, "phase": "rollback"})


class WebhookAdapter:
    """POSTs the request to a remediation endpoint owned by the deployment."""

    name = "webhook"

    def __init__(self, url: str, timeout: float = 10.0, client: httpx.Client | None = None) -> None:
        self._url = url
        self._client = client or httpx.Client(timeout=timeout)

    def apply(self, request: dict[str, Any]) -> ActionResult:
        try:
            resp = self._client.post(self._url, json=request)
        except httpx.TimeoutException as exc:
            # The remote side may have applied it: never report a containment as failed when it may have landed.
            return ActionResult("failed", self.name, {"applied_to_external_system": "unknown"}, None, f"timeout: {type(exc).__name__}")
        except httpx.HTTPError as exc:
            return ActionResult("failed", self.name, {"applied_to_external_system": False}, None, f"transport: {type(exc).__name__}")
        body: Any
        try:
            body = resp.json()
        except ValueError:
            body = resp.text[:500]
        if 200 <= resp.status_code < 300:
            return ActionResult("applied", self.name, {"applied_to_external_system": True, "response": body}, resp.status_code)
        return ActionResult("failed", self.name, {"applied_to_external_system": False, "response": body}, resp.status_code, f"HTTP {resp.status_code}")

    def revert(self, request: dict[str, Any]) -> ActionResult:
        return self.apply({**request, "phase": "rollback"})


def build_adapter(settings: Any) -> Any:
    if getattr(settings, "action_live", False):
        return WebhookAdapter(settings.action_webhook_url)
    return PreviewAdapter()
