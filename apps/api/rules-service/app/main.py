import logging
import os
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from sqlalchemy import text

from app.config import get_settings
from app.db import get_engine
from app.errors import install_error_handlers
from app.routers import admin, apps, decisions, dev_auth
from app.spike.router import router as spike_router

logging.basicConfig(level=logging.INFO, format="%(message)s")


def create_app() -> FastAPI:
    settings = get_settings()
    settings.check_startup()

    app = FastAPI(
        title="rules-service",
        version="0.1.0",
        description="Rules storage, versioning, RBAC and evaluation with the GoRules ZEN engine.",
    )
    install_error_handlers(app)

    @app.middleware("http")
    async def request_id(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex
        response = await call_next(request)
        response.headers["X-Request-Id"] = rid
        return response

    app.include_router(apps.router)
    app.include_router(decisions.router)
    app.include_router(admin.router)
    if settings.dev_issuer_enabled:
        app.include_router(dev_auth.router)
    app.include_router(spike_router)

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "service": "rules-service",
            "demo_auth": str(settings.dev_issuer_enabled).lower(),
        }

    @app.get("/health/db", tags=["health"])
    def health_db() -> dict[str, str]:
        if not os.environ.get("DATABASE_URL") and settings.env not in ("local", "test"):
            return {"status": "skipped", "reason": "DATABASE_URL not set"}
        with get_engine().connect() as conn:
            version = conn.execute(text("select version()")).scalar_one()
        return {"status": "ok", "server": str(version).split(",")[0]}

    return app


app = create_app()
