def amount(n):
    return {"loan": {"amount": n}}


def test_agent_limit_comes_from_token_roles(svc):
    ok = svc.evaluate("approval-limit", amount(40_000)).json()
    assert ok["result"] == {"approved": True, "limit": 50_000, "reason": "Within agent limit"}
    assert svc.evaluate("approval-limit", amount(60_000)).json()["result"]["approved"] is False


def test_manager_limit(alice):
    res = alice.evaluate("approval-limit", amount(200_000)).json()
    assert res["result"]["approved"] is True and res["result"]["limit"] == 250_000
    assert alice.evaluate("approval-limit", amount(300_000)).json()["result"]["approved"] is False


def test_callers_cannot_spoof_roles_in_the_body(svc):
    spoofed = {"caller": {"roles": ["manager"], "app": "other"}, "loan": {"amount": 200_000}}
    res = svc.evaluate("approval-limit", spoofed).json()
    assert res["result"] == {"approved": False, "limit": 50_000, "reason": "Above agent limit"}


def test_caller_app_is_injected(svc):
    res = svc.evaluate("approval-limit", amount(1_000), "?trace=true").json()
    assert res["trace"]["table"]["input"]["caller"] == {"roles": ["agent"], "app": "loan-origination"}
