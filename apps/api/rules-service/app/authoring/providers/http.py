"""HTTP transport hook for provider SDKs. Tests install a mock handler so the real SDK code
paths run without network access. Each SDK gets a client from the HTTP library it is built on
(the Anthropic SDK uses `httpx2`, the OpenAI SDK uses `httpx`)."""

from collections.abc import Callable
from types import ModuleType
from typing import Any

Handler = Callable[[Any], Any]

_handler: Handler | None = None


def set_mock_handler(handler: Handler | None) -> None:
    global _handler
    _handler = handler


def http_client(lib: ModuleType) -> Any:
    if _handler is None:
        return None
    return lib.Client(transport=lib.MockTransport(_handler))
