import copy

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.conftest import ADULT


def eligibility_v5(bob):
    return bob.get("/decisions/eligibility/versions/5").json()["content"]


def test_seeded_versions_and_aliases(dave):
    detail = dave.get("/decisions/eligibility").json()
    statuses = {v["version"]: v["status"] for v in detail["versions"]}
    assert statuses == {1: "disabled", 2: "deprecated", 3: "active", 4: "active", 5: "draft"}
    assert {a["alias"]: a["version"] for a in detail["aliases"]} == {"default": 3, "stable": 3, "beta": 4}
    assert detail["latest_draft"]["version"] == 5
    v3 = next(v for v in detail["versions"] if v["version"] == 3)
    assert v3["aliases"] == ["default", "stable"]


def test_saving_creates_a_new_immutable_version(carol, db):
    content = eligibility_v5(carol)
    content["nodes"][1]["content"]["rules"][0]["reason"] = "'Too young'"
    res = carol.post("/decisions/eligibility/versions", json={"content": content, "comment": "reword"})
    assert res.status_code == 201, res.text
    assert res.json()["version"] == 6 and res.json()["status"] == "draft"
    # v5 is untouched
    assert carol.get("/decisions/eligibility/versions/5").json()["content"] != content

    # The database refuses to change stored content, even outside the API.
    with pytest.raises(DBAPIError, match="immutable"):
        db.execute(text("UPDATE decision_versions SET content = '{}'::jsonb WHERE version = 3"))
        db.flush()
    db.rollback()
    # ...while lifecycle fields may change.
    db.execute(text("UPDATE decision_versions SET comment = 'note' WHERE version = 3"))
    db.rollback()


def test_invalid_jdm_is_rejected_with_engine_errors(carol):
    bad = {
        "nodes": [{"id": "x", "type": "inputNode", "name": "in"}],
        "edges": [{"id": "e", "sourceId": "x", "targetId": "nope"}],
    }
    res = carol.post("/decisions/eligibility/versions", json={"content": bad})
    assert res.status_code == 422
    assert res.headers["content-type"].startswith("application/problem+json")
    assert res.json()["errors"][0]["where"] == "engine"

    content = eligibility_v5(carol)
    content["nodes"][1]["content"]["rules"][0]["age"] = ">>> 18"
    res = carol.post("/decisions/eligibility/versions", json={"content": content})
    assert res.status_code == 422
    assert "rule 1" in res.json()["errors"][0]["where"]


def test_activation_gate_blocks_failing_tests(carol, bob, alice):
    content = eligibility_v5(carol)
    content["nodes"][1]["content"]["rules"][0]["eligible"] = "true"  # minors become eligible
    v = carol.post("/decisions/eligibility/versions", json={"content": content}).json()["version"]

    res = bob.post(f"/decisions/eligibility/versions/{v}/activate", json={})
    assert res.status_code == 409
    body = res.json()
    assert body["tests"]["failed"] == 1
    failed = [r for r in body["tests"]["results"] if not r["passed"]]
    assert failed[0]["name"] == "minor is rejected"
    assert bob.get(f"/decisions/eligibility/versions/{v}").json()["status"] == "draft"

    # force is admin-only
    assert bob.post(f"/decisions/eligibility/versions/{v}/activate", json={"force": True}).status_code == 403
    res = alice.post(f"/decisions/eligibility/versions/{v}/activate", json={"force": True})
    assert res.status_code == 200 and res.json()["version"]["status"] == "active"


