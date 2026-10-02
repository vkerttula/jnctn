from bson import ObjectId
from fastapi.testclient import TestClient

from app.db import db
from app.main import app

client = TestClient(app)


def test_track_page_view_and_stats():
    r = client.post("/api/stats/track", json={"path": "/"})
    assert r.status_code == 201
    created = r.json()
    assert created["path"] == "/"
    assert created["id"]

    r = client.get("/api/stats")
    assert r.status_code == 200
    stats = r.json()
    assert stats["mongo"] == "ok"
    assert stats["page_views"] >= 1
    assert stats["uptime_seconds"] >= 0

    db.page_views.delete_one({"_id": ObjectId(created["id"])})


def test_track_page_view_default_path():
    r = client.post("/api/stats/track", json={})
    assert r.status_code == 201
    created = r.json()
    assert created["path"] == "/"

    db.page_views.delete_one({"_id": ObjectId(created["id"])})
