from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class Completion:
    text: str
    usage: Usage = field(default_factory=Usage)
    model: str = ""


@dataclass
class Message:
    role: str  # "user" | "assistant"
    content: str


class ProviderError(Exception):
    """A provider call failed. `retryable` marks timeouts, connection errors and 5xx."""

    def __init__(self, message: str, *, retryable: bool, status: int | None = None) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.status = status


class LLMProvider(Protocol):
    name: str
    model: str

    def complete(
        self,
        system: str,
        messages: list[Message],
        json_schema: dict[str, Any] | None,
        max_tokens: int,
        timeout: float,
    ) -> Completion: ...


# The envelope every provider is asked to return. The JDM itself travels as a JSON-encoded
# string: decision-table rows have dynamic keys, which strict structured-output schemas
# cannot express. Stage (a) of validation parses it.
ENVELOPE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "One line describing the rule"},
        "explanation": {"type": "string", "description": "Plain-language explanation of the rule"},
        "jdm": {"type": "string", "description": "The complete JDM document, JSON-encoded"},
    },
    "required": ["summary", "explanation", "jdm"],
    "additionalProperties": False,
}

EXPLAIN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"explanation": {"type": "string"}},
    "required": ["explanation"],
    "additionalProperties": False,
}
