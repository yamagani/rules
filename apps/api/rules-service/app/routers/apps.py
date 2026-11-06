from fastapi import APIRouter, status
from sqlalchemy import select

from app.auth import rbac
from app.deps import DB, CurrentPrincipal
from app.errors import Conflict
from app.models import Application, Permission
from app.schemas import AppCreate, AppOut, MeOut
from app.services import audit

router = APIRouter(prefix="/v1", tags=["apps"])


@router.get("/me", response_model=MeOut)
def me(db: DB, principal: CurrentPrincipal) -> MeOut:
    perms = rbac.effective_permissions(db, principal)
    keys = dict(db.execute(select(Application.id, Application.key)).tuples().all())
    apps = {keys[app_id]: sorted(p | perms.global_) for app_id, p in perms.per_app.items() if app_id in keys}
    if perms.global_:
        for key in keys.values():
            apps.setdefault(key, sorted(perms.global_))
    return MeOut(
        subject=principal.subject,
        roles=list(principal.roles),
        groups=list(principal.groups),
        global_permissions=sorted(perms.global_),
        apps=apps,
    )


@router.get("/apps", response_model=list[AppOut])
def list_apps(db: DB, principal: CurrentPrincipal) -> list[Application]:
    visible = rbac.visible_app_ids(db, principal)
    stmt = select(Application).order_by(Application.key)
    if visible is not None:
        stmt = stmt.where(Application.id.in_(visible))
    return list(db.scalars(stmt))


@router.post("/apps", response_model=AppOut, status_code=status.HTTP_201_CREATED)
def create_app(body: AppCreate, db: DB, principal: CurrentPrincipal) -> Application:
    rbac.require(db, principal, None, Permission.admin)
    if db.scalar(select(Application.id).where(Application.key == body.key)):
        raise Conflict(f"Application '{body.key}' already exists")
    app = Application(key=body.key, name=body.name)
    db.add(app)
    db.flush()
    audit.record(db, principal.subject, "app.created", app, key=app.key, name=app.name)
    db.commit()
    return app
