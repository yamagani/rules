from typing import Any

import httpx
import openai

from app.authoring.providers.base import Completion, Message, ProviderError, Usage
from app.authoring.providers.http import http_client


class OpenAIProvider:
    """OpenAI, Azure OpenAI and OpenAI-compatible endpoints (Ollama, vLLM, LiteLLM) through
    the official SDK's Chat Completions API.

    `structured=True` requests `response_format=json_schema` (strict). Compatible servers
    that do not support it run with `structured=False`: a JSON-only instruction is appended
    and the pipeline extracts the JSON object from the reply.
    """

    def __init__(
        self,
        name: str,
        model: str,
        api_key: str | None,
        base_url: str | None,
        temperature: float,
        *,
        azure_api_version: str | None = None,
        structured: bool = True,
    ) -> None:
        self.name, self.model, self.temperature, self.structured = name, model, temperature, structured
        common: dict[str, Any] = {"max_retries": 0, "http_client": http_client(httpx)}
        if azure_api_version is not None:
            if not base_url:
                raise ProviderError("azure_openai providers need base_url (the Azure endpoint)", retryable=False)
            self._client: openai.OpenAI = openai.AzureOpenAI(
                api_key=api_key, azure_endpoint=base_url, api_version=azure_api_version, **common
            )
        else:
            self._client = openai.OpenAI(api_key=api_key or "not-needed", base_url=base_url, **common)

    def complete(
        self, system: str, messages: list[Message], json_schema: dict[str, Any] | None, max_tokens: int, timeout: float
    ) -> Completion:
        kwargs: dict[str, Any] = {}
        if json_schema is not None:
            if self.structured:
                kwargs["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {"name": "response", "schema": json_schema, "strict": True},
                }
            else:
                system = (
                    f"{system}\n\nRespond with a single JSON object only, no prose and no code fences, "
                    f"matching this JSON Schema:\n{json_schema}"
                )
        chat = [{"role": "system", "content": system}] + [{"role": m.role, "content": m.content} for m in messages]
        try:
            resp = self._client.chat.completions.create(
                model=self.model,
                messages=chat,  # type: ignore[arg-type]
                max_completion_tokens=max_tokens,
                temperature=self.temperature,
                timeout=timeout,
                **kwargs,
            )
        except openai.APITimeoutError as exc:
            raise ProviderError("provider timed out", retryable=True) from exc
        except openai.APIConnectionError as exc:
            raise ProviderError(f"connection error: {exc}", retryable=True) from exc
        except openai.APIStatusError as exc:
            raise ProviderError(
                f"provider returned HTTP {exc.status_code}: {exc.message}",
                retryable=exc.status_code >= 500 or exc.status_code in (408, 429),
                status=exc.status_code,
            ) from exc
        text = resp.choices[0].message.content or "" if resp.choices else ""
        usage = resp.usage
        return Completion(
            text=text,
            usage=Usage(usage.prompt_tokens if usage else 0, usage.completion_tokens if usage else 0),
            model=resp.model or self.model,
        )
