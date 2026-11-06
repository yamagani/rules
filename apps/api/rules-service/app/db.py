from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings


def to_sqlalchemy_url(url: str) -> str:
    """Normalise postgres:// and postgresql:// URLs (as Neon/Vercel hand them out) to psycopg v3."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


@lru_cache
def get_engine() -> Engine:
    # Neon's pooled endpoint runs PgBouncer, which does the pooling; serverless instances must
    # not hold their own pools. NullPool opens one connection per request/session.
    # prepare_threshold=None disables server-side prepared statements (PgBouncer transaction mode).
    return create_engine(
        to_sqlalchemy_url(get_settings().database_url),
        poolclass=NullPool,
        connect_args={"prepare_threshold": None},
    )


@lru_cache
def _session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_db() -> Iterator[Session]:
    session = _session_factory()()
    try:
        yield session
    finally:
        session.close()
