from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.tokens import AuthError, Principal, verify_token
from app.config import Settings, get_settings
from app.db import get_db
from app.errors import NotFound, Unauthorized
from app.models import Application, Decision, DecisionVersion

DB = Annotated[Session, Depends(get_db)]


def get_principal(
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise Unauthorized("Missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    try:
        return verify_token(settings, authorization.split(" ", 1)[1].strip())
    except AuthError as exc:
        raise Unauthorized(str(exc), headers={"WWW-Authenticate": 'Bearer error="invalid_token"'}) from exc


CurrentPrincipal = Annotated[Principal, Depends(get_principal)]


def load_app(db: Session, key: str) -> Application:
    app = db.scalar(select(Application).where(Application.key == key))
    if app is None:
        raise NotFound(f"Application '{key}' not found")
    return app


def load_decision(db: Session, app: Application, key: str) -> Decision:
    decision = db.scalar(select(Decision).where(Decision.app_id == app.id, Decision.key == key))
    if decision is None:
        raise NotFound(f"Decision '{key}' not found in '{app.key}'")
    return decision


def load_version(db: Session, decision: Decision, version: int, *, for_update: bool = False) -> DecisionVersion:
    stmt = select(DecisionVersion).where(DecisionVersion.decision_id == decision.id, DecisionVersion.version == version)
    if for_update:
        stmt = stmt.with_for_update()
    row = db.scalar(stmt)
    if row is None:
        raise NotFound(f"Version {version} of '{decision.key}' not found")
    return row
