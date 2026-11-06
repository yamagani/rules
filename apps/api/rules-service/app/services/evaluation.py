"""Version selection and evaluation for POST .../evaluate."""

from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import format_datetime
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.auth.rbac import effective_permissions
from app.auth.tokens import Principal
from app.config import get_settings
from app.errors import Forbidden, Gone, NotFound, Unprocessable
from app.models import (
    Application,
    Decision,
    DecisionAlias,
    DecisionVersion,
    EvaluationStat,
    Permission,
    VersionStatus,
)
from app.schemas import EvaluateMeta, EvaluateResponse
from app.services import engine, lifecycle
from app.services.jdm import clean_engine_error

ResolvedBy = Literal["version", "alias", "default", "draft"]


@dataclass
class Selection:
    version: DecisionVersion
    resolved_by: ResolvedBy
    alias: str | None = None


def _resolve_alias(db: Session, decision: Decision, alias: str) -> DecisionVersion | None:
    # TODO(canary): when decision_aliases.weights is set, pick a version by weight here.
    version_id = engine.aliases.get(decision.id, alias)
    if version_id is None:
        version_id = db.scalar(
            select(DecisionAlias.version_id).where(
                DecisionAlias.decision_id == decision.id, DecisionAlias.alias == alias
            )
        )
        if version_id is None:
            return None
        engine.aliases.put(decision.id, alias, version_id, get_settings().alias_cache_ttl_s)
    # Status is always read fresh: never serve a disabled version from cache.
    return db.scalar(select(DecisionVersion).where(DecisionVersion.id == version_id))


def select_version(
    db: Session, decision: Decision, *, version: int | None, alias: str | None, draft: bool
) -> Selection:
    """Order: ?version=n, then ?alias=name, then ?draft=true, then the `default` alias."""
    if version is not None:
        row = db.scalar(
            select(DecisionVersion).where(
                DecisionVersion.decision_id == decision.id, DecisionVersion.version == version
            )
        )
        if row is None:
            raise NotFound(f"Version {version} of '{decision.key}' not found")
        return Selection(row, "version")
    if alias:
        row = _resolve_alias(db, decision, alias)
        if row is None:
            raise NotFound(f"Alias '{alias}' not found for '{decision.key}'")
        return Selection(row, "alias", alias)
    if draft:
        row = db.scalar(
            select(DecisionVersion)
            .where(DecisionVersion.decision_id == decision.id, DecisionVersion.status == VersionStatus.draft)
            .order_by(DecisionVersion.version.desc())
            .limit(1)
        )
        if row is None:
            raise NotFound(f"'{decision.key}' has no draft version")
        return Selection(row, "draft")
    row = _resolve_alias(db, decision, lifecycle.DEFAULT_ALIAS)
    if row is None:
        raise NotFound(f"'{decision.key}' has no default version yet (activate a version first)")
    return Selection(row, "default", lifecycle.DEFAULT_ALIAS)


def _authorize(db: Session, app: Application, principal: Principal, sel: Selection) -> None:
    perms = effective_permissions(db, principal).for_app(app.id)
    if sel.version.status == VersionStatus.draft:
        if Permission.edit not in perms:
            raise Forbidden("Draft versions can only be evaluated by users with 'edit' permission")
    elif Permission.evaluate not in perms and Permission.edit not in perms:
        raise Forbidden(f"'{principal.subject}' lacks 'evaluate' permission on application '{app.key}'")


def record_usage(db: Session, version: DecisionVersion) -> None:
    stmt = insert(EvaluationStat).values(
        decision_id=version.decision_id, version_id=version.id, day=datetime.now(UTC).date(), count=1
    )
    db.execute(
        stmt.on_conflict_do_update(
            index_elements=[EvaluationStat.version_id, EvaluationStat.day],
            set_={"count": EvaluationStat.count + 1},
        )
    )


def evaluate(
    db: Session,
    app: Application,
    decision: Decision,
    principal: Principal,
    context: dict[str, Any],
    *,
    version: int | None,
    alias: str | None,
    draft: bool,
    trace: bool,
) -> tuple[EvaluateResponse, dict[str, str]]:
    sel = select_version(db, decision, version=version, alias=alias, draft=draft)
    _authorize(db, app, principal, sel)
    row = sel.version
    if row.status == VersionStatus.disabled:
        raise Gone(
            f"Version {row.version} of '{decision.key}' is disabled",
            headers={"X-Rule-Version": str(row.version)},
            version=row.version,
            alternatives=lifecycle.alternatives(db, decision),
        )

    # The caller block always comes from the verified token, never from the request body.
    ctx = {**context, "caller": {"roles": list(principal.roles), "app": app.key}}
    try:
        out = engine.evaluate(db, row, ctx, trace)
    except Exception as exc:
        raise Unprocessable(
            f"Evaluation failed: {clean_engine_error(str(exc))}", headers={"X-Rule-Version": str(row.version)}
        ) from exc

    if row.status != VersionStatus.draft:
        record_usage(db, row)
        db.commit()

    deprecated = row.status == VersionStatus.deprecated
    headers = {"X-Rule-Version": str(row.version)}
    if deprecated:
        headers["Deprecation"] = "true"
        if row.sunset_at:
            headers["Sunset"] = format_datetime(row.sunset_at.astimezone(UTC), usegmt=True)
    meta = EvaluateMeta(
        app=app.key,
        decision=decision.key,
        version=row.version,
        status=row.status,
        resolved_by=sel.resolved_by,
        alias=sel.alias,
        deprecated=deprecated,
        sunset_at=row.sunset_at,
        performance=out.get("performance"),
    )
    return EvaluateResponse(
        result=out["result"], meta=meta, trace=out.get("trace") if trace else None
    ), headers
