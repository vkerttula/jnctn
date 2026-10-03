"""Serve the VILPE Sense dataset from MongoDB.

Same response contract as the original file-backed version — the frontend
/data explorer doesn't care where the rows come from. Populated by
`uv run python -m app.ingest` (see backend/app/ingest.py).
"""

import math
import re
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.db import db

router = APIRouter(tags=["dataset"])

_ID_RE = re.compile(r"^[a-z0-9-]+$")
_NOT_INGESTED = "dataset not ingested — run `uv run python -m app.ingest`"


def _iso(ts: datetime) -> str:
    # pymongo returns naive UTC datetimes; mark them so JS parses UTC,
    # not browser-local time
    return ts.replace(tzinfo=UTC).isoformat()


def _latest(latest: dict | None) -> dict[str, Any]:
    return {
        k: {"value": v["value"], "timestamp": _iso(v["ts"])}
        for k, v in (latest or {}).items()
    }


def _thin(rows: list[dict[str, Any]], max_points: int) -> list[dict[str, Any]]:
    stride = math.ceil(len(rows) / max_points)
    return rows[::stride]


def _device_out(d: dict) -> dict[str, Any]:
    return {
        "id": d["slug"],
        "name": d["name"],
        "serial_number": d["serial_number"],
        "type": d["type"],
        "device_id": d["device_id"],
        "category": d.get("category"),
        "location": d.get("location"),
        "status": d.get("status"),
        "is_alert": d["is_alert"],
        "coordinates": d["coordinates"],
        "public_link": d["public_link"],
        "transmitters": d.get("transmitters", []),
        "latest": _latest(d.get("latest")),
    }


def _sensor_out(s: dict) -> dict[str, Any]:
    return {
        "sensor_id": s["sensor_id"],
        "serial_number": s["serial_number"],
        "type": s["type"],
        "name": s.get("name"),
        "is_online": s["is_online"],
        "is_alert": s["is_alert"],
        "humidity_deviation_alert": s.get("humidity_deviation_alert"),
        "coordinates": s["coordinates"],
        "gateway_id": s["gateway_id"],
        "latest": _latest(s.get("latest")),
    }


@router.get("/dataset")
def dataset_summary() -> dict[str, Any]:
    site = db.sense_site.find_one({"_id": "vilpe-vantaa"}, {"_id": 0})
    if site is None:
        raise HTTPException(404, _NOT_INGESTED)
    if site.get("fetched_at"):
        site["fetched_at"] = _iso(site["fetched_at"])
    return {
        "site": {"id": "vilpe-vantaa", **site},
        "devices": [_device_out(d) for d in db.sense_devices.find()],
        "sensors": [_sensor_out(s) for s in db.sense_sensors.find()],
    }


@router.get("/dataset/fans/{fan_id}/readings")
def fan_readings(
    fan_id: str, max_points: int = Query(default=2000, ge=1, le=50000)
) -> list[dict[str, Any]]:
    if not _ID_RE.fullmatch(fan_id):
        raise HTTPException(404, "unknown fan")
    device = db.sense_devices.find_one({"slug": fan_id}, {"device_id": 1})
    if device is None:
        raise HTTPException(404, "unknown fan")
    cursor = db.sense_fan_readings.find(
        {"device_id": device["device_id"]}, {"_id": 0}
    ).sort("ts", 1)
    rows = []
    for r in cursor:
        row: dict[str, Any] = {
            "timestamp": _iso(r["ts"]),
            "rpm": r.get("rpm"),
            "mold_index": r.get("mold_index"),
        }
        for side in ("indoor", "outdoor"):
            s = r.get(side) or {}
            row[f"{side}_temp_c"] = s.get("temp_c")
            row[f"{side}_rh_pct"] = s.get("rh_pct")
            row[f"{side}_abs_humidity_g_m3"] = s.get("abs_humidity_g_m3")
        rows.append(row)
    return _thin(rows, max_points)


@router.get("/dataset/sensors/{sensor_id}/readings")
def sensor_readings(
    sensor_id: int, max_points: int = Query(default=2000, ge=1, le=50000)
) -> list[dict[str, Any]]:
    cursor = db.sense_sensor_readings.find(
        {"sensor_id": sensor_id}, {"_id": 0}
    ).sort("ts", 1)
    rows = [
        {
            "timestamp": _iso(r["ts"]),
            "sensor_id": r["sensor_id"],
            "sensor_serial": r["sensor_serial"],
            "temperature_c": r.get("temp_c"),
            "relative_humidity_pct": r.get("rh_pct"),
            "absolute_humidity_g_m3": r.get("abs_humidity_g_m3"),
        }
        for r in cursor
    ]
    if not rows:
        raise HTTPException(404, "no readings for sensor")
    return _thin(rows, max_points)
