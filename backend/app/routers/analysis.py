from typing import Literal

from fastapi import APIRouter, HTTPException

from app.analysis import digest as digest_mod
from app.analysis import service

router = APIRouter(tags=["analysis"])

Window = Literal["day", "week", "month", "year"]


@router.get("/analysis")
def get_analysis(window: Window = "day", refresh: bool = False) -> dict:
    try:
        return service.get_analysis(window, refresh=refresh)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e


@router.get("/analysis/digest")
def get_digest(window: Window = "day") -> dict:
    """Raw context packet — handy for debugging what the LLM sees."""
    return digest_mod.build(window)
