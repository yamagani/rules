"""JDM validation: structure, ZEN load, and per-cell expression checks."""

import hashlib
import json
from typing import Any

import zen

from app.errors import Unprocessable

NODE_TYPES = {
    "inputNode",
    "outputNode",
    "decisionTableNode",
    "expressionNode",
    "switchNode",
    "functionNode",
    "decisionNode",
    "customNode",
}


def canonical_json(content: dict[str, Any]) -> str:
    return json.dumps(content, sort_keys=True, separators=(",", ":"))


def checksum(content: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(content).encode()).hexdigest()


def clean_engine_error(message: str) -> str:
    """ZEN errors carry a Rust backtrace; keep only the meaningful head."""
    head = message.split("Stack backtrace:")[0].strip()
    return " ".join(line.strip() for line in head.splitlines() if line.strip())


def _issue(node: dict[str, Any] | None, where: str, error: str) -> dict[str, Any]:
    return {
        "node_id": node.get("id") if node else None,
        "node_name": node.get("name") if node else None,
        "where": where,
        "error": error,
    }


def _compile_error(source: str, unary: bool) -> str | None:
    """Compile with ZEN's own compiler, which matches what the engine accepts at evaluation time.
    (zen 2.1.3's `validate_unary_expression` rejects valid shorthand such as `< 18`; see D-108.)"""
    try:
        (zen.compile_unary_expression if unary else zen.compile_expression)(source)
    except Exception as exc:
        raw = clean_engine_error(str(exc))
        try:
            return str(json.loads(raw).get("source", raw))
        except (ValueError, AttributeError):
            return raw
    return None


def lint_expressions(content: dict[str, Any]) -> list[dict[str, Any]]:
    """`ZenDecision.validate()` checks the graph, not the expressions inside cells, which only
    fail at evaluation time. Compile every cell with ZEN's expression compiler."""
    issues: list[dict[str, Any]] = []
    for node in content.get("nodes", []):
        body = node.get("content") or {}
        kind = node.get("type")
        if kind == "decisionTableNode":
            input_ids = {i.get("id"): i for i in body.get("inputs", [])}
            output_ids = {o.get("id"): o for o in body.get("outputs", [])}
            for idx, rule in enumerate(body.get("rules", [])):
                for col_id, cell in rule.items():
                    if col_id == "_id" or not isinstance(cell, str) or not cell.strip():
                        continue
                    if col_id in input_ids:
                        err = _compile_error(cell, unary=True)
                        col = input_ids[col_id].get("field") or input_ids[col_id].get("name") or col_id
                    elif col_id in output_ids:
                        err = _compile_error(cell, unary=False)
                        col = output_ids[col_id].get("field") or output_ids[col_id].get("name") or col_id
                    else:
                        continue
                    if err:
                        issues.append(_issue(node, f"rule {idx + 1}, column '{col}': {cell}", err))
        elif kind == "expressionNode":
            for expr in body.get("expressions", []):
                value = expr.get("value")
                if isinstance(value, str) and value.strip():
                    err = _compile_error(value, unary=False)
                    if err:
                        issues.append(_issue(node, f"expression '{expr.get('key')}': {value}", err))
        elif kind == "switchNode":
            for idx, stmt in enumerate(body.get("statements", [])):
                cond = stmt.get("condition")
                if isinstance(cond, str) and cond.strip():
                    err = _compile_error(cond, unary=False)
                    if err:
                        issues.append(_issue(node, f"statement {idx + 1}: {cond}", err))
    return issues


def structural_issues(content: Any) -> list[dict[str, Any]]:
    if not isinstance(content, dict):
        return [_issue(None, "document", "JDM must be a JSON object")]
    issues: list[dict[str, Any]] = []
    nodes, edges = content.get("nodes"), content.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return [_issue(None, "document", "JDM must contain 'nodes' and 'edges' arrays")]
    for n in nodes:
        if not isinstance(n, dict) or "id" not in n or "type" not in n:
            issues.append(_issue(None, "nodes", "every node needs 'id' and 'type'"))
        elif n["type"] not in NODE_TYPES:
            issues.append(_issue(n, "type", f"unknown node type '{n['type']}'"))
    return issues


def validation_issues(content: Any) -> list[dict[str, Any]]:
    """All problems with a JDM document, empty when it can be stored and evaluated."""
    issues = structural_issues(content)
    if issues:
        return issues
    try:
        decision = zen.ZenEngine().create_decision(json.dumps(content))
        decision.validate()
    except Exception as exc:  # zen raises RuntimeError with a JSON or text payload
        return [_issue(None, "engine", clean_engine_error(str(exc)))]
    return lint_expressions(content)


def ensure_valid(content: Any) -> None:
    issues = validation_issues(content)
    if issues:
        raise Unprocessable("The decision graph failed validation", errors=issues)
