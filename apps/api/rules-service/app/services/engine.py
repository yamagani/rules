"""ZEN engine integration with per-instance caches.

Caches are optimizations only (serverless instances come and go):
- parsed decisions keyed by version id: safe forever, because content is immutable;
- alias -> version id with a short TTL, invalidated locally on alias change.
Version *status* is always read from the database on evaluate, so a disable takes effect
immediately on every instance.
"""

import json
import threading
import time
from collections import OrderedDict
from typing import Any

import zen
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Application, Decision, DecisionAlias, DecisionVersion, VersionStatus


def decision_key(app_key: str, decision_key_: str, version_id: int) -> str:
    """Loader key format: "{app}/{decision}@{versionId}"."""
    return f"{app_key}/{decision_key_}@{version_id}"


class _DecisionCache:
    def __init__(self, size: int) -> None:
        self._size = size
        self._items: OrderedDict[int, zen.ZenDecision] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, version_id: int) -> zen.ZenDecision | None:
        with self._lock:
            item = self._items.get(version_id)
            if item is not None:
                self._items.move_to_end(version_id)
            return item

    def put(self, version_id: int, decision: zen.ZenDecision) -> None:
        with self._lock:
            self._items[version_id] = decision
            self._items.move_to_end(version_id)
            while len(self._items) > self._size:
                self._items.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()


class _AliasCache:
    def __init__(self) -> None:
        self._items: dict[tuple[int, str], tuple[int, float]] = {}
        self._lock = threading.Lock()

    def get(self, decision_id: int, alias: str) -> int | None:
        with self._lock:
            hit = self._items.get((decision_id, alias))
            if hit and hit[1] > time.monotonic():
                return hit[0]
            return None

    def put(self, decision_id: int, alias: str, version_id: int, ttl: float) -> None:
        with self._lock:
            self._items[(decision_id, alias)] = (version_id, time.monotonic() + ttl)

    def invalidate(self, decision_id: int, alias: str | None = None) -> None:
        with self._lock:
            for key in [k for k in self._items if k[0] == decision_id and (alias is None or k[1] == alias)]:
                del self._items[key]

    def clear(self) -> None:
        with self._lock:
            self._items.clear()


decisions = _DecisionCache(get_settings().decision_cache_size)
aliases = _AliasCache()


def _load_by_key(key: str) -> str:
    """ZEN loader for decisionNode references: "{app}/{decision}@{versionId}" or
    "{app}/{decision}" (resolves the decision's `default` alias). Disabled versions never load."""
    from app.db import _session_factory  # local import: avoid cycles at module import

    ref, _, version_part = key.partition("@")
    app_key, _, dec_key = ref.partition("/")
    with _session_factory()() as db:
        stmt = (
            select(DecisionVersion)
            .join(Decision, Decision.id == DecisionVersion.decision_id)
            .join(Application, Application.id == Decision.app_id)
            .where(Application.key == app_key, Decision.key == dec_key)
        )
        if version_part:
            stmt = stmt.where(DecisionVersion.id == int(version_part))
        else:
            stmt = stmt.join(DecisionAlias, DecisionAlias.version_id == DecisionVersion.id).where(
                DecisionAlias.alias == "default"
            )
        row = db.scalar(stmt)
        if row is None or row.status == VersionStatus.disabled:
            raise LookupError(f"decision '{key}' is not available")
        return json.dumps(row.content)


engine = zen.ZenEngine({"loader": _load_by_key})


def get_decision(db: Session, version: DecisionVersion) -> zen.ZenDecision:
    cached = decisions.get(version.id)
    if cached is not None:
        return cached
    content = db.scalar(select(DecisionVersion.content).where(DecisionVersion.id == version.id))
    parsed = engine.create_decision(json.dumps(content))
    decisions.put(version.id, parsed)
    return parsed


def evaluate_content(content: dict[str, Any], context: dict[str, Any], trace: bool = False) -> dict[str, Any]:
    """Evaluate a not-yet-stored graph (used by AI validation and tests)."""
    return dict(engine.create_decision(json.dumps(content)).evaluate(context, {"trace": trace}))


def evaluate(db: Session, version: DecisionVersion, context: dict[str, Any], trace: bool) -> dict[str, Any]:
    return dict(get_decision(db, version).evaluate(context, {"trace": trace}))
