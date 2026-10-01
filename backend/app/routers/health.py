from fastapi import APIRouter, HTTPException
from pymongo.errors import PyMongoError

from app.db import db

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/db-ping")
def db_ping() -> dict[str, object]:
    try:
        db.command("ping")
    except PyMongoError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "status": "ok",
        "db": db.name,
        "mongo": db.client.server_info()["version"],
        "collections": sorted(db.list_collection_names()),
    }
