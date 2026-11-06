"""Small builders for JDM graphs used by the seed data and test fixtures."""

from typing import Any

Cell = str


def _node(node_id: str, kind: str, name: str, x: int, y: int, content: dict[str, Any] | None = None) -> dict[str, Any]:
    node: dict[str, Any] = {"id": node_id, "type": kind, "name": name, "position": {"x": x, "y": y}}
    if content is not None:
        node["content"] = content
    return node


def _edge(edge_id: str, source: str, target: str, handle: str | None = None) -> dict[str, Any]:
    edge = {"id": edge_id, "sourceId": source, "targetId": target, "type": "edge"}
    if handle:
        edge["sourceHandle"] = handle
    return edge


def decision_table(
    name: str,
    inputs: list[tuple[str, str, str]],
    outputs: list[tuple[str, str, str]],
    rules: list[list[Cell]],
    hit_policy: str = "first",
) -> dict[str, Any]:
    """A request -> table -> response graph.

    inputs/outputs: (column id, label, field). rules: one list of cells per row,
    input cells first, then output cells.
    """
    columns = [c[0] for c in inputs] + [c[0] for c in outputs]
    table_rules = []
    for idx, row in enumerate(rules):
        assert len(row) == len(columns), f"rule {idx} has {len(row)} cells, expected {len(columns)}"
        table_rules.append({"_id": f"rule-{idx + 1}", **dict(zip(columns, row, strict=True))})
    table = _node(
        "table",
        "decisionTableNode",
        name,
        300,
        100,
        {
            "hitPolicy": hit_policy,
            "inputs": [{"id": i, "name": label, "field": field} for i, label, field in inputs],
            "outputs": [{"id": o, "name": label, "field": field} for o, label, field in outputs],
            "rules": table_rules,
        },
    )
    return {
        "nodes": [
            _node("request", "inputNode", "Request", 40, 100),
            table,
            _node("response", "outputNode", "Response", 700, 100),
        ],
        "edges": [
            _edge("e-request-table", "request", "table"),
            _edge("e-table-response", "table", "response"),
        ],
    }


def switch_with_expressions(name: str, branches: list[tuple[str, str, dict[str, str]]]) -> dict[str, Any]:
    """request -> switch -> one expression node per branch -> response.

    branches: (branch id, condition — empty for the default branch, {output key: expression}).
    """
    statements = [{"id": f"when-{bid}", "condition": cond} for bid, cond, _ in branches]
    nodes = [
        _node("request", "inputNode", "Request", 40, 160),
        _node("switch", "switchNode", name, 280, 160, {"hitPolicy": "first", "statements": statements}),
    ]
    edges = [_edge("e-request-switch", "request", "switch")]
    for idx, (bid, _cond, exprs) in enumerate(branches):
        nodes.append(
            _node(
                f"expr-{bid}",
                "expressionNode",
                bid.replace("-", " ").title(),
                560,
                40 + idx * 140,
                {"expressions": [{"id": f"{bid}-{k}", "key": k, "value": v} for k, v in exprs.items()]},
            )
        )
        edges.append(_edge(f"e-switch-{bid}", "switch", f"expr-{bid}", f"when-{bid}"))
        edges.append(_edge(f"e-{bid}-response", f"expr-{bid}", "response"))
    nodes.append(_node("response", "outputNode", "Response", 860, 160))
    return {"nodes": nodes, "edges": edges}
