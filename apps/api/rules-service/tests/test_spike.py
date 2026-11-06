from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"status": "ok", "service": "rules-service"}


def test_spike_evaluates_jdm_with_zen():
    adult = client.post("/spike/evaluate", json={"applicant": {"age": 30}}).json()
    minor = client.post("/spike/evaluate", json={"applicant": {"age": 12}}).json()
    assert adult["result"] == {"eligible": True}
    assert minor["result"] == {"eligible": False}
