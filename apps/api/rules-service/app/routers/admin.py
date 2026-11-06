from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth import rbac
from app.deps import DB, CurrentPrincipal, load_app
from app.errors import Conflict, NotFound
from app.models import Application, AuditLog, Decision, DecisionVersion, Permission, RoleGrant
from app.schemas import AuditOut, GrantIn, GrantOut
from app.services import audit

router = APIRouter(prefix="/v1/apps/{app}", tags=["admin"])


def _grant_out(g: RoleGrant, app_key: str | None) -> GrantOut:
    return GrantOut(
        id=g.id, subject_type=g.subject_type, subject=g.subject, app=app_key, permission=g.permission
    )


@router.get("/grants", response_model=list[GrantOut])
def list_grants(app: str, db: DB, principal: CurrentPrincipal) -> list[GrantOut]:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.admin)
    rows = db.execute(
        select(RoleGrant, Application.key)
        .outerjoin(Application, Application.id == RoleGrant.app_id)
        .where((RoleGrant.app_id == application.id) | (RoleGrant.app_id.is_(None)))
        .order_by(RoleGrant.subject, RoleGrant.permission)
    ).all()
    return [_grant_out(g, key) for g, key in rows]


@router.post("/grants", response_model=GrantOut, status_code=status.HTTP_201_CREATED)
def add_grant(app: str, body: GrantIn, db: DB, principal: CurrentPrincipal) -> GrantOut:
    application = load_app(db, app)
    # A global grant needs global admin; an app grant needs admin on that app.
    rbac.require(db, principal, None if body.global_ else application, Permission.admin)
    grant = RoleGrant(
        subject_type=body.subject_type,
        subject=body.subject,
        app_id=None if body.global_ else application.id,
        permission=body.permission,
    )
    db.add(grant)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise Conflict("That grant already exists") from exc
    audit.record(
        db,
        principal.subject,
        "grant.created",
        application,
        subject_type=body.subject_type.value,
        subject=body.subject,
        permission=body.permission.value,
        scope="global" if body.global_ else application.key,
    )
    db.commit()
    return _grant_out(grant, None if body.global_ else application.key)


@router.delete("/grants/{grant_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_grant(app: str, grant_id: int, db: DB, principal: CurrentPrincipal) -> Response:
    application = load_app(db, app)
    grant = db.get(RoleGrant, grant_id)
    if grant is None or grant.app_id not in (application.id, None):
        raise NotFound(f"Grant {grant_id} not found")
    rbac.require(db, principal, None if grant.app_id is None else application, Permission.admin)
    audit.record(
        db,
        principal.subject,
        "grant.deleted",
        application,
        subject_type=grant.subject_type.value,
        subject=grant.subject,
        permission=grant.permission.value,
        scope="global" if grant.app_id is None else application.key,
    )
    db.delete(grant)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/audit", response_model=list[AuditOut])
def list_audit(
    app: str,
    db: DB,
    principal: CurrentPrincipal,
    decision: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[AuditOut]:
    application = load_app(db, app)
    rbac.require(db, principal, application, Permission.admin)
    stmt = (
        select(AuditLog, Decision.key, DecisionVersion.version)
        .outerjoin(Decision, Decision.id == AuditLog.decision_id)
        .outerjoin(DecisionVersion, DecisionVersion.id == AuditLog.version_id)
        .where(AuditLog.app_id == application.id)
        .order_by(AuditLog.id.desc())
        .limit(limit)
    )
    if decision:
        stmt = stmt.where(Decision.key == decision)
    return [
        AuditOut(
            id=a.id,
            actor=a.actor,
            action=a.action,
            decision=dk,
            version=v,
            details=a.details,
            created_at=a.created_at,
        )
        for a, dk, v in db.execute(stmt).all()
    ]
