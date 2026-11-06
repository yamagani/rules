"""Version lifecycle and aliases.

draft -> active -> deprecated -> disabled, and disabled -> active (re-enable).
Any number of versions may be active/deprecated at once; aliases point only at active or
deprecated versions; a version that an alias points at cannot be disabled.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.rbac import effective_permissions
from app.auth.tokens import Principal
from app.errors import Conflict, Forbidden, NotFound
from app.models import (
    Application,
    Decision,
    DecisionAlias,
    DecisionVersion,
    Permission,
    VersionStatus,
)
from app.schemas import AliasOut, TestReport, VersionSummary
from app.services import audit, engine, testing
from app.services.jdm import checksum, ensure_valid

SERVABLE = (VersionStatus.active, VersionStatus.deprecated)
DEFAULT_ALIAS = "default"


def now() -> datetime:
    return datetime.now(UTC)


def aliases_by_version(db: Session, decision: Decision) -> dict[int, list[str]]:
    rows = db.execute(
        select(DecisionAlias.version_id, DecisionAlias.alias)
        .where(DecisionAlias.decision_id == decision.id)
        .order_by(DecisionAlias.alias)
    ).all()
    out: dict[int, list[str]] = {}
    for version_id, alias in rows:
        out.setdefault(version_id, []).append(alias)
    return out


def summary(version: DecisionVersion, alias_map: dict[int, list[str]]) -> VersionSummary:
    s = VersionSummary.model_validate(version)
    s.aliases = alias_map.get(version.id, [])
    return s


def alias_list(db: Session, decision: Decision) -> list[AliasOut]:
    rows = db.execute(
        select(DecisionAlias, DecisionVersion.version)
        .join(DecisionVersion, DecisionVersion.id == DecisionAlias.version_id)
        .where(DecisionAlias.decision_id == decision.id)
        .order_by(DecisionAlias.alias)
    ).all()
    return [AliasOut(alias=a.alias, version=v, updated_by=a.updated_by, updated_at=a.updated_at) for a, v in rows]


def lock_decision(db: Session, decision: Decision) -> None:
    """Serialize lifecycle changes on one decision (version numbering, alias moves)."""
    db.execute(select(Decision.id).where(Decision.id == decision.id).with_for_update())


def create_version(
    db: Session,
    app: Application,
    decision: Decision,
    content: dict[str, Any],
    *,
    author: str,
    comment: str | None,
    requested_by: str | None = None,
    audit_details: dict[str, Any] | None = None,
) -> DecisionVersion:
    ensure_valid(content)
    lock_decision(db, decision)
    current = db.scalar(select(func.max(DecisionVersion.version)).where(DecisionVersion.decision_id == decision.id))
    version = DecisionVersion(
        decision_id=decision.id,
        version=(current or 0) + 1,
        content=content,
        status=VersionStatus.draft,
        author=author,
        requested_by=requested_by,
        comment=comment,
        checksum=checksum(content),
    )
    db.add(version)
    db.flush()
    audit.record(
        db,
        requested_by or author,
        "version.created",
        app,
        decision,
        version,
        version=version.version,
        author=author,
        comment=comment,
        **(audit_details or {}),
    )
    return version


def _gate(db: Session, app: Application, version: DecisionVersion, principal: Principal, force: bool) -> TestReport:
    """The activation gate: stored tests must pass unless an admin forces it."""
    if force and not effective_permissions(db, principal).has(app.id, Permission.admin):
        raise Forbidden("force=true requires the 'admin' permission")
    tests = testing.run_stored_tests(db, version, app.key)
    if tests.failed and not force:
        raise Conflict(
            f"{tests.failed} of {tests.total} test case(s) failed; version {version.version} was not activated",
            tests=tests.model_dump(mode="json"),
        )
    return tests


def _set_alias(
    db: Session, app: Application, decision: Decision, alias: str, target: DecisionVersion, actor: str
) -> None:
    if target.status not in SERVABLE:
        raise Conflict(
            f"Alias '{alias}' can only point at an active or deprecated version "
            f"(version {target.version} is {target.status.value})"
        )
    existing = db.scalar(
        select(DecisionAlias).where(DecisionAlias.decision_id == decision.id, DecisionAlias.alias == alias)
    )
    old_version = None
    if existing:
        if existing.version_id == target.id:
            return
        old_version = db.scalar(select(DecisionVersion.version).where(DecisionVersion.id == existing.version_id))
        existing.version_id = target.id
        existing.updated_by = actor
        existing.updated_at = now()
    else:
        db.add(DecisionAlias(decision_id=decision.id, alias=alias, version_id=target.id, updated_by=actor))
    db.flush()
    engine.aliases.invalidate(decision.id, alias)
    audit.record(
        db,
        actor,
        "alias.moved" if existing else "alias.created",
        app,
        decision,
        target,
        alias=alias,
        old_version=old_version,
        new_version=target.version,
    )


def activate(
    db: Session,
    app: Application,
    decision: Decision,
    version: DecisionVersion,
    principal: Principal,
    aliases: list[str],
    force: bool,
) -> TestReport:
    lock_decision(db, decision)
    if version.status != VersionStatus.draft:
        raise Conflict(
            f"Only drafts can be activated (version {version.version} is {version.status.value}); "
            "use /enable for disabled versions"
        )
    tests = _gate(db, app, version, principal, force)
    version.status = VersionStatus.active
    version.activated_at = now()
    db.flush()
    audit.record(
        db,
        principal.subject,
        "version.activated",
        app,
        decision,
        version,
        version=version.version,
        old_status="draft",
        new_status="active",
        forced=force and tests.failed > 0,
        tests={"passed": tests.passed, "failed": tests.failed, "total": tests.total},
    )
    has_default = db.scalar(
        select(DecisionAlias.id).where(DecisionAlias.decision_id == decision.id, DecisionAlias.alias == DEFAULT_ALIAS)
    )
    targets = list(dict.fromkeys(aliases))
    if not has_default and DEFAULT_ALIAS not in targets:
        targets.insert(0, DEFAULT_ALIAS)
    for alias in targets:
        _set_alias(db, app, decision, alias, version, principal.subject)
    return tests


def enable(
    db: Session,
    app: Application,
    decision: Decision,
    version: DecisionVersion,
    principal: Principal,
    force: bool,
) -> TestReport:
    lock_decision(db, decision)
    if version.status != VersionStatus.disabled:
        raise Conflict(
            f"Only disabled versions can be re-enabled (version {version.version} is {version.status.value})"
        )
    tests = _gate(db, app, version, principal, force)
    version.status = VersionStatus.active
    version.activated_at = now()
    version.disabled_at = None
    version.sunset_at = None
    db.flush()
    audit.record(
        db,
        principal.subject,
        "version.enabled",
        app,
        decision,
        version,
        version=version.version,
        old_status="disabled",
        new_status="active",
        tests={"passed": tests.passed, "failed": tests.failed, "total": tests.total},
    )
    return tests


def deprecate(
    db: Session,
    app: Application,
    decision: Decision,
    version: DecisionVersion,
    actor: str,
    sunset_at: datetime | None,
) -> None:
    if version.status not in SERVABLE:
        raise Conflict(f"Only active versions can be deprecated (version {version.version} is {version.status.value})")
    old_status, old_sunset = version.status, version.sunset_at
    version.status = VersionStatus.deprecated
    version.sunset_at = sunset_at
    db.flush()
    audit.record(
        db,
        actor,
        "version.deprecated",
        app,
        decision,
        version,
        version=version.version,
        old_status=old_status.value,
        new_status="deprecated",
        old_sunset_at=old_sunset.isoformat() if old_sunset else None,
        new_sunset_at=sunset_at.isoformat() if sunset_at else None,
    )


def disable(db: Session, app: Application, decision: Decision, version: DecisionVersion, actor: str) -> None:
    lock_decision(db, decision)
    if version.status not in SERVABLE:
        raise Conflict(
            f"Only active or deprecated versions can be disabled (version {version.version} is {version.status.value})"
        )
    pointing = aliases_by_version(db, decision).get(version.id, [])
    if pointing:
        raise Conflict(
            f"Version {version.version} is referenced by alias(es) {', '.join(pointing)}; move them first",
            aliases=pointing,
        )
    old_status = version.status
    version.status = VersionStatus.disabled
    version.disabled_at = now()
    db.flush()
    audit.record(
        db,
        actor,
        "version.disabled",
        app,
        decision,
        version,
        version=version.version,
        old_status=old_status.value,
        new_status="disabled",
    )


def put_alias(
    db: Session, app: Application, decision: Decision, alias: str, version: DecisionVersion, actor: str
) -> None:
    lock_decision(db, decision)
    _set_alias(db, app, decision, alias, version, actor)


def delete_alias(db: Session, app: Application, decision: Decision, alias: str, actor: str) -> None:
    if alias == DEFAULT_ALIAS:
        raise Conflict("The 'default' alias cannot be deleted; move it to another version instead")
    lock_decision(db, decision)
    row = db.scalar(select(DecisionAlias).where(DecisionAlias.decision_id == decision.id, DecisionAlias.alias == alias))
    if row is None:
        raise NotFound(f"Alias '{alias}' not found")
    old_version = db.scalar(select(DecisionVersion.version).where(DecisionVersion.id == row.version_id))
    db.delete(row)
    db.flush()
    engine.aliases.invalidate(decision.id, alias)
    audit.record(db, actor, "alias.deleted", app, decision, None, alias=alias, old_version=old_version)


def alternatives(db: Session, decision: Decision) -> list[dict[str, Any]]:
    alias_map = aliases_by_version(db, decision)
    rows = db.scalars(
        select(DecisionVersion)
        .where(DecisionVersion.decision_id == decision.id, DecisionVersion.status.in_(SERVABLE))
        .order_by(DecisionVersion.version.desc())
    )
    return [{"version": v.version, "status": v.status.value, "aliases": alias_map.get(v.id, [])} for v in rows]