def test_multiple_active_versions_by_exact_version_and_alias(bob, svc):
    res = bob.post("/decisions/eligibility/versions/5/activate", json={"aliases": ["beta"]})
    assert res.status_code == 200, res.text
    assert res.json()["tests"]["failed"] == 0

    statuses = {v["version"]: v["status"] for v in bob.get("/decisions/eligibility").json()["versions"]}
    assert [n for n, s in statuses.items() if s == "active"] == [5, 4, 3]

    old = {"applicant": {"age": 80, "creditScore": 700}, "loan": {"amount": 100_000}}
    for query, version, eligible in [
        ("?version=3", 3, True),
        ("?version=4", 4, True),
        ("?version=5", 5, False),  # v5 adds a maximum age
        ("?alias=stable", 3, True),
        ("?alias=beta", 5, False),
        ("", 3, True),
    ]:
        res = svc.evaluate("eligibility", old, query)
        assert res.status_code == 200, (query, res.text)
        assert res.json()["meta"]["version"] == version
        assert res.json()["result"]["eligible"] is eligible


def test_deprecation_headers(bob, svc):
    res = svc.evaluate("eligibility", ADULT, "?version=2")
    assert res.status_code == 200
    assert res.headers["Deprecation"] == "true"
    assert res.headers["Sunset"].endswith("GMT")
    assert res.json()["meta"]["deprecated"] is True

    bob.post("/decisions/eligibility/versions/4/deprecate", json={"sunset_at": "2027-01-31T00:00:00Z"})
    res = svc.evaluate("eligibility", ADULT, "?alias=beta")
    assert res.headers["Deprecation"] == "true"
    assert res.headers["Sunset"] == "Sun, 31 Jan 2027 00:00:00 GMT"
    assert "Deprecation" not in svc.evaluate("eligibility", ADULT).headers


def test_disabled_version_is_gone(svc):
    res = svc.evaluate("eligibility", ADULT, "?version=1")
    assert res.status_code == 410
    assert res.headers["content-type"].startswith("application/problem+json")
    assert res.headers["X-Rule-Version"] == "1"
    alternatives = {a["version"]: a for a in res.json()["alternatives"]}
    assert set(alternatives) == {2, 3, 4}
    assert alternatives[3]["aliases"] == ["default", "stable"]


def test_disabling_an_aliased_version_conflicts(bob, svc):
    res = bob.post("/decisions/eligibility/versions/3/disable")
    assert res.status_code == 409
    assert set(res.json()["aliases"]) == {"default", "stable"}
    # after moving the aliases away it works and takes effect immediately
    bob.put("/decisions/eligibility/aliases/default", json={"version": 4})
    bob.put("/decisions/eligibility/aliases/stable", json={"version": 4})
    assert svc.evaluate("eligibility", ADULT, "?version=3").status_code == 200  # warms caches
    assert bob.post("/decisions/eligibility/versions/3/disable").status_code == 200
    assert svc.evaluate("eligibility", ADULT, "?version=3").status_code == 410


def test_aliases_only_point_at_servable_versions(bob):
    assert bob.put("/decisions/eligibility/aliases/beta", json={"version": 5}).status_code == 409  # draft
    assert bob.put("/decisions/eligibility/aliases/beta", json={"version": 1}).status_code == 409  # disabled
    assert (
        bob.put("/decisions/eligibility/aliases/legacy", json={"version": 2}).status_code == 200
    )  # deprecated
    assert bob.delete("/decisions/eligibility/aliases/default").status_code == 409
    assert bob.delete("/decisions/eligibility/aliases/legacy").status_code == 200


def test_re_enable_runs_the_test_gate(bob, svc):
    assert bob.post("/decisions/eligibility/versions/2/disable").status_code == 200
    assert svc.evaluate("eligibility", ADULT, "?version=2").status_code == 410
    res = bob.post("/decisions/eligibility/versions/2/enable")
    assert res.status_code == 200 and res.json()["version"]["status"] == "active"
    assert res.json()["tests"]["passed"] == 3
    assert svc.evaluate("eligibility", ADULT, "?version=2").status_code == 200

    # v1 (age only) fails the stored "poor credit" test, so re-enabling it is blocked
    res = bob.post("/decisions/eligibility/versions/1/enable")
    assert res.status_code == 409
    assert res.json()["tests"]["failed"] == 1


