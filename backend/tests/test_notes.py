from bson import ObjectId
from fastapi.testclient import TestClient

from app.db import db
from app.main import app

client = TestClient(app)


def test_create_and_list_notes():
    r = client.post("/api/notes", json={"text": "test note"})
    assert r.status_code == 201
    created = r.json()
    assert created["text"] == "test note"
    assert created["id"]

    r = client.get("/api/notes")
    assert r.status_code == 200
    assert any(n["id"] == created["id"] for n in r.json())

    db.notes.delete_one({"_id": ObjectId(created["id"])})


def test_create_note_validates_empty():
    r = client.post("/api/notes", json={"text": ""})
    assert r.status_code == 422
