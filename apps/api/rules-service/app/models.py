import enum
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, deferred, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class VersionStatus(enum.StrEnum):
    draft = "draft"
    active = "active"
    deprecated = "deprecated"
    disabled = "disabled"


class Permission(enum.StrEnum):
    view = "view"
    edit = "edit"
    publish = "publish"
    evaluate = "evaluate"
    admin = "admin"


class SubjectType(enum.StrEnum):
    user = "user"
    group = "group"


def _enum(e: type[enum.Enum], name: str) -> Enum:
    return Enum(e, name=name, values_callable=lambda x: [m.value for m in x])


class Application(Base):
    __tablename__ = "applications"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Decision(Base):
    __tablename__ = "decisions"
    __table_args__ = (UniqueConstraint("app_id", "key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    app_id: Mapped[int] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    app: Mapped[Application] = relationship()


class DecisionVersion(Base):
    """One immutable save of a decision graph. `content` and `checksum` are never updated
    (enforced by a database trigger); only `status` and lifecycle timestamps change."""

    __tablename__ = "decision_versions"
    __table_args__ = (UniqueConstraint("decision_id", "version"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    decision_id: Mapped[int] = mapped_column(ForeignKey("decisions.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[dict[str, Any]] = deferred(mapped_column(JSONB))
    status: Mapped[VersionStatus] = mapped_column(_enum(VersionStatus, "version_status"))
    sunset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    author: Mapped[str] = mapped_column(String(200))
    requested_by: Mapped[str | None] = mapped_column(String(200))
    comment: Mapped[str | None] = mapped_column(Text)
    checksum: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DecisionAlias(Base):
    __tablename__ = "decision_aliases"
    __table_args__ = (UniqueConstraint("decision_id", "alias"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    decision_id: Mapped[int] = mapped_column(ForeignKey("decisions.id", ondelete="CASCADE"), index=True)
    alias: Mapped[str] = mapped_column(String(64))
    version_id: Mapped[int] = mapped_column(ForeignKey("decision_versions.id"))
    # TODO(canary): weighted traffic splitting, e.g. {"<version_id>": 90, "<version_id>": 10}.
    # Unused by the resolver today; see app/services/resolver.py.
    weights: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    updated_by: Mapped[str] = mapped_column(String(200))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class TestCase(Base):
    __tablename__ = "test_cases"
    __test__ = False  # not a pytest class
    id: Mapped[int] = mapped_column(primary_key=True)
    decision_id: Mapped[int] = mapped_column(ForeignKey("decisions.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    input: Mapped[dict[str, Any]] = mapped_column(JSONB)
    expected: Mapped[dict[str, Any]] = mapped_column(JSONB)


class RoleGrant(Base):
    __tablename__ = "role_grants"
    __table_args__ = (
        UniqueConstraint("subject_type", "subject", "app_id", "permission", postgresql_nulls_not_distinct=True),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    subject_type: Mapped[SubjectType] = mapped_column(_enum(SubjectType, "subject_type"))
    subject: Mapped[str] = mapped_column(String(200), index=True)
    app_id: Mapped[int | None] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"))
    permission: Mapped[Permission] = mapped_column(_enum(Permission, "permission"))


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    actor: Mapped[str] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(100))
    app_id: Mapped[int | None] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    decision_id: Mapped[int | None] = mapped_column(ForeignKey("decisions.id", ondelete="CASCADE"))
    version_id: Mapped[int | None] = mapped_column(ForeignKey("decision_versions.id", ondelete="CASCADE"))
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EvaluationStat(Base):
    __tablename__ = "evaluation_stats"
    decision_id: Mapped[int] = mapped_column(ForeignKey("decisions.id", ondelete="CASCADE"), index=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("decision_versions.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    count: Mapped[int] = mapped_column(BigInteger, default=0)


# --- AI authoring ------------------------------------------------------------------------
class ProviderType(enum.StrEnum):
    anthropic = "anthropic"
    openai = "openai"
    azure_openai = "azure_openai"
    openai_compatible = "openai_compatible"
    mock = "mock"


class RunStatus(enum.StrEnum):
    succeeded = "succeeded"
    failed = "failed"


class RunKind(enum.StrEnum):
    generate = "generate"
    explain = "explain"
    test_connection = "test_connection"


class AiProvider(Base):
    """An LLM provider configuration. Never stores a raw key: `api_key_ref` is resolved by
    the SecretResolver at call time (e.g. `env:ANTHROPIC_API_KEY`, `aws-sm:prod/anthropic`)."""

    __tablename__ = "ai_providers"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    type: Mapped[ProviderType] = mapped_column(_enum(ProviderType, "provider_type"))
    model: Mapped[str] = mapped_column(String(200))
    base_url: Mapped[str | None] = mapped_column(String(500))
    api_key_ref: Mapped[str | None] = mapped_column(String(300))
    max_tokens: Mapped[int] = mapped_column(Integer, default=8000)
    temperature: Mapped[float] = mapped_column(default=0.0)
    timeout_s: Mapped[int] = mapped_column(Integer, default=60)
    enabled: Mapped[bool] = mapped_column(default=False)
    monthly_token_budget: Mapped[int | None] = mapped_column(BigInteger)
    # Provider-specific non-secret options, e.g. {"api_version": "2024-10-21"} for Azure.
    options: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_by: Mapped[str] = mapped_column(String(200))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AppAiSettings(Base):
    __tablename__ = "app_ai_settings"
    app_id: Mapped[int] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("ai_providers.id"))
    fallback_provider_id: Mapped[int | None] = mapped_column(ForeignKey("ai_providers.id"))


class GenerationRun(Base):
    __tablename__ = "generation_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[RunKind] = mapped_column(_enum(RunKind, "run_kind"), default=RunKind.generate)
    app_id: Mapped[int | None] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    decision_id: Mapped[int | None] = mapped_column(ForeignKey("decisions.id", ondelete="CASCADE"), index=True)
    version_id: Mapped[int | None] = mapped_column(ForeignKey("decision_versions.id", ondelete="SET NULL"))
    requested_by: Mapped[str] = mapped_column(String(200), index=True)
    provider_id: Mapped[int | None] = mapped_column(ForeignKey("ai_providers.id", ondelete="SET NULL"))
    provider_name: Mapped[str | None] = mapped_column(String(100))
    model: Mapped[str | None] = mapped_column(String(200))
    prompt_template_version: Mapped[str | None] = mapped_column(String(50))
    request: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[RunStatus] = mapped_column(_enum(RunStatus, "run_status"))
    validation_report: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
