import re
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import case, func, select

from app.auth import rbac
from app.authoring import guardrails, pipeline, secrets
from app.authoring.schemas import (
    AiUsageOut,
    AppAiSettingsIn,
    AppAiSettingsOut,
    ConnectionTest,
    ExplainResponse,
    GenerateRequest,
    GenerateResponse,
    ProviderIn,
    ProviderOut,
    ProviderPatch,
    UsageBucket,
)
from app.config import get_settings
from app.deps import DB, CurrentPrincipal, load_app, load_decision, load_version
from app.errors import BadRequest, Conflict, NotFound
from app.models import AiProvider, AppAiSettings, GenerationRun, Permission, ProviderType, RunStatus
from app.services import audit

router = APIRouter(tags=["ai"])

_REF_NAME = re.compile(r"^(env:[A-Z][A-Z0-9_]{0,127}|[a-z][a-z0-9-]*:[A-Za-z0-9_./+=@-]{1,256})$")


def _check_ref(ref: str | None) -> None:
    """Admins configure *references* to secrets; anything that looks like a raw key is refused."""
    if ref is None:
        return
    try:
        secrets.validate_ref(ref)
    except secrets.SecretError as exc:
        raise BadRequest(str(exc)) from exc
    if not _REF_NAME.match(ref) or secrets.redact(ref) != ref:
        raise BadRequest("api_key_ref must be a reference such as env:ANTHROPIC_API_KEY, never a key value")


def _key_configured(row: AiProvider) -> bool:
    if row.type == ProviderType.mock or not row.api_key_ref:
        return row.type in (ProviderType.mock, ProviderType.openai_compatible)
    try:
        return bool(secrets.resolve(row.api_key_ref))
    except secrets.SecretError:
        return False


def provider_out(db: DB, row: AiProvider) -> ProviderOut:
    out = ProviderOut.model_validate(row)
    out.key_configured = _key_configured(row)
    out.tokens_this_month = guardrails.tokens_this_month(db, row.id)
    return out


# --- providers (global admin) -----------------------------------------------------------
@router.get("/v1/ai/providers", response_model=list[ProviderOut])
def list_providers(db: DB, principal: CurrentPrincipal) -> list[ProviderOut]:
    rbac.require(db, principal, None, Permission.admin)
    return [provider_out(db, p) for p in db.scalars(select(AiProvider).order_by(AiProvider.name))]


@router.post("/v1/ai/providers", response_model=ProviderOut, status_code=status.HTTP_201_CREATED)
def create_provider(body: ProviderIn, db: DB, principal: CurrentPrincipal) -> ProviderOut:
    rbac.require(db, principal, None, Permission.admin)
    _check_ref(body.api_key_ref)
    if db.scalar(select(AiProvider.id).where(AiProvider.name == body.name)):
        raise Conflict(f"Provider '{body.name}' already exists")
    row = AiProvider(**body.model_dump(), created_by=principal.subject)
    db.add(row)
    db.flush()
    audit.record(
        db,
        principal.subject,
        "ai.provider.created",
        None,
        provider=row.name,
        type=row.type.value,
        model=row.model,
        api_key_ref=row.api_key_ref,
        enabled=row.enabled,
    )
    db.commit()
    return provider_out(db, row)


@router.patch("/v1/ai/providers/{provider_id}", response_model=ProviderOut)
def update_provider(provider_id: int, body: ProviderPatch, db: DB, principal: CurrentPrincipal) -> ProviderOut:
    rbac.require(db, principal, None, Permission.admin)
    row = db.get(AiProvider, provider_id)
    if row is None:
        raise NotFound(f"Provider {provider_id} not found")
    changes = body.model_dump(exclude_unset=True)
    if "api_key_ref" in changes:
        _check_ref(changes["api_key_ref"])
    old = {k: getattr(row, k) for k in changes}
    for key, value in changes.items():
        setattr(row, key, value)
    db.flush()
    audit.record(
        db,
        principal.subject,
        "ai.provider.updated",
        None,
        provider=row.name,
        changes={k: {"old": old[k], "new": changes[k]} for k in changes if old[k] != changes[k]},
    )
    db.commit()
    return provider_out(db, row)


@router.post("/v1/ai/providers/{provider_id}/test", response_model=ConnectionTest)
def test_provider(provider_id: int, db: DB, principal: CurrentPrincipal) -> ConnectionTest:
    rbac.require(db, principal, None, Permission.admin)
    row = db.get(AiProvider, provider_id)
    if row is None:
        raise NotFound(f"Provider {provider_id} not found")
    ok, latency, error, model = pipeline.test_connection(db, row, principal.subject)
    return ConnectionTest(ok=ok, provider=row.name, model=model, latency_ms=latency, error=error)


# --- per-app settings ----------------------------------------------------------------------
@router.get("/v1/apps/{app}/ai/settings", response_model=AppAiSettingsOut)
def get_app_settings(app: str, db: DB, principal: CurrentPrincipal) -> AppAiSettingsOut:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.edit)
    row = db.get(AppAiSettings, application.id)
    if row is None:
        return AppAiSettingsOut(enabled=False)
    primary = db.get(AiProvider, row.provider_id)
    fallback = db.get(AiProvider, row.fallback_provider_id) if row.fallback_provider_id else None
    return AppAiSettingsOut(
        enabled=bool(primary and primary.enabled),
        provider=provider_out(db, primary) if primary else None,
        fallback_provider=provider_out(db, fallback) if fallback else None,
    )


