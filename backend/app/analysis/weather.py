"""Outdoor weather context.

`current()` is the sidebar pill for the demo home (Vaasa): Open-Meteo
(keyless), cached in Mongo for 30 min, degrading to the last cached document
and then the fans' own outdoor transmitters.

`history()` / `summarize()` feed the analysis: daily weather where the
sensors physically are (Vantaa), so rain and humidity line up with what the
readings saw. Results are Mongo-cached per date range; on failure the
analysis simply runs without weather.
"""

import json
import urllib.request
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.db import db

VAASA = {"lat": 63.096, "lon": 21.615, "location": "Vaasa"}
# The VILPE Sense demo site the readings come from.
SITE = {"lat": 60.294, "lon": 25.04, "location": "Vantaa"}
CACHE_TTL = timedelta(minutes=30)
HISTORY_TTL = timedelta(hours=3)

RAINY_DAY_MM = 1.0  # a day with at least this much precipitation is "rainy"
_DAILY = {
    "precipitation_sum": "precip_mm",
    "temperature_2m_mean": "temp_mean",
    "temperature_2m_min": "temp_min",
    "temperature_2m_max": "temp_max",
    "relative_humidity_2m_mean": "rh_mean",
    "wind_speed_10m_max": "wind_max_ms",
}

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


def history(start: date, end: date) -> list[dict[str, Any]] | None:
    """Daily weather at the sensor site for [start, end] (local dates)."""
    key = f"vantaa:{start.isoformat()}:{end.isoformat()}"
    cached = db.weather.find_one({"_id": key})
    if cached and datetime.now(UTC) - cached["fetched_at"].replace(tzinfo=UTC) < HISTORY_TTL:
        return cached["days"]
    days = _fetch_history(start, end)
    if days:
        db.weather.replace_one(
            {"_id": key},
            {"fetched_at": datetime.now(UTC).replace(tzinfo=None), "days": days},
            upsert=True,
        )
        return days
    return cached["days"] if cached else None


def _fetch_history(start: date, end: date) -> list[dict[str, Any]] | None:
    # The archive API reaches up to today (recent days are model analysis),
    # so one endpoint covers every analysis window.
    url = (
        "https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={SITE['lat']}&longitude={SITE['lon']}"
        f"&start_date={start.isoformat()}&end_date={end.isoformat()}"
        f"&daily={','.join(_DAILY)}&timezone=Europe%2FHelsinki&wind_speed_unit=ms"
    )
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            daily = json.load(r)["daily"]
        days = [
            {"date": d, **{out: daily[src][i] for src, out in _DAILY.items()}}
            for i, d in enumerate(daily["time"])
        ]
        return [d for d in days if d["precip_mm"] is not None] or None
    except Exception:
        return None


def summarize(days: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Compact stats + a wet/mixed/dry verdict over a run of daily rows."""
    if not days:
        return None

    def vals(k):
        return [d[k] for d in days if d.get(k) is not None]

    precip = vals("precip_mm")
    rainy = sum(1 for p in precip if p >= RAINY_DAY_MM)
    rh = vals("rh_mean")
    rh_mean = round(sum(rh) / len(rh)) if rh else None
    temps = vals("temp_mean")
    wettest = max(days, key=lambda d: d.get("precip_mm") or 0)
    return {
        "days": len(days),
        "condition": _condition(rainy / len(days), rh_mean),
        "precip_mm": round(sum(precip), 1),
        "rainy_days": rainy,
        "wettest_day": {"date": wettest["date"], "precip_mm": wettest["precip_mm"]}
        if (wettest.get("precip_mm") or 0) >= RAINY_DAY_MM
        else None,
        "temp_mean": round(sum(temps) / len(temps), 1) if temps else None,
        "temp_min": min(vals("temp_min"), default=None),
        "temp_max": max(vals("temp_max"), default=None),
        "rh_mean": rh_mean,
        "wind_max_ms": max(vals("wind_max_ms"), default=None),
    }


def _condition(rainy_share: float, rh_mean: float | None) -> str:
    """wet = rain on half the days or saturated air; dry = little rain, drier air."""
    if rainy_share >= 0.5 or (rh_mean is not None and rh_mean >= 90):
        return "wet"
    if rainy_share <= 0.2 and (rh_mean is None or rh_mean < 80):
        return "dry"
    return "mixed"
