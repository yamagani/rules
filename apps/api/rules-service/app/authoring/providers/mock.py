"""Deterministic provider for tests, CI and local runs without keys.

Generate requests return canned JDM from `app/authoring/fixtures/*.json`, chosen by keywords
in the user's prompt. Explain requests describe the JDM's structure deterministically.
Tests can queue scripted replies or errors per provider name with `MockProvider.script`.
"""

import json
import re
from pathlib import Path
from typing import Any, ClassVar

from app.authoring.providers.base import Completion, Message, ProviderError, Usage

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


def _tokens(text: str) -> int:
    return max(1, len(text) // 4)


def load_fixtures() -> list[dict[str, Any]]:
    return [json.loads(p.read_text()) for p in sorted(FIXTURES.glob("*.json"))]


def describe_jdm(jdm: dict[str, Any]) -> str:
    parts: list[str] = []
    for node in jdm.get("nodes", []):
        body = node.get("content") or {}
        if node.get("type") == "decisionTableNode":
            inputs = ", ".join(i.get("field") or i.get("name", "?") for i in body.get("inputs", []))
            outputs = ", ".join(o.get("field") or o.get("name", "?") for o in body.get("outputs", []))
            rules = len(body.get("rules", []))
            parts.append(
                f"The table '{node.get('name')}' checks {inputs} and sets {outputs}, using {rules} "
                f"rules with the '{body.get('hitPolicy', 'first')}' hit policy."
            )
        elif node.get("type") == "switchNode":
            conds = [s.get("condition") or "otherwise" for s in body.get("statements", [])]
            parts.append(f"The switch '{node.get('name')}' routes on: {'; '.join(conds)}.")
        elif node.get("type") == "expressionNode":
            keys = ", ".join(e.get("key", "?") for e in body.get("expressions", []))
            parts.append(f"The expression node '{node.get('name')}' computes {keys}.")
    return " ".join(parts) or "This decision has no logic nodes yet."


class MockProvider:
    scripts: ClassVar[dict[str, list[str | Exception]]] = {}
    calls: ClassVar[list[dict[str, Any]]] = []

    def __init__(self, name: str, model: str) -> None:
        self.name, self.model = name, model

    @classmethod
    def script(cls, provider_name: str, *replies: str | Exception) -> None:
        cls.scripts.setdefault(provider_name, []).extend(replies)

    @classmethod
    def reset(cls) -> None:
        cls.scripts.clear()
        cls.calls.clear()

    def complete(
        self, system: str, messages: list[Message], json_schema: dict[str, Any] | None, max_tokens: int, timeout: float
    ) -> Completion:
        self.calls.append({"provider": self.name, "system": system, "messages": messages, "timeout": timeout})
        prompt = "\n".join(m.content for m in messages)
        usage = Usage(_tokens(system + prompt), 0)
        queue = self.scripts.get(self.name)
        if queue:
            item = queue.pop(0)
            if isinstance(item, Exception):
                raise item
            usage.output_tokens = _tokens(item)
            return Completion(item, usage, self.model)

        if json_schema is not None and "jdm" not in json_schema.get("properties", {}):
            text = json.dumps({"explanation": describe_jdm(_jdm_in(prompt))})
        else:
            fixture = _pick_fixture(messages[0].content if messages else "")
            text = json.dumps(
                {
                    "summary": fixture["summary"],
                    "explanation": fixture["explanation"],
                    "jdm": json.dumps(fixture["jdm"]),
                }
            )
        usage.output_tokens = _tokens(text)
        return Completion(text, usage, self.model)


def _pick_fixture(request_text: str) -> dict[str, Any]:
    # Only the author's own description counts, not examples or pasted context.
    match = re.search(r"<rule_description>(.*?)</rule_description>", request_text, re.S)
    text = (match.group(1) if match else request_text).lower()
    fixtures = load_fixtures()
    for fixture in fixtures:
        if any(k in text for k in fixture.get("keywords", [])):
            return fixture
    generic = next((f for f in fixtures if not f.get("keywords")), None)
    if generic is None:
        raise ProviderError("mock provider has no fixture for this prompt", retryable=False)
    return generic


def _jdm_in(prompt: str) -> dict[str, Any]:
    match = re.search(r"<jdm>(.*?)</jdm>", prompt, re.S)
    if not match:
        return {}
    try:
        value = json.loads(match.group(1))
        return value if isinstance(value, dict) else {}
    except ValueError:
        return {}
