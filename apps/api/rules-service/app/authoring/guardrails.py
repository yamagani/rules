"""Rate limits, token budgets and input caps. Counters live in Postgres (generation_runs),
never in process memory, so they hold across serverless instances."""

import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.authoring.schemas import GenerateRequest
from app.config import get_settings
from app.errors import PayloadTooLarge, TooManyRequests
from app.models import AiProvider, Application, GenerationRun, RunKind


def check_input_size(req: GenerateRequest) -> None:
    s = get_settings()
    if len(req.prompt) > s.ai_max_prompt_chars:
        raise PayloadTooLarge(f"prompt is longer than {s.ai_max_prompt_chars} characters")
    if req.context_text and len(req.context_text) > s.ai_max_context_chars:
        raise PayloadTooLarge(f"context_text is longer than {s.ai_max_context_chars} characters")
    if len(req.examples) > s.ai_max_examples:
        raise PayloadTooLarge(f"at most {s.ai_max_examples} examples are allowed")
    if len(json.dumps(req.model_dump(mode="json"))) > s.ai_max_request_bytes:
        raise PayloadTooLarge(f"request is larger than {s.ai_max_request_bytes} bytes")


def check_rate_limits(db: Session, app: Application, user: str) -> None:
    s = get_settings()
    since = datetime.now(UTC) - timedelta(hours=1)
    base = select(func.count(GenerationRun.id)).where(
        GenerationRun.kind == RunKind.generate, GenerationRun.created_at >= since
    )
    if (db.scalar(base.where(GenerationRun.requested_by == user)) or 0) >= s.ai_rate_limit_user_per_hour:
        raise TooManyRequests(
            f"'{user}' reached {s.ai_rate_limit_user_per_hour} generations per hour", headers={"Retry-After": "3600"}
        )
    if (db.scalar(base.where(GenerationRun.app_id == app.id)) or 0) >= s.ai_rate_limit_app_per_hour:
        raise TooManyRequests(
            f"'{app.key}' reached {s.ai_rate_limit_app_per_hour} generations per hour", headers={"Retry-After": "3600"}
        )


def month_start() -> datetime:
    now = datetime.now(UTC)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def tokens_this_month(db: Session, provider_id: int) -> int:
    total = db.scalar(
        select(func.coalesce(func.sum(GenerationRun.input_tokens + GenerationRun.output_tokens), 0)).where(
            GenerationRun.provider_id == provider_id, GenerationRun.created_at >= month_start()
        )
    )
    return int(total or 0)


def check_budget(db: Session, provider: AiProvider, pending_tokens: int = 0) -> None:
    """Called before every provider call. `pending_tokens` counts this run's earlier attempts,
    which are not stored yet."""
    if provider.monthly_token_budget is None:
        return
    used = tokens_this_month(db, provider.id) + pending_tokens
    if used >= provider.monthly_token_budget:
        raise TooManyRequests(
            f"Provider '{provider.name}' has used its monthly token budget ({used}/{provider.monthly_token_budget})",
            budget=provider.monthly_token_budget,
            used=used,
        )
