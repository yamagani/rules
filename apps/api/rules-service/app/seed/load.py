from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (
    AiProvider,
    AppAiSettings,
    Application,
    Base,
    Decision,
    DecisionAlias,
    DecisionVersion,
    EvaluationStat,
    Permission,
    ProviderType,
    RoleGrant,
    SubjectType,
    TestCase,
    VersionStatus,
)
from app.seed import data
from app.services import audit, engine
from app.services.jdm import checksum, ensure_valid

SEED_ACTOR = "seed"


def reset(db: Session) -> None:
    tables = ", ".join(t.name for t in reversed(Base.metadata.sorted_tables))
    db.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    engine.decisions.clear()
    engine.aliases.clear()


def seed(db: Session) -> bool:
    if db.scalar(select(Application.id).where(Application.key == data.APP_KEY)):
        return False
    now = datetime.now(UTC)
    app = Application(key=data.APP_KEY, name=data.APP_NAME)
    db.add(app)
    db.flush()
    audit.record(db, SEED_ACTOR, "app.created", app, key=app.key)

    for subject_type, subject, app_key, perm in data.GRANTS:
        db.add(
            RoleGrant(
                subject_type=SubjectType(subject_type),
                subject=subject,
                app_id=app.id if app_key else None,
                permission=Permission(perm),
            )
        )

    for key, name, description, versions, tests in data.DECISIONS:
        decision = Decision(app_id=app.id, key=key, name=name, description=description)
        db.add(decision)
        db.flush()
        for test_name, input_, expected in tests:
            db.add(TestCase(decision_id=decision.id, name=test_name, input=input_, expected=expected))
        count = len(versions)
        for idx, (content, status, comment, aliases) in enumerate(versions, start=1):
            ensure_valid(content)
            age = timedelta(days=(count - idx + 1) * 7)
            status_enum = VersionStatus(status)
            row = DecisionVersion(
                decision_id=decision.id,
                version=idx,
                content=content,
                status=status_enum,
                author="bob" if idx > 1 else "alice",
                comment=comment,
                checksum=checksum(content),
                created_at=now - age,
                activated_at=None if status_enum == VersionStatus.draft else now - age + timedelta(hours=2),
                disabled_at=now - timedelta(days=1) if status_enum == VersionStatus.disabled else None,
                sunset_at=now + timedelta(days=30) if status_enum == VersionStatus.deprecated else None,
            )
            db.add(row)
            db.flush()
            audit.record(db, SEED_ACTOR, "version.seeded", app, decision, row, version=idx, status=status)
            for alias in aliases:
                db.add(DecisionAlias(decision_id=decision.id, alias=alias, version_id=row.id, updated_by=SEED_ACTOR))
            # Background traffic for the usage view: active versions only, so deprecated
            # versions show no remaining callers.
            if status_enum == VersionStatus.active:
                for day_offset in range(7):
                    db.add(
                        EvaluationStat(
                            decision_id=decision.id,
                            version_id=row.id,
                            day=(now - timedelta(days=day_offset)).date(),
                            count=40 + 13 * idx + 7 * day_offset,
                        )
                    )
    _seed_ai(db, app)
    db.flush()
    return True


def _seed_ai(db: Session, app: Application) -> None:
    """A mock provider (enabled for the demo app) and a disabled Anthropic provider that works
    once ANTHROPIC_API_KEY is set and an admin enables it. Model names come from configuration."""
    settings = get_settings()
    mock = AiProvider(
        name="mock",
        type=ProviderType.mock,
        model="mock-jdm-fixtures",
        enabled=True,
        max_tokens=8000,
        temperature=0.0,
        timeout_s=30,
        created_by=SEED_ACTOR,
        options={},
    )
    anthropic = AiProvider(
        name="anthropic",
        type=ProviderType.anthropic,
        model=settings.ai_default_model or "set-AI_DEFAULT_MODEL",
        api_key_ref="env:ANTHROPIC_API_KEY",
        enabled=False,
        max_tokens=16000,
        temperature=0.0,
        timeout_s=90,
        monthly_token_budget=2_000_000,
        created_by=SEED_ACTOR,
        options={},
    )
    db.add_all([mock, anthropic])
    db.flush()
    db.add(AppAiSettings(app_id=app.id, provider_id=mock.id))
    audit.record(db, SEED_ACTOR, "ai.settings.updated", app, new={"provider_id": mock.id, "fallback_provider_id": None})
