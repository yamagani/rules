import pytest

from tests.conftest import ADULT

# (user, method, path, body) -> expected status
CASES = [
    # view
    ("dave", "get", "/decisions", None, 200),
    ("svc-loan", "get", "/decisions", None, 403),
    ("dave", "get", "/decisions/eligibility/versions/3", None, 200),
    # edit
    ("dave", "post", "/decisions", {"key": "x", "name": "X"}, 403),
    ("carol", "post", "/decisions", {"key": "x", "name": "X"}, 201),
    ("svc-loan", "post", "/decisions", {"key": "x", "name": "X"}, 403),
    # publish
    ("carol", "post", "/decisions/eligibility/versions/5/activate", {}, 403),
    ("dave", "post", "/decisions/eligibility/versions/5/activate", {}, 403),
    ("bob", "post", "/decisions/eligibility/versions/5/activate", {}, 200),
    ("carol", "put", "/decisions/eligibility/aliases/beta", {"version": 3}, 403),
    ("carol", "post", "/decisions/eligibility/versions/2/disable", None, 403),
    ("carol", "post", "/decisions/eligibility/versions/2/deprecate", {}, 403),
    # admin
    ("bob", "get", "/audit", None, 403),
    ("bob", "get", "/grants", None, 403),
    ("alice", "get", "/grants", None, 200),
    ("alice", "get", "/audit", None, 200),
    ("bob", "post", "/v1/apps", {"key": "other", "name": "Other"}, 403),
    ("alice", "post", "/v1/apps", {"key": "other", "name": "Other"}, 201),
]


@pytest.mark.parametrize(("user", "method", "path", "body", "expected"), CASES)
def test_permission_matrix(as_user, user, method, path, body, expected):
    api = as_user(user)
    kwargs = {"json": body} if method in ("post", "put") else {}
    res = getattr(api, method)(path, **kwargs)
    assert res.status_code == expected, res.text
    if expected == 403:
        assert res.headers["content-type"].startswith("application/problem+json")


@pytest.mark.parametrize(
    ("user", "query", "expected"),
    [
        ("svc-loan", "", 200),
        ("dave", "", 403),  # view does not include evaluate
        ("carol", "", 200),  # editors may evaluate for testing
        ("svc-loan", "?draft=true", 403),  # drafts need edit
        ("dave", "?version=5", 403),
        ("carol", "?draft=true", 200),
        ("bob", "?version=5", 200),
    ],
)
def test_evaluate_permissions(as_user, user, query, expected):
    assert as_user(user).evaluate("eligibility", ADULT, query).status_code == expected


def test_missing_and_bad_tokens(as_user, client):
    anonymous = as_user(None)
    assert anonymous.get("/decisions").status_code == 401
    res = client.get("/v1/apps/loan-origination/decisions", headers={"Authorization": "Bearer nope"})
    assert res.status_code == 401
    assert client.post("/v1/dev/token", json={"username": "mallory"}).status_code == 404


def test_me_reports_effective_permissions(as_user):
    me = as_user("bob").get("/v1/me").json()
    assert me["subject"] == "bob" and me["roles"] == ["manager"]
    assert set(me["apps"]["loan-origination"]) == {"edit", "publish", "view"}
    alice = as_user("alice").get("/v1/me").json()
    assert set(alice["global_permissions"]) == {"view", "edit", "publish", "evaluate", "admin"}


def test_admin_manages_grants(alice, as_user):
    res = alice.post("/grants", json={"subject": "dave", "permission": "evaluate"})
    assert res.status_code == 201
    grant_id = res.json()["id"]
    assert as_user("dave").evaluate("eligibility", ADULT).status_code == 200
    assert alice.post("/grants", json={"subject": "dave", "permission": "evaluate"}).status_code == 409
    assert alice.delete(f"/grants/{grant_id}").status_code == 204
    assert as_user("dave").evaluate("eligibility", ADULT).status_code == 403
    actions = [e["action"] for e in alice.get("/audit").json()[:2]]
    assert actions == ["grant.deleted", "grant.created"]


def test_group_grants(alice, client):
    from app.auth.users import DEMO_USERS, DemoUser

    alice.post("/grants", json={"subject_type": "group", "subject": "risk-team", "permission": "view"})
    DEMO_USERS["erin"] = DemoUser("erin", "Erin", "test user", groups=("risk-team",))
    try:
        token = client.post("/v1/dev/token", json={"username": "erin"}).json()["access_token"]
        res = client.get("/v1/apps/loan-origination/decisions", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
    finally:
        DEMO_USERS.pop("erin")
