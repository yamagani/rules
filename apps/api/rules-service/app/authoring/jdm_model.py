"""Pydantic model of JDM, used as validation stage (b) for generated documents."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator


class _Loose(BaseModel):
    model_config = ConfigDict(extra="allow")


class Position(_Loose):
    x: float
    y: float


class TableColumn(_Loose):
    id: str
    name: str | None = None
    field: str | None = None


class DecisionTableContent(_Loose):
    hitPolicy: Literal["first", "collect"]
    inputs: list[TableColumn]
    outputs: list[TableColumn] = Field(min_length=1)
    rules: list[dict[str, Any]] = Field(min_length=1)

    @model_validator(mode="after")
    def rules_use_known_columns(self) -> "DecisionTableContent":
        columns = {c.id for c in self.inputs} | {c.id for c in self.outputs} | {"_id", "_description"}
        for idx, rule in enumerate(self.rules):
            if "_id" not in rule:
                raise ValueError(f"rule {idx + 1} has no _id")
            unknown = set(rule) - columns
            if unknown:
                raise ValueError(f"rule {idx + 1} uses unknown column ids {sorted(unknown)}")
            for key, value in rule.items():
                if key != "_id" and not isinstance(value, str):
                    raise ValueError(f"rule {idx + 1} cell '{key}' must be a string expression")
        return self


class Expression(_Loose):
    id: str
    key: str = Field(min_length=1)
    value: str


class ExpressionContent(_Loose):
    expressions: list[Expression] = Field(min_length=1)


class Statement(_Loose):
    id: str
    condition: str = ""


class SwitchContent(_Loose):
    hitPolicy: Literal["first", "collect"] = "first"
    statements: list[Statement] = Field(min_length=1)


CONTENT_MODELS: dict[str, type[BaseModel]] = {
    "decisionTableNode": DecisionTableContent,
    "expressionNode": ExpressionContent,
    "switchNode": SwitchContent,
}


class Node(_Loose):
    id: str = Field(min_length=1)
    type: Literal[
        "inputNode",
        "outputNode",
        "decisionTableNode",
        "expressionNode",
        "switchNode",
        "functionNode",
        "decisionNode",
        "customNode",
    ]
    name: str
    position: Position | None = None
    content: Any = None

    @model_validator(mode="after")
    def content_shape(self) -> "Node":
        model = CONTENT_MODELS.get(self.type)
        if model is not None:
            if not isinstance(self.content, dict):
                raise ValueError(f"{self.type} '{self.id}' needs a content object")
            model.model_validate(self.content)
        return self


class Edge(_Loose):
    id: str
    sourceId: str
    targetId: str
    sourceHandle: str | None = None
    type: str | None = None


class JDM(_Loose):
    nodes: list[Node] = Field(min_length=2)
    edges: list[Edge] = Field(min_length=1)

    @field_validator("nodes")
    @classmethod
    def unique_ids(cls, nodes: list[Node]) -> list[Node]:
        ids = [n.id for n in nodes]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            raise ValueError(f"duplicate node ids {sorted(dupes)}")
        return nodes

    @model_validator(mode="after")
    def graph(self) -> "JDM":
        kinds = [n.type for n in self.nodes]
        if kinds.count("inputNode") != 1:
            raise ValueError("exactly one inputNode is required")
        if "outputNode" not in kinds:
            raise ValueError("an outputNode is required")
        ids = {n.id for n in self.nodes}
        for e in self.edges:
            if e.sourceId not in ids or e.targetId not in ids:
                raise ValueError(f"edge '{e.id}' references an unknown node")
        return self


def schema_errors(document: Any) -> list[str]:
    try:
        JDM.model_validate(document)
    except ValidationError as exc:
        return [f"{'.'.join(str(p) for p in err['loc']) or 'document'}: {err['msg']}" for err in exc.errors()]
    return []
