from typing import Any

import anthropic
import httpx2

from app.authoring.providers.base import Completion, Message, ProviderError, Usage
from app.authoring.providers.http import http_client


class AnthropicProvider:
    """Claude via the official SDK, using structured outputs (`output_config.format`).

    The current Messages API takes no sampling parameters, so the provider's `temperature`
    setting does not apply here (see docs/DECISIONS.md D-121).
    """

    def __init__(self, name: str, model: str, api_key: str | None, base_url: str | None) -> None:
        self.name, self.model = name, model
        self._client = anthropic.Anthropic(
            api_key=api_key or "missing", base_url=base_url, max_retries=0, http_client=http_client(httpx2)
        )

    def complete(
        self, system: str, messages: list[Message], json_schema: dict[str, Any] | None, max_tokens: int, timeout: float
    ) -> Completion:
        kwargs: dict[str, Any] = {}
        if json_schema is not None:
            kwargs["output_config"] = {"format": {"type": "json_schema", "schema": json_schema}}
        try:
            resp = self._client.messages.create(
                model=self.model,
                system=system,
                messages=[{"role": m.role, "content": m.content} for m in messages],  # type: ignore[misc]
                max_tokens=max_tokens,
                timeout=timeout,
                **kwargs,
            )
        except anthropic.APITimeoutError as exc:
            raise ProviderError("provider timed out", retryable=True) from exc
        except anthropic.APIConnectionError as exc:
            raise ProviderError(f"connection error: {exc}", retryable=True) from exc
        except anthropic.APIStatusError as exc:
            raise ProviderError(
                f"provider returned HTTP {exc.status_code}: {exc.message}",
                retryable=exc.status_code >= 500 or exc.status_code in (408, 429),
                status=exc.status_code,
            ) from exc
        text = "".join(getattr(block, "text", "") for block in resp.content)
        return Completion(
            text=text,
            usage=Usage(resp.usage.input_tokens, resp.usage.output_tokens),
            model=resp.model,
        )