@router.put("/v1/apps/{app}/ai/settings", response_model=AppAiSettingsOut)
def put_app_settings(app: str, body: AppAiSettingsIn, db: DB, principal: CurrentPrincipal) -> AppAiSettingsOut:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.admin)
    provider_id = body.provider_id
    if provider_id is None:  # global default from AI_DEFAULT_PROVIDER
        default_type = get_settings().ai_default_provider
        provider_id = db.scalar(
            select(AiProvider.id).where(AiProvider.type == default_type, AiProvider.enabled.is_(True)).limit(1)
        )
        if provider_id is None:
            raise BadRequest(f"No enabled provider of the default type '{default_type}'; pass provider_id")
    for pid in filter(None, [provider_id, body.fallback_provider_id]):
        if db.get(AiProvider, pid) is None:
            raise BadRequest(f"Provider {pid} does not exist")
    row = db.get(AppAiSettings, application.id)
    old = {"provider_id": row.provider_id, "fallback_provider_id": row.fallback_provider_id} if row else None
    if row is None:
        row = AppAiSettings(app_id=application.id, provider_id=provider_id)
        db.add(row)
    row.provider_id = provider_id
    row.fallback_provider_id = body.fallback_provider_id
    db.flush()
    audit.record(
        db,
        principal.subject,
        "ai.settings.updated",
        application,
        old=old,
        new={"provider_id": provider_id, "fallback_provider_id": body.fallback_provider_id},
    )
    db.commit()
    return get_app_settings(app, db, principal)


@router.delete("/v1/apps/{app}/ai/settings", status_code=status.HTTP_204_NO_CONTENT)
def disable_app_ai(app: str, db: DB, principal: CurrentPrincipal) -> Response:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.admin)
    row = db.get(AppAiSettings, application.id)
    if row is not None:
        db.delete(row)
        audit.record(db, principal.subject, "ai.settings.disabled", application)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/v1/apps/{app}/ai/providers", response_model=list[ProviderOut])
def app_provider_choices(app: str, db: DB, principal: CurrentPrincipal) -> list[ProviderOut]:
    """Providers an author may pick in the Generate panel (only those enabled for the app)."""
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.edit)
    try:
        primary, fallback = pipeline.app_providers(db, application)
    except Conflict:
        return []
    return [provider_out(db, p) for p in [primary, fallback] if p]


# --- generate / explain / usage ---------------------------------------------------------------
@router.post(
    "/v1/apps/{app}/decisions/{key}/generate",
    response_model=GenerateResponse,
    status_code=status.HTTP_201_CREATED,
)
def generate(app: str, key: str, body: GenerateRequest, db: DB, principal: CurrentPrincipal) -> GenerateResponse:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.edit)
    decision = load_decision(db, application, key)
    return pipeline.generate(db, application, decision, principal, body)


@router.post("/v1/apps/{app}/decisions/{key}/versions/{version}/explain", response_model=ExplainResponse)
def explain(app: str, key: str, version: int, db: DB, principal: CurrentPrincipal) -> ExplainResponse:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.view)
    decision = load_decision(db, application, key)
    return pipeline.explain(db, application, decision, load_version(db, decision, version), principal)


@router.get("/v1/apps/{app}/ai/usage", response_model=AiUsageOut)
def ai_usage(
    app: str, db: DB, principal: CurrentPrincipal, days: Annotated[int, Query(ge=1, le=365)] = 30
) -> AiUsageOut:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.admin)
    since = datetime.now(UTC) - timedelta(days=days)
    where = (GenerationRun.app_id == application.id, GenerationRun.created_at >= since)

    def buckets(column: Any) -> list[UsageBucket]:
        rows = db.execute(
            select(
                column,
                func.count(GenerationRun.id),
                func.sum(case((GenerationRun.status == RunStatus.succeeded, 1), else_=0)),
                func.sum(GenerationRun.input_tokens),
                func.sum(GenerationRun.output_tokens),
            )
            .where(*where)
            .group_by(column)
            .order_by(column)
        ).all()
        return [
            UsageBucket(
                key=str(k or "unknown"),
                runs=n,
                succeeded=int(ok or 0),
                failed=n - int(ok or 0),
                input_tokens=int(i or 0),
                output_tokens=int(o or 0),
            )
            for k, n, ok, i, o in rows
        ]

    recent = db.scalars(select(GenerationRun).where(*where).order_by(GenerationRun.id.desc()).limit(25))
    return AiUsageOut(
        days=days,
        by_provider=buckets(GenerationRun.provider_name),
        by_user=buckets(GenerationRun.requested_by),
        recent_runs=[
            {
                "id": r.id,
                "kind": r.kind.value,
                "status": r.status.value,
                "requested_by": r.requested_by,
                "provider": r.provider_name,
                "model": r.model,
                "attempts": r.attempts,
                "input_tokens": r.input_tokens,
                "output_tokens": r.output_tokens,
                "latency_ms": r.latency_ms,
                "created_at": r.created_at.isoformat(),
            }
            for r in recent
        ],
    )
