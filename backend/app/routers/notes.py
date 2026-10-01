from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.db import db

router = APIRouter(tags=["notes"])

notes = db["notes"]


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class Note(BaseModel):
    id: str
    text: str
    created_at: datetime


def _to_note(doc: dict) -> Note:
    return Note(id=str(doc["_id"]), text=doc["text"], created_at=doc["created_at"])


@router.get("/notes")
def list_notes() -> list[Note]:
    docs = notes.find().sort("created_at", -1).limit(100)
    return [_to_note(d) for d in docs]


@router.post("/notes", status_code=201)
def create_note(note: NoteIn) -> Note:
    doc = {"text": note.text, "created_at": datetime.now(UTC)}
    result = notes.insert_one(doc)
    return _to_note({"_id": result.inserted_id, **doc})
