from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_api_open_when_demo_key_unset(monkeypatch):
    monkeypatch.setattr("app.main.DEMO_KEY", None)
    assert client.get("/api/notes").status_code == 200


def test_api_blocked_without_key(monkeypatch):
    monkeypatch.setattr("app.main.DEMO_KEY", "sekret")
    assert client.get("/api/notes").status_code == 401


def test_api_passes_with_key(monkeypatch):
    monkeypatch.setattr("app.main.DEMO_KEY", "sekret")
    headers = {"X-Demo-Key": "sekret"}
    assert client.get("/api/notes", headers=headers).status_code == 200


def test_health_stays_open(monkeypatch):
    monkeypatch.setattr("app.main.DEMO_KEY", "sekret")
    # Render's healthcheck can't carry the key.
    assert client.get("/api/health").status_code == 200
