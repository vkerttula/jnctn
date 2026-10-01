from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_db_ping():
    r = client.get("/api/db-ping")
    assert r.status_code in (200, 503)
    assert "status" in r.json()
