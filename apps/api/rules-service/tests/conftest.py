"""Test setup: a dedicated Postgres database migrated with Alembic, reset + reseeded per test."""

import os

import psycopg
import pytest
from sqlalchemy.engine import make_url

BASE_URL = os.environ.get("TEST_DATABASE_URL", "postgresql://rules:rules@localhost:5432/rules")
TEST_DB = "rules_test"


def _test_url() -> str:
    return make_url(BASE_URL).set(database=TEST_DB).render_as_string(hide_password=False)


os.environ.update(
    {
        "ENV": "test",
        "DATABASE_URL": _test_url(),
        "DATABASE_URL_UNPOOLED": _test_url(),
        "DEMO_AUTH": "false",
        "AI_DEFAULT_PROVIDER": "mock",
    }
)
os.environ.pop("VERCEL_ENV", None)


def _create_database() -> None:
    admin = make_url(BASE_URL).set(drivername="postgresql")
    dsn = admin.render_as_string(hide_password=False)
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{TEST_DB}"')


@pytest.fixture(scope="session", autouse=True)
def database() -> None:
    from alembic.config import Config

    from alembic import command

    _create_database()
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    command.upgrade(cfg, "head")


@pytest.fixture(autouse=True)
def seeded(database: None) -> None:
    from app.db import _session_factory
    from app.seed.load import reset, seed

    with _session_factory()() as db:
        reset(db)
        seed(db)
        db.commit()


@pytest.fixture
def db():
    from app.db import _session_factory

    with _session_factory()() as session:
        yield session


class Api:
    """Thin TestClient wrapper that logs in as a seeded user."""

    APP = "/v1/apps/loan-origination"

    def __init__(self, client, user: str | None) -> None:
        self.client = client
        self.headers: dict[str, str] = {}
        if user:
            token = client.post("/v1/dev/token", json={"username": user}).json()["access_token"]
            self.headers["Authorization"] = f"Bearer {token}"

    def _url(self, path: str) -> str:
        return path if path.startswith("/v1") or path.startswith("/health") else f"{self.APP}{path}"

    def get(self, path: str, **kw):
        return self.client.get(self._url(path), headers=self.headers, **kw)

    def post(self, path: str, json=None, **kw):
        return self.client.post(self._url(path), json=json, headers=self.headers, **kw)

    def put(self, path: str, json=None, **kw):
        return self.client.put(self._url(path), json=json, headers=self.headers, **kw)

    def delete(self, path: str, **kw):
        return self.client.delete(self._url(path), headers=self.headers, **kw)

    def evaluate(self, decision: str, context: dict, query: str = ""):
        return self.post(f"/decisions/{decision}/evaluate{query}", json=context)


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


@pytest.fixture
def as_user(client):
    return lambda user: Api(client, user)


@pytest.fixture
def alice(as_user):
    return as_user("alice")


@pytest.fixture
def bob(as_user):
    return as_user("bob")


@pytest.fixture
def carol(as_user):
    return as_user("carol")


@pytest.fixture
def dave(as_user):
    return as_user("dave")


@pytest.fixture
def svc(as_user):
    return as_user("svc-loan")


ADULT = {"applicant": {"age": 30, "creditScore": 700}, "loan": {"amount": 100_000}}
