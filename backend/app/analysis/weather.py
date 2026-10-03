"""Outdoor weather context for the demo home (Vaasa).

Primary source is Open-Meteo (keyless); results are cached in Mongo for 30
min. On any failure we degrade to the fans' own outdoor transmitters, then to
the last cached document.
"""

import json
import urllib.request
from datetime import UTC, datetime, timedelta
from typing import Any

from app.db import db

VAASA = {"lat": 63.096, "lon": 21.615, "location": "Vaasa"}
CACHE_TTL = timedelta(minutes=30)

# WMO weather code -> display condition (spec: capitalized, e.g. "Overcast")
_CONDITIONS = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Foggy", 48: "Foggy", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
    61: "Rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain",
    67: "Freezing rain", 71: "Snow", 73: "Snow", 75: "Snow", 77: "Snow",
    80: "Showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers",
    86: "Snow showers", 95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
}


def current() -> dict[str, Any]:
    cached = db.weather.find_one({"_id": "vaasa"})
    if (
        cached
        and "rain_chance_pct" in cached["weather"]
        and datetime.now(UTC) - cached["fetched_at"].replace(tzinfo=UTC) < CACHE_TTL
    ):
        return cached["weather"]

    fresh = _fetch()
    if fresh:
        db.weather.replace_one(
            {"_id": "vaasa"},
            {"fetched_at": datetime.now(UTC).replace(tzinfo=None), "weather": fresh},
            upsert=True,
        )
        return fresh
    if cached:
        return cached["weather"]
    return _from_sensors()


def _fetch() -> dict[str, Any] | None:
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={VAASA['lat']}&longitude={VAASA['lon']}"
        "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code"
        "&daily=precipitation_probability_max&forecast_days=1&timezone=auto"
        "&wind_speed_unit=ms"
    )
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            data = json.load(r)
        cur = data["current"]
        return {
            "temp_c": cur["temperature_2m"],
            "condition": _CONDITIONS.get(cur["weather_code"], "Overcast"),
            "humidity_pct": cur["relative_humidity_2m"],
            "wind_ms": cur["wind_speed_10m"],
            # today's max precipitation probability, % (null if unset)
            "rain_chance_pct": (data.get("daily") or {}).get(
                "precipitation_probability_max", [None]
            )[0],
            "location": VAASA["location"],
        }
    except Exception:
        return None


def _from_sensors() -> dict[str, Any]:
    """Last-resort weather from the fans' outdoor transmitters."""
    rows = list(
        db.sense_fan_readings.aggregate(
            [
                {"$match": {"outdoor.rh_pct": {"$ne": None}}},
                {"$sort": {"ts": -1}},
                {
                    "$group": {
                        "_id": "$device_id",
                        "t": {"$first": "$outdoor.temp_c"},
                        "r": {"$first": "$outdoor.rh_pct"},
                    }
                },
            ]
        )
    )
    temps = [r["t"] for r in rows if r["t"] is not None]
    rhs = [r["r"] for r in rows if r["r"] is not None]
    rh = sum(rhs) / len(rhs) if rhs else None
    return {
        "temp_c": round(sum(temps) / len(temps), 1) if temps else None,
        "condition": "Overcast" if rh and rh >= 80 else "Partly cloudy",
        "humidity_pct": round(rh) if rh else None,
        "wind_ms": 0.0,
        "rain_chance_pct": None,
        "location": VAASA["location"],
    }
