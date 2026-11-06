"""Permission checks. rules-service is the security boundary: every endpoint calls `require`.

Implication rules (documented in docs/DECISIONS.md D-103):
- `admin` implies every permission.
- `edit` and `publish` imply `view`.
- `evaluate` is independent: service accounts can evaluate without reading rule content.
- A grant with `app_id = NULL` applies to every application.
"""

from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth.tokens import Principal
from app.errors import Forbidden
from app.models import Application, Permission, RoleGrant, SubjectType

IMPLIES: dict[Permission, set[Permission]] = {
    Permission.admin: set(Permission),
    Permission.edit: {Permission.edit, Permission.view},
    Permission.publish: {Permission.publish, Permission.view},
    Permission.view: {Permission.view},
    Permission.evaluate: {Permission.evaluate},
}


@dataclass
class EffectivePermissions:
    global_: set[Permission]
    per_app: dict[int, set[Permission]]

    def for_app(self, app_id: int | None) -> set[Permission]:
        perms = set(self.global_)
        if app_id is not None:
            perms |= self.per_app.get(app_id, set())
        return perms

    def has(self, app_id: int | None, perm: Permission) -> bool:
        return perm in self.for_app(app_id)


def _expand(perms: set[Permission]) -> set[Permission]:
    out: set[Permission] = set()
    for p in perms:
        out |= IMPLIES[p]
    return out


def effective_permissions(db: Session, principal: Principal) -> EffectivePermissions:
    conditions = [(RoleGrant.subject_type == SubjectType.user) & (RoleGrant.subject == principal.subject)]
    if principal.groups:
        conditions.append((RoleGrant.subject_type == SubjectType.group) & (RoleGrant.subject.in_(principal.groups)))
    grants = db.scalars(select(RoleGrant).where(or_(*conditions))).all()
    global_: set[Permission] = set()
    per_app: dict[int, set[Permission]] = {}
    for g in grants:
        if g.app_id is None:
            global_.add(g.permission)
        else:
            per_app.setdefault(g.app_id, set()).add(g.permission)
    return EffectivePermissions(_expand(global_), {k: _expand(v) for k, v in per_app.items()})


def require(db: Session, principal: Principal, app: Application | None, perm: Permission) -> None:
    perms = effective_permissions(db, principal)
    if not perms.has(app.id if app else None, perm):
        where = f"application '{app.key}'" if app else "global scope"
        raise Forbidden(f"'{principal.subject}' lacks '{perm.value}' permission on {where}")


def visible_app_ids(db: Session, principal: Principal) -> set[int] | None:
    """App ids the principal may view; None means all (global view)."""
    perms = effective_permissions(db, principal)
    if Permission.view in perms.global_:
        return None
    return {app_id for app_id, p in perms.per_app.items() if Permission.view in p}
