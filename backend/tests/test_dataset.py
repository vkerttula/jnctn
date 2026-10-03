import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers.dataset import DATA_DIR

pytestmark = pytest.mark.skipif(
    not DATA_DIR.is_dir(), reason="sample dataset not checked out"
)

client = TestClient(app)


def test_dataset_summary():
    r = client.get("/api/dataset")
    assert r.status_code == 200
    data = r.json()
    assert data["site"]["id"] == "vilpe-vantaa"
    assert len(data["devices"]) > 0
    assert len(data["sensors"]) > 0


def test_fan_readings():
    r = client.get("/api/dataset/fans/katto-1/readings")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) > 0
    assert "timestamp" in rows[0]
    assert "rpm" in rows[0]


def test_fan_readings_downsamples():
    r = client.get("/api/dataset/fans/katto-1/readings?max_points=100")
    assert r.status_code == 200
    assert len(r.json()) <= 100


def test_fan_readings_unknown_404():
    assert client.get("/api/dataset/fans/nope/readings").status_code == 404
    assert client.get("/api/dataset/fans/..%2F..%2Fsite/readings").status_code == 404


def test_sensor_readings():
    summary = client.get("/api/dataset").json()
    sensor_id = summary["sensors"][0]["sensor_id"]
    r = client.get(f"/api/dataset/sensors/{sensor_id}/readings")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) > 0
    assert all(row["sensor_id"] == sensor_id for row in rows)


def test_sensor_readings_unknown_404():
    assert client.get("/api/dataset/sensors/999999999/readings").status_code == 404