def test_rollback_by_moving_the_default_alias(bob, svc, alice):
    assert svc.evaluate("eligibility", ADULT).json()["meta"]["version"] == 3
    assert bob.put("/decisions/eligibility/aliases/default", json={"version": 4}).status_code == 200
    assert svc.evaluate("eligibility", ADULT).json()["meta"]["version"] == 4
    assert bob.put("/decisions/eligibility/aliases/default", json={"version": 3}).status_code == 200
    assert svc.evaluate("eligibility", ADULT).json()["meta"]["version"] == 3

    moves = [e for e in alice.get("/audit").json() if e["action"] == "alias.moved"]
    assert [(m["details"]["old_version"], m["details"]["new_version"]) for m in moves] == [(4, 3), (3, 4)]
    assert moves[0]["actor"] == "bob"


def test_meta_version_in_every_evaluate_response(svc, carol):
    for query in ["", "?alias=stable", "?alias=beta", "?version=2", "?version=3", "?version=4"]:
        res = svc.evaluate("eligibility", ADULT, query)
        assert res.status_code == 200
        assert res.json()["meta"]["version"] == int(res.headers["X-Rule-Version"])
    res = carol.evaluate("eligibility", ADULT, "?draft=true&trace=true")
    assert res.json()["meta"] == res.json()["meta"] | {
        "version": 5,
        "status": "draft",
        "resolved_by": "draft",
    }
    assert res.headers["X-Rule-Version"] == "5"
    assert "table" in res.json()["trace"]


def test_diff_between_versions(dave):
    res = dave.get("/decisions/eligibility/diff?from=3&to=5")
    assert res.status_code == 200
    body = res.json()
    assert body["summary"]["changed"] > 0 or body["summary"]["added"] > 0
    assert any("/nodes/id=table/content/rules" in c["path"] for c in body["changes"])


def test_usage_counts_per_version(svc, bob):
    before = {
        v["version"]: v["total"] for v in bob.get("/decisions/eligibility/usage?days=7").json()["versions"]
    }
    assert before[2] == 0  # deprecated: no remaining callers
    svc.evaluate("eligibility", ADULT, "?version=2")
    svc.evaluate("eligibility", ADULT, "?version=2")
    after = {v["version"]: v for v in bob.get("/decisions/eligibility/usage?days=7").json()["versions"]}
    assert after[2]["total"] == 2
    assert after[3]["aliases"] == ["default", "stable"]
    assert 5 not in after  # drafts are not usage-tracked


def test_lifecycle_changes_are_audited(bob, alice):
    bob.post("/decisions/eligibility/versions/5/activate", json={"aliases": ["beta"]})
    bob.post("/decisions/eligibility/versions/2/disable")
    entries = alice.get("/audit?decision=eligibility").json()
    actions = [e["action"] for e in entries[:3]]
    assert actions == ["version.disabled", "alias.moved", "version.activated"]
    disabled = entries[0]
    assert (
        disabled["details"]["old_status"] == "deprecated" and disabled["details"]["new_status"] == "disabled"
    )
    moved = entries[1]["details"]
    assert (moved["alias"], moved["old_version"], moved["new_version"]) == ("beta", 4, 5)


def test_decision_with_no_versions_has_no_default(carol, svc):
    assert carol.post("/decisions", json={"key": "fraud-flag", "name": "Fraud flag"}).status_code == 201
    res = svc.evaluate("fraud-flag", {})
    assert res.status_code == 404


def test_first_activation_creates_the_default_alias(carol, bob):
    carol.post("/decisions", json={"key": "copy", "name": "Copy"})
    content = copy.deepcopy(carol.get("/decisions/pricing/versions/1").json()["content"])
    carol.post("/decisions/copy/versions", json={"content": content})
    res = bob.post("/decisions/copy/versions/1/activate")
    assert res.status_code == 200
    assert [(a["alias"], a["version"]) for a in res.json()["aliases"]] == [("default", 1)]
