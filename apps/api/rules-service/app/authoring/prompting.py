"""Builds prompts from the versioned templates in `app/authoring/prompts/`."""

import json
from functools import cache
from pathlib import Path
from string import Template
from typing import Any

PROMPTS = Path(__file__).resolve().parent / "prompts"
TEMPLATE_VERSION = "generate.v1"


@cache
def _read(name: str) -> str:
    return (PROMPTS / name).read_text()


def _template(name: str, **values: str) -> str:
    return Template(_read(name)).substitute(**values)


def _few_shots() -> str:
    blocks = []
    for path in sorted((PROMPTS / "examples").glob("*.json")):
        example = json.loads(path.read_text())
        blocks.append(f"Request: {example['description']}\nJDM:\n{json.dumps(example['jdm'], separators=(',', ':'))}")
    return "\n\n".join(blocks)


def _fence_safe(text: str, tag: str) -> str:
    """Stop pasted text from closing the delimiter it is wrapped in."""
    return text.replace(f"</{tag}>", f"</{tag}_>").replace(f"<{tag}>", f"<{tag}_>")


def generate_system() -> str:
    return _template("generate.v1.md", jdm_spec=_read("jdm_spec.v1.md"), few_shots=_few_shots())


def generate_user(
    prompt: str,
    input_schema: dict[str, Any] | None,
    examples: list[dict[str, Any]],
    context_text: str | None,
    base_jdm: dict[str, Any] | None,
    base_version: int | None,
) -> str:
    schema_part = (
        f"Input schema (JSON Schema of the request context):\n{json.dumps(input_schema)}\n\n" if input_schema else ""
    )
    examples_part = ""
    if examples:
        lines = [
            f"- input: {json.dumps(e.get('input', {}))} -> expected output: {json.dumps(e.get('expected', {}))}"
            for e in examples
        ]
        examples_part = "Examples the rule must satisfy:\n" + "\n".join(lines) + "\n\n"
    base_part = ""
    if base_jdm is not None:
        base_part = (
            f"Modify version {base_version} below instead of starting from scratch; keep node ids where possible.\n"
            f"<jdm>{json.dumps(base_jdm, separators=(',', ':'))}</jdm>\n\n"
        )
    context_part = ""
    if context_text:
        context_part = f"<context_document>\n{_fence_safe(context_text, 'context_document')}\n</context_document>\n\n"
    return _template(
        "generate_user.v1.md",
        prompt=_fence_safe(prompt, "rule_description"),
        input_schema=schema_part,
        examples=examples_part,
        base_version=base_part,
        context=context_part,
    )


def repair(stage: str, errors: list[str]) -> str:
    return _template("repair.v1.md", stage=stage, errors="\n".join(f"- {e}" for e in errors[:30]))


def explain_system() -> str:
    return _template("explain.v1.md", jdm_spec=_read("jdm_spec.v1.md"))


def explain_user(jdm: dict[str, Any], decision_name: str, version: int) -> str:
    return f"Decision '{decision_name}', version {version}:\n<jdm>{json.dumps(jdm, separators=(',', ':'))}</jdm>"
