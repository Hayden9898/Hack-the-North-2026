"""Deterministic Slack payloads. No AI output, no secrets, links only from the trusted APP_BASE_URL."""
from __future__ import annotations

from typing import Any

CLASS_LABEL = {"high_risk": "HIGH RISK", "suspicious": "SUSPICIOUS", "normal": "NORMAL"}


def build_payload(
    *,
    run_id: str,
    incident_id: str,
    version: int,
    threat_class: str,
    account: str | None,
    ip: str | None,
    first_time: str,
    last_time: str,
    rule_ids: list[str],
    summary: dict[str, Any],
    app_base_url: str,
    kind: str,
    event_count: int = 1,
    replay: bool = False,
) -> dict[str, Any]:
    link = f"{app_base_url.rstrip('/')}/runs/{run_id}/incidents/{incident_id}"
    facts = summary.get("lines", [])[:3]
    label = "[HISTORICAL REPLAY] " if replay else ""
    title = f"{label}{CLASS_LABEL.get(threat_class, threat_class)} · incident {incident_id[:8]} v{version} · {', '.join(rule_ids)}"
    text_lines = [title, summary.get("headline", ""), f"account={account} source={ip} first={first_time} last={last_time} events={event_count}"]
    text_lines += [f"- {f}" for f in facts]
    text_lines.append(f"Qualifier: {summary.get('qualifier', '')}")
    text_lines.append(f"Open in Log & Order: {link}")
    return {
        "kind": kind,
        "text": "\n".join(text_lines),
        "blocks": [
            {"type": "header", "text": {"type": "plain_text", "text": title[:150]}},
            {"type": "section", "text": {"type": "mrkdwn", "text": "\n".join([summary.get("headline", ""), *[f"• {f}" for f in facts]])[:2900]}},
            {"type": "context", "elements": [{"type": "mrkdwn", "text": f"account `{account}` · source `{ip}` · {first_time} → {last_time} · {event_count} event(s)"}]},
            {"type": "section", "text": {"type": "mrkdwn", "text": f"_{summary.get('qualifier', '')}_\n<{link}|Open incident>"}},
        ],
        "meta": {"run_id": run_id, "incident_id": incident_id, "version": version, "class": threat_class, "rule_ids": rule_ids},
    }
