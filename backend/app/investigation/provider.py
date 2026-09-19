"""LLM provider adapter. One configured provider (Anthropic) behind a tiny protocol so tests can script responses.

The adapter only creates messages; the bounded loop, tools and validation live in pipeline.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class Block:
    type: str  # text | tool_use
    text: str = ""
    id: str = ""
    name: str = ""
    input: Any = None


@dataclass
class Reply:
    content: list[Block]
    stop_reason: str
    input_tokens: int = 0
    output_tokens: int = 0
    model: str = ""
    raw: Any = field(default=None, repr=False)


class Explainer(Protocol):
    model_name: str

    def complete(self, *, system: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]], max_tokens: int, timeout_s: float) -> Reply: ...


class AnthropicExplainer:
    """Official Anthropic SDK. Thinking stays at the model default (adaptive); output ceilings come from policy."""

    def __init__(self, api_key: str, model: str, effort: str = "low") -> None:
        import anthropic

        self._anthropic = anthropic
        self._client = anthropic.Anthropic(api_key=api_key, max_retries=1)
        self.model_name = model
        self._effort = effort

    def complete(self, *, system: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]], max_tokens: int, timeout_s: float) -> Reply:
        resp = self._client.with_options(timeout=timeout_s).messages.create(
            model=self.model_name,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
            tools=tools,
            output_config={"effort": self._effort},
        )
        blocks: list[Block] = []
        for b in resp.content:
            if b.type == "text":
                blocks.append(Block("text", text=b.text))
            elif b.type == "tool_use":
                blocks.append(Block("tool_use", id=b.id, name=b.name, input=b.input))
        return Reply(
            content=blocks,
            stop_reason=resp.stop_reason or "end_turn",
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
            model=resp.model,
            raw=[{"type": b.type, **({"text": b.text} if b.type == "text" else {"id": b.id, "name": b.name, "input": b.input})} for b in blocks],
        )


def build_explainer(settings: Any) -> Explainer | None:
    if not settings.llm_enabled:
        return None
    if settings.llm_provider != "anthropic":
        raise ValueError(f"unsupported LLM_PROVIDER {settings.llm_provider!r} (v1 supports one provider: anthropic)")
    return AnthropicExplainer(settings.llm_api_key, settings.llm_model)
