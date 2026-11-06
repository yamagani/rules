from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models import ProviderType


class Example(BaseModel):
    name: str | None = None
    input: dict[str, Any]
    expected: dict[str, Any]


class GenerateRequest(BaseModel):
    # TODO(file-extraction): accept uploaded PDF/DOCX policy documents, extract their text and
    # feed it into `context_text` (same delimiters, same size cap). v1 takes pasted text only.
    prompt: str = Field(min_length=1)
    input_schema: dict[str, Any] | None = None
    examples: list[Example] = Field(default_factory=list)
    context_text: str | None = None
    base_version: int | None = None
    provider_id: int | None = None


class ExampleResult(BaseModel):
    name: str
    source: str  # "example" | "test_case"
    passed: bool
    expected: dict[str, Any]
    actual: Any = None
    error: str | None = None
    mismatches: list[str] = []


class AttemptReport(BaseModel):
    attempt: int
    provider: str
    model: str
    ok: bool
    stage: str  # parse | schema | engine | examples | ok
    errors: list[str] = []


class ValidationReport(BaseModel):
    ok: bool
    attempts: list[AttemptReport]
    examples: list[ExampleResult] = []
    passed: int = 0
    failed: int = 0


class GenerateResponse(BaseModel):
    run_id: int
    version: int
    status: str = "draft"
    summary: str
    explanation: str
    provider: str
    model: str
    validation_report: ValidationReport
    usage: dict[str, int]


class ExplainResponse(BaseModel):
    version: int
    explanation: str
    provider: str
    model: str


class ProviderIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: ProviderType
    model: str = Field(min_length=1, max_length=200)
    base_url: str | None = None
    api_key_ref: str | None = Field(None, description="Secret reference such as env:ANTHROPIC_API_KEY; never a raw key")
    max_tokens: int = Field(8000, ge=256, le=64000)
    temperature: float = Field(0.0, ge=0, le=2)
    timeout_s: int = Field(60, ge=5, le=300)
    enabled: bool = False
    monthly_token_budget: int | None = Field(None, ge=0)
    options: dict[str, Any] = Field(default_factory=dict)


class ProviderPatch(BaseModel):
    model: str | None = None
    base_url: str | None = None
    api_key_ref: str | None = None
    max_tokens: int | None = Field(None, ge=256, le=64000)
    temperature: float | None = Field(None, ge=0, le=2)
    timeout_s: int | None = Field(None, ge=5, le=300)
    enabled: bool | None = None
    monthly_token_budget: int | None = None
    options: dict[str, Any] | None = None


class ProviderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    type: ProviderType
    model: str
    base_url: str | None
    api_key_ref: str | None
    key_configured: bool = False
    max_tokens: int
    temperature: float
    timeout_s: int
    enabled: bool
    monthly_token_budget: int | None
    tokens_this_month: int = 0
    options: dict[str, Any]
    created_by: str
    updated_at: datetime


class ConnectionTest(BaseModel):
    ok: bool
    provider: str
    model: str
    latency_ms: int
    error: str | None = None


class AppAiSettingsIn(BaseModel):
    provider_id: int | None = Field(None, description="Defaults to the enabled provider of type AI_DEFAULT_PROVIDER")
    fallback_provider_id: int | None = None


class AppAiSettingsOut(BaseModel):
    enabled: bool
    provider: ProviderOut | None = None
    fallback_provider: ProviderOut | None = None


class UsageBucket(BaseModel):
    key: str
    runs: int
    succeeded: int
    failed: int
    input_tokens: int
    output_tokens: int


class AiUsageOut(BaseModel):
    days: int
    by_provider: list[UsageBucket]
    by_user: list[UsageBucket]
    recent_runs: list[dict[str, Any]]
