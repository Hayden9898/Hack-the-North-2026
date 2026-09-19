"""Slack incoming-webhook adapter with explicit outcome classes. Never called inside a detector transaction."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

log = logging.getLogger("logorder.slack")


@dataclass(frozen=True)
class DeliveryResult:
    outcome: str  # sent | retry | failed | ambiguous | preview
    http_status: int | None = None
    retry_after_seconds: float | None = None
    error: str | None = None


class SlackWebhookAdapter:
    def __init__(self, webhook_url: str, timeout: float = 10.0, client: httpx.Client | None = None) -> None:
        self._url = webhook_url
        self._client = client or httpx.Client(timeout=timeout)

    def deliver(self, payload: dict[str, Any]) -> DeliveryResult:
        body = {"text": payload.get("text", ""), "blocks": payload.get("blocks")}
        try:
            resp = self._client.post(self._url, json=body)
        except httpx.TimeoutException as exc:
            # The request may have been accepted remotely: duplicate delivery is possible on retry.
            return DeliveryResult("ambiguous", None, None, f"timeout: {type(exc).__name__}")
        except httpx.HTTPError as exc:
            return DeliveryResult("retry", None, None, f"transport: {type(exc).__name__}")
        if 200 <= resp.status_code < 300:
            return DeliveryResult("sent", resp.status_code)
        if resp.status_code == 429:
            ra = resp.headers.get("Retry-After")
            try:
                retry_after = float(ra) if ra else 30.0
            except ValueError:
                retry_after = 30.0
            return DeliveryResult("retry", 429, retry_after, "rate limited")
        if resp.status_code >= 500:
            return DeliveryResult("retry", resp.status_code, None, f"server error {resp.status_code}")
        # Permanent configuration/request failures: 400 invalid_payload, 403 action_prohibited, 404 channel_not_found, 410 gone …
        return DeliveryResult("failed", resp.status_code, None, f"permanent {resp.status_code}: {resp.text[:120]}")


class PreviewAdapter:
    """Renders and records the message; nothing leaves the application."""

    def deliver(self, payload: dict[str, Any]) -> DeliveryResult:
        return DeliveryResult("preview", None)
