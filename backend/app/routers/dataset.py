import csv
import json
import math
import os
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(tags=["dataset"])

# The VILPE Sense sample dataset lives at the repo root (see data/README.md).
# Dev tooling only: the deploy image doesn't ship it, so these endpoints 404
# there. Override with DATA_DIR.
DATA_DIR = Path(
    os.getenv("DATA_DIR", str(Path(__file__).resolve().parents[3] / "data"))
)

_ID_RE = re.compile(r"^[a-z0-9-]+$")


def _load_json(name: str) -> Any:
    path = DATA_DIR / name
    if not path.is_file():
        raise HTTPException(404, f"data/{name} not found — dataset not available")
    return json.loads(path.read_text())


def _coerce(value: str | None) -> Any:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return value


def _read_csv(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise HTTPException(404, f"{path.name} not found — dataset not available")
    with path.open(newline="") as f:
        return [{k: _coerce(v) for k, v in row.items()} for row in csv.DictReader(f)]


def _thin(rows: list[dict[str, Any]], max_points: int) -> list[dict[str, Any]]:
    stride = math.ceil(len(rows) / max_points)
    return rows[::stride]


@router.get("/dataset")
def dataset_summary() -> dict[str, Any]:
    return {
        "site": _load_json("site.json"),
        "devices": _load_json("devices.json"),
        "sensors": _load_json("sensors.json"),
    }


@router.get("/dataset/fans/{fan_id}/readings")
def fan_readings(
    fan_id: str, max_points: int = Query(default=2000, ge=1, le=50000)
) -> list[dict[str, Any]]:
    if not _ID_RE.fullmatch(fan_id):
        raise HTTPException(404, "unknown fan")
    rows = _read_csv(DATA_DIR / "readings" / "fans" / f"{fan_id}.csv")
    return _thin(rows, max_points)


@router.get("/dataset/sensors/{sensor_id}/readings")
def sensor_readings(
    sensor_id: int, max_points: int = Query(default=2000, ge=1, le=50000)
) -> list[dict[str, Any]]:
    path = DATA_DIR / "readings" / "sensors.csv"
    rows = [row for row in _read_csv(path) if row.get("sensor_id") == sensor_id]
    if not rows:
        raise HTTPException(404, "no readings for sensor")
    return _thin(rows, max_points)
