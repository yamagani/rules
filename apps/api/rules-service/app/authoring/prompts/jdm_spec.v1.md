## JDM (JSON Decision Model) — compact specification

A decision is a directed graph: `{"nodes": [...], "edges": [...]}`.

### Nodes
Every node: `{"id": "<unique>", "type": "<type>", "name": "<label>", "position": {"x": <num>, "y": <num>}, "content": {...}}`.

- `inputNode` — exactly one. The request context enters here. No `content`.
- `outputNode` — at least one. The merged outputs of the nodes connected to it are the result. No `content`.
- `decisionTableNode` — `content`:
  ```
  {"hitPolicy": "first" | "collect",
   "inputs":  [{"id": "<col id>", "name": "<label>", "field": "<dot.path in the context>"}],
   "outputs": [{"id": "<col id>", "name": "<label>", "field": "<output key, may be dotted>"}],
   "rules":   [{"_id": "<row id>", "<input col id>": "<unary test>", "<output col id>": "<expression>"}]}
  ```
  Rows are evaluated top to bottom. `first` returns the first matching row's outputs;
  `collect` returns an array of all matching rows. An empty input cell (`""`) matches
  anything, so put a catch-all row last.
- `expressionNode` — `content: {"expressions": [{"id": "<id>", "key": "<output key>", "value": "<expression>"}]}`.
  Each key is set to the value of its expression, evaluated against the node's input.
- `switchNode` — `content: {"hitPolicy": "first", "statements": [{"id": "<id>", "condition": "<expression>"}]}`.
  An empty condition is the default branch (put it last). Edges leaving a switch carry
  `"sourceHandle": "<statement id>"` to say which branch they belong to.

### Edges
`{"id": "<unique>", "sourceId": "<node id>", "targetId": "<node id>", "type": "edge"}`
(plus `sourceHandle` for switch branches). Every node except the input must be reachable from the input.

### ZEN expression language
- Literals: `10`, `0.05`, `'text'` (single quotes), `true`, `false`, `null`, `[1, 2]`.
- Paths: `applicant.age`, `loan.amount`; arithmetic `+ - * / %`; comparison `== != < <= > >=`;
  logic `and`, `or`, `not`; ternary `cond ? a : b`; membership `'x' in list`; ranges `[1..5]`.
- Functions include `len(x)`, `contains(text_or_list, x)`, `upper(s)`, `lower(s)`, `abs(n)`,
  `round(n)`, `floor(n)`, `ceil(n)`, `min(list)`, `max(list)`, `sum(list)`, `some(list, # > 1)`, `all(list, # > 1)`.
- **Unary tests** (decision-table input cells) are written against the column's value:
  `> 18`, `<= 50000`, `[18..65]` (inclusive range), `'gold'`, `'gold', 'silver'` (any of),
  `> 1, < 3`, `'agent' in $` (`$` is the column value), or `""` for "any".
- **Output cells and expression values** are full expressions. Strings need single quotes:
  `'Eligible'`. Numbers and booleans are plain: `true`, `250000`.
