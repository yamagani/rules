"""Bearer token verification: dev issuer (HS256) and OIDC (JWKS, RS256/ES256)."""

import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import jwt

from app.auth.users import DEMO_USERS
from app.config import Settings

DEV_ISSUER = "rules-dev-issuer"
DEV_AUDIENCE = "rules-service"


@dataclass(frozen=True)
class Principal:
    subject: str
    roles: tuple[str, ...]
    groups: tuple[str, ...]
    issuer: str

    @property
    def display(self) -> str:
        return self.subject


class AuthError(Exception):
    pass


def mint_dev_token(settings: Settings, username: str, ttl_s: int = 8 * 3600) -> str:
    if not settings.dev_issuer_enabled:
        raise AuthError("dev token issuer is disabled")
    user = DEMO_USERS.get(username)
    if user is None:
        raise AuthError(f"unknown demo user {username!r}")
    now = int(time.time())
    claims = {
        "iss": DEV_ISSUER,
        "aud": DEV_AUDIENCE,
        "sub": user.username,
        "name": user.display_name,
        "roles": list(user.roles),
        "groups": list(user.groups),
        "iat": now,
        "exp": now + ttl_s,
    }
    secret = settings.effective_dev_secret
    assert secret is not None
    return jwt.encode(claims, secret, algorithm="HS256")


@lru_cache(maxsize=4)
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True)


def _as_tuple(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        return tuple(v for v in value.replace(",", " ").split() if v)
    return tuple(str(v) for v in value)


def verify_token(settings: Settings, token: str) -> Principal:
    try:
        unverified = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError as exc:
        raise AuthError("malformed token") from exc
    issuer = unverified.get("iss")

    if issuer == DEV_ISSUER:
        secret = settings.effective_dev_secret
        if not settings.dev_issuer_enabled or not secret:
            raise AuthError("dev tokens are not accepted in this environment")
        try:
            claims = jwt.decode(token, secret, algorithms=["HS256"], audience=DEV_AUDIENCE, issuer=DEV_ISSUER)
        except jwt.PyJWTError as exc:
            raise AuthError(f"invalid token: {exc}") from exc
        if claims["sub"] not in DEMO_USERS:
            raise AuthError("unknown demo user")
        return Principal(
            claims["sub"], _as_tuple(claims.get("roles")), _as_tuple(claims.get("groups")), issuer
        )

    if settings.oidc_issuer and settings.oidc_jwks_url and issuer == settings.oidc_issuer:
        try:
            key = _jwks_client(settings.oidc_jwks_url).get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256", "RS384", "RS512", "ES256", "ES384", "PS256"],
                audience=settings.oidc_audience,
                issuer=settings.oidc_issuer,
                options={"verify_aud": settings.oidc_audience is not None},
            )
        except jwt.PyJWTError as exc:
            raise AuthError(f"invalid token: {exc}") from exc
        subject = claims.get("preferred_username") or claims.get("email") or claims["sub"]
        return Principal(
            str(subject),
            _as_tuple(claims.get(settings.oidc_roles_claim)),
            _as_tuple(claims.get(settings.oidc_groups_claim)),
            issuer,
        )

    raise AuthError("token issuer is not trusted")
