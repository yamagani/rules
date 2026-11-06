import pytest

from app.config import Settings


def make(**env):
    return Settings.model_validate(env)


def test_dev_issuer_only_local_or_demo():
    assert make(ENV="local").dev_issuer_enabled
    assert not make(ENV="preview").dev_issuer_enabled
    assert make(ENV="preview", DEMO_AUTH=True, DEV_JWT_SECRET="x").dev_issuer_enabled
    assert not make(ENV="production", DEMO_AUTH=True, VERCEL_ENV="production").dev_issuer_enabled


def test_refuses_demo_auth_on_production():
    with pytest.raises(RuntimeError, match="not allowed on the production"):
        make(ENV="demo", DEMO_AUTH=True, VERCEL_ENV="production", DEV_JWT_SECRET="x").check_startup()
    # the separate demo deployment is also a Vercel "production" target, marked explicitly
    make(
        ENV="demo", DEMO_AUTH=True, VERCEL_ENV="production", RULES_DEPLOYMENT="demo", DEV_JWT_SECRET="x"
    ).check_startup()


def test_demo_auth_requires_a_secret():
    with pytest.raises(RuntimeError, match="DEV_JWT_SECRET"):
        make(ENV="preview", DEMO_AUTH=True).check_startup()


def test_production_requires_oidc():
    with pytest.raises(RuntimeError, match="OIDC"):
        make(ENV="production").check_startup()
    make(ENV="production", OIDC_ISSUER="https://idp", OIDC_JWKS_URL="https://idp/jwks").check_startup()


def test_dev_tokens_rejected_when_issuer_disabled():
    from app.auth.tokens import AuthError, mint_dev_token, verify_token

    token = mint_dev_token(make(ENV="local"), "alice")
    with pytest.raises(AuthError):
        verify_token(make(ENV="preview", OIDC_ISSUER="https://idp", OIDC_JWKS_URL="https://idp/jwks"), token)
