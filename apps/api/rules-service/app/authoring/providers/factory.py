from app.authoring import secrets
from app.authoring.providers.anthropic_provider import AnthropicProvider
from app.authoring.providers.base import LLMProvider, ProviderError
from app.authoring.providers.mock import MockProvider
from app.authoring.providers.openai_provider import OpenAIProvider
from app.models import AiProvider, ProviderType

DEFAULT_AZURE_API_VERSION = "2024-10-21"


def build_provider(row: AiProvider) -> LLMProvider:
    try:
        api_key = secrets.resolve(row.api_key_ref)
    except secrets.SecretError as exc:
        # The message names the reference, never a value.
        raise ProviderError(
            f"API key reference for '{row.name}' could not be resolved: {exc}", retryable=False
        ) from exc
    options = row.options or {}
    match row.type:
        case ProviderType.mock:
            return MockProvider(row.name, row.model)
        case ProviderType.anthropic:
            return AnthropicProvider(row.name, row.model, api_key, row.base_url)
        case ProviderType.openai:
            return OpenAIProvider(row.name, row.model, api_key, row.base_url, row.temperature)
        case ProviderType.azure_openai:
            return OpenAIProvider(
                row.name,
                row.model,
                api_key,
                row.base_url,
                row.temperature,
                azure_api_version=str(options.get("api_version", DEFAULT_AZURE_API_VERSION)),
            )
        case ProviderType.openai_compatible:
            if not row.base_url:
                raise ProviderError("openai_compatible providers need base_url", retryable=False)
            return OpenAIProvider(
                row.name,
                row.model,
                api_key,
                row.base_url,
                row.temperature,
                structured=bool(options.get("structured_outputs", False)),
            )
    raise ProviderError(f"unsupported provider type {row.type}", retryable=False)
