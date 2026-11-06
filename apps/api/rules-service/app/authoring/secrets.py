"""Resolve `api_key_ref` references to secrets, and redact them from anything we emit.

Supported references:
- `env:NAME`       environment variable (local dev, and Vercel encrypted env vars)
- `aws-sm:NAME`    AWS Secrets Manager (needs boto3 and AWS credentials at runtime)
New stores register a resolver with `register_scheme`.
Raw keys never reach the database, the BFF, the browser, logs, traces or the audit log.
"""

import os
import re
import threading
from collections.abc import Callable

Resolver = Callable[[str], str]

_resolvers: dict[str, Resolver] = {}
_known_secrets: set[str] = set()
_lock = threading.Lock()

# Common key shapes, redacted even if they were never resolved through us.
_KEY_PATTERNS = re.compile(r"(sk-[A-Za-z0-9_\-]{8,}|sk-ant-[A-Za-z0-9_\-]{8,}|Bearer\s+[A-Za-z0-9._\-]{16,})")
REDACTED = "[redacted]"


class SecretError(Exception):
    pass


def register_scheme(scheme: str, resolver: Resolver) -> None:
    _resolvers[scheme] = resolver


def _env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SecretError(f"environment variable {name} is not set")
    return value


def _aws_sm(name: str) -> str:
    try:
        import boto3  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise SecretError("aws-sm: references need boto3 installed in the deployment") from exc
    client = boto3.client("secretsmanager")
    value = client.get_secret_value(SecretId=name).get("SecretString")
    if not value:
        raise SecretError(f"secret {name} has no SecretString")
    return str(value)


register_scheme("env", _env)
register_scheme("aws-sm", _aws_sm)


def validate_ref(ref: str) -> None:
    scheme, sep, name = ref.partition(":")
    if not sep or not name or scheme not in _resolvers:
        raise SecretError(f"unsupported key reference; use one of: {', '.join(sorted(s + ':' for s in _resolvers))}")


def resolve(ref: str | None) -> str | None:
    if not ref:
        return None
    validate_ref(ref)
    scheme, _, name = ref.partition(":")
    value = _resolvers[scheme](name)
    with _lock:
        _known_secrets.add(value)
    return value


def redact(text: str) -> str:
    """Remove every secret this process has resolved, plus anything shaped like a key."""
    with _lock:
        secrets = sorted(_known_secrets, key=len, reverse=True)
    for secret in secrets:
        if secret and len(secret) >= 6:
            text = text.replace(secret, REDACTED)
    return _KEY_PATTERNS.sub(REDACTED, text)
