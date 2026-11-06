import os

from fastapi import FastAPI
from sqlalchemy import create_engine, text
from sqlalchemy.pool import NullPool

from app.spike.router import router as spike_router

app = FastAPI(title="rules-service", version="0.1.0")
app.include_router(spike_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "rules-service"}


@app.get("/health/db")
def health_db() -> dict[str, str]:
    url = os.environ.get("DATABASE_URL")
    if not url:
        return {"status": "skipped", "reason": "DATABASE_URL not set"}
    engine = create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1), poolclass=NullPool)
    with engine.connect() as conn:
        version = conn.execute(text("select version()")).scalar_one()
    return {"status": "ok", "server": str(version).split(",")[0]}
