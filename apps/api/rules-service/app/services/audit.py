from typing import Any

from sqlalchemy.orm import Session

from app.models import Application, AuditLog, Decision, DecisionVersion


def record(
    db: Session,
    actor: str,
    action: str,
    app: Application | None,
    decision: Decision | None = None,
    version: DecisionVersion | None = None,
    /,
    **details: Any,
) -> None:
    """Append an audit entry in the caller's transaction (committed together with the change)."""
    db.add(
        AuditLog(
            actor=actor,
            action=action,
            app_id=app.id if app else None,
            decision_id=decision.id if decision else None,
            version_id=version.id if version else None,
            details=details,
        )
    )
