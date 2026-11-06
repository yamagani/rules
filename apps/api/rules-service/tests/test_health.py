def test_health(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/health/db").json()["status"] == "ok"


def test_openapi_is_exported(client):
    spec = client.get("/openapi.json").json()
    assert "/v1/apps/{app}/decisions/{key}/evaluate" in spec["paths"]


def test_spike_endpoint(client):
    assert client.post("/spike/evaluate", json={"applicant": {"age": 12}}).json()["result"] == {"eligible": False}
