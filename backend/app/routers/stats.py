import time
from datetime import UTC, datetime

from fastapi import APIRouter
from pydantic import BaseModel, Field
from pymongo.errors import PyMongoError

from app.db import db

router = APIRouter(tags=["stats"])

page_views = db["page_views"]

STARTED_AT = time.monotonic()


class PageViewIn(BaseModel):
    path: str = Field(default="/", max_length=200)


class PageView(BaseModel):
    id: str
    path: str
    created_at: datetime


class Stats(BaseModel):
    page_views: int
    notes: int
    mongo: str
    uptime_seconds: int


@router.post("/stats/track", status_code=201)
def track_page_view(view: PageViewIn) -> PageView:
    doc = {"path": view.path, "created_at": datetime.now(UTC)}
    result = page_views.insert_one(doc)
    return PageView(id=str(result.inserted_id), **doc)


@router.get("/stats")
def get_stats() -> Stats:
    mongo = "ok"
    try:
        views = page_views.count_documents({})
        notes_count = db["notes"].count_documents({})
    except PyMongoError:
        mongo = "error"
        views = notes_count = 0
    return Stats(
        page_views=views,
        notes=notes_count,
        mongo=mongo,
        uptime_seconds=int(time.monotonic() - STARTED_AT),
    )
