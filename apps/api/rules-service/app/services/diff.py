"""Structured JSON diff tuned for JDM: arrays of objects with `id`/`_id` are compared by
identity, so a moved node or an edited table cell shows up as one precise change."""

from typing import Any

from app.schemas import DiffChange


def _keyed(items: list[Any]) -> dict[str, Any] | None:
    if not items or not all(isinstance(i, dict) for i in items):
        return None
    for key in ("id", "_id"):
        if all(key in i for i in items):
            ids = [str(i[key]) for i in items]
            if len(set(ids)) == len(ids):
                return {f"{key}={i}": item for i, item in zip(ids, items, strict=True)}
    return None


def diff(before: Any, after: Any, path: str = "") -> list[DiffChange]:
    if isinstance(before, dict) and isinstance(after, dict):
        changes: list[DiffChange] = []
        for k in before.keys() | after.keys():
            sub = f"{path}/{k}"
            if k not in after:
                changes.append(DiffChange(path=sub, kind="removed", before=before[k]))
            elif k not in before:
                changes.append(DiffChange(path=sub, kind="added", after=after[k]))
            else:
                changes.extend(diff(before[k], after[k], sub))
        return sorted(changes, key=lambda c: c.path)
    if isinstance(before, list) and isinstance(after, list):
        kb, ka = _keyed(before), _keyed(after)
        if kb is not None and ka is not None:
            return diff(kb, ka, path)
        if len(before) == len(after):
            out: list[DiffChange] = []
            for i, (b, a) in enumerate(zip(before, after, strict=True)):
                out.extend(diff(b, a, f"{path}/{i}"))
            return out
    if before != after:
        return [DiffChange(path=path or "/", kind="changed", before=before, after=after)]
    return []


def summarize(changes: list[DiffChange]) -> dict[str, int]:
    summary = {"added": 0, "removed": 0, "changed": 0}
    for c in changes:
        summary[c.kind] += 1
    return summary
