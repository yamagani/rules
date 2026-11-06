from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

LOCAL_DEV_JWT_SECRET = "local-dev-only-not-a-secret-0123456789"  # noqa: S105 - only accepted when ENV=local


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../../.env"), extra="ignore")

    env: Literal["local", "test", "preview", "demo", "production"] = Field("local", alias="ENV")
    database_url: str = Field("postgresql://rules:rules@localhost:5432/rules", alias="DATABASE_URL")
    database_url_unpooled: str | None = Field(None, alias="DATABASE_URL_UNPOOLED")

    # Auth
    demo_auth: bool = Field(False, alias="DEMO_AUTH")
    vercel_env: str | None = Field(None, alias="VERCEL_ENV")
    # "demo" marks the separate demo deployment, whose Vercel target is also "production".
    rules_deployment: str | None = Field(None, alias="RULES_DEPLOYMENT")
    dev_jwt_secret: str | None = Field(None, alias="DEV_JWT_SECRET")
    oidc_issuer: str | None = Field(None, alias="OIDC_ISSUER")
    oidc_audience: str | None = Field(None, alias="OIDC_AUDIENCE")
    oidc_jwks_url: str | None = Field(None, alias="OIDC_JWKS_URL")
    oidc_roles_claim: str = Field("roles", alias="OIDC_ROLES_CLAIM")
    oidc_groups_claim: str = Field("groups", alias="OIDC_GROUPS_CLAIM")

    # Caches (per instance; correctness never depends on them)
    alias_cache_ttl_s: float = Field(5.0, alias="ALIAS_CACHE_TTL_S")
    decision_cache_size: int = Field(256, alias="DECISION_CACHE_SIZE")

    # AI authoring
    # Model names are configuration only (never hardcoded); see .env.example.
    ai_default_provider: str = Field("mock", alias="AI_DEFAULT_PROVIDER")
    ai_default_model: str | None = Field(None, alias="AI_DEFAULT_MODEL")
    ai_max_repair_attempts: int = Field(2, alias="AI_MAX_REPAIR_ATTEMPTS", ge=0, le=5)
    ai_rate_limit_user_per_hour: int = Field(20, alias="AI_RATE_LIMIT_USER_PER_HOUR")
    ai_rate_limit_app_per_hour: int = Field(200, alias="AI_RATE_LIMIT_APP_PER_HOUR")
    ai_max_prompt_chars: int = Field(4_000, alias="AI_MAX_PROMPT_CHARS")
    ai_max_context_chars: int = Field(20_000, alias="AI_MAX_CONTEXT_CHARS")
    ai_max_examples: int = Field(20, alias="AI_MAX_EXAMPLES")
    ai_max_request_bytes: int = Field(64_000, alias="AI_MAX_REQUEST_BYTES")
    # The generate route must finish inside the function's maxDuration (vercel.json: 300 s).
    ai_call_timeout_cap_s: float = Field(90, alias="AI_CALL_TIMEOUT_CAP_S")
    ai_total_budget_s: float = Field(240, alias="AI_TOTAL_BUDGET_S")

    @property
    def is_vercel_production(self) -> bool:
        return self.vercel_env == "production" and self.rules_deployment != "demo"

    @property
    def dev_issuer_enabled(self) -> bool:
        if self.env in ("local", "test"):
            return True
        return self.demo_auth and not self.is_vercel_production

    @property
    def effective_dev_secret(self) -> str | None:
        if self.dev_jwt_secret:
            return self.dev_jwt_secret
        return LOCAL_DEV_JWT_SECRET if self.env in ("local", "test") else None

    def check_startup(self) -> None:
        """Refuse to start in unsafe configurations (see docs/DECISIONS.md D-104)."""
        if self.demo_auth and self.is_vercel_production:
            raise RuntimeError("DEMO_AUTH=true is not allowed on the production deployment")
        if self.dev_issuer_enabled and not self.effective_dev_secret:
            raise RuntimeError("DEMO_AUTH=true requires DEV_JWT_SECRET to be set")
        if self.env == "production" and not (self.oidc_issuer and self.oidc_jwks_url):
            raise RuntimeError("ENV=production requires OIDC_ISSUER and OIDC_JWKS_URL")


@lru_cache
def get_settings() -> Settings:
    return Settings()
