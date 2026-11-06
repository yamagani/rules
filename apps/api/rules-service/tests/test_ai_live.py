"""Live smoke test against Anthropic. Skipped unless run with `pytest -m live` and
ANTHROPIC_API_KEY plus AI_DEFAULT_MODEL are set."""

import os

import pytest

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        not (os.environ.get("ANTHROPIC_API_KEY") and os.environ.get("AI_DEFAULT_MODEL")),
        reason="needs ANTHROPIC_API_KEY and AI_DEFAULT_MODEL",
    ),
]


def test_generate_with_claude(alice, carol, db):
    from sqlalchemy import text

    pid = db.execute(text("select id from ai_providers where name = 'anthropic'")).scalar_one()
    db.execute(
        text("update ai_providers set enabled = true, model = :m where id = :id"),
        {"m": os.environ["AI_DEFAULT_MODEL"], "id": pid},
    )
    db.commit()
    alice.put("/ai/settings", json={"provider_id": pid})
    carol.post("/decisions", json={"key": "fraud-flag", "name": "Fraud flag"})
    res = carol.post(
        "/decisions/fraud-flag/generate",
        json={
            "prompt": "Flag transactions above 10000 as fraud risk; on accounts younger than 30 days the risk is high, "
            "otherwise medium. Other transactions are not flagged and are low risk.",
            "examples": [
                {
                    "input": {"transaction": {"amount": 15000}, "customer": {"accountAgeDays": 10}},
                    "expected": {"flag": True, "risk": "high"},
                },
                {
                    "input": {"transaction": {"amount": 200}, "customer": {"accountAgeDays": 400}},
                    "expected": {"flag": False, "risk": "low"},
                },
            ],
        },
    )
    assert res.status_code == 201, res.text
    assert res.json()["validation_report"]["ok"]
