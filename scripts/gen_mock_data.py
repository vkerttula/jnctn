#!/usr/bin/env python3
"""Generate mock API fixtures for the frontend from the VILPE dataset.

The demo home is a detached house: four moisture sensors in the roof (two per
slope), a roof fan on the ridge, one crawl-space sensor and a separate
ventilation unit. Real VILPE Sense series from data/ back each device; the
ventilation unit has no source data and is synthesized deterministically.

Writes the contract-shaped JSON the mock API serves (see
docs/specs/2026-10-03-frontend-design.md):

    frontend/public/mock/house.json
    frontend/public/mock/sensors/<id>.json
    frontend/public/mock/series/<id>-<range>.json

Run from the repo root:  python scripts/gen_mock_data.py
"""

import csv
import json
import math
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "frontend" / "public" / "mock"

HELSINKI = ZoneInfo("Europe/Helsinki")
MAX_POINTS = 300

# id, name, kind, zone, source ("rht:<sensor_id>" | "fan:<device_id>" | "synthetic")
DEVICES = [
    ("roof-sw", "South-west roof", "leak_sensor", "roof_south", "rht:18927"),
    ("roof-se", "South-east roof", "leak_sensor", "roof_south", "rht:18918"),
    ("roof-nw", "North-west roof", "leak_sensor", "roof_north", "rht:18796"),
    ("roof-ne", "North-east roof", "leak_sensor", "roof_north", "rht:18920"),
    ("roof-fan", "Roof fan", "fan", "ridge", "fan:katto-1"),
    ("crawl-space", "Crawl space", "climate_sensor", "crawl_space", "fan:katto-2"),
    ("ventilation", "Ventilation unit", "ventilation_unit", "indoor", "synthetic"),
]

STATUS_TEXT = {
    "leak_sensor": "The roof structure here is dry — moisture is normal for the season.",
    "fan": "The roof fan is running normally and keeping the roof structure dry.",
    "climate_sensor": "The crawl space is a little damp, which is normal for autumn. The ventilation is keeping it in check.",
    "ventilation_unit": "Indoor air is fresh and humidity is comfortable.",
}


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def fnum(v: str) -> float | None:
    v = v.strip()
    return float(v) if v else None


def downsample(points: list[dict], cap: int = MAX_POINTS) -> list[dict]:
    if len(points) <= cap:
        return points
    step = len(points) / cap
    return [points[int(i * step)] for i in range(cap)]


def fan_series(device_id: str) -> list[dict]:
    points = []
    with open(DATA / "readings" / "fans" / f"{device_id}.csv") as f:
        for row in csv.DictReader(f):
            temp, rh = fnum(row["indoor_temp_c"]), fnum(row["indoor_rh_pct"])
            if temp is None and rh is None:
                continue
            points.append(
                {
                    "t": datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00")),
                    "temp_c": temp,
                    "rh_pct": rh,
                    "mold_index": fnum(row["mold_index"]),
                }
            )
    return sorted(points, key=lambda p: p["t"])


def rht_series(sensor_id: int) -> list[dict]:
    points = []
    with open(DATA / "readings" / "sensors.csv") as f:
        for row in csv.DictReader(f):
            if int(row["sensor_id"]) == sensor_id:
                points.append(
                    {
                        "t": datetime.fromisoformat(row["timestamp"]).replace(tzinfo=HELSINKI),
                        "temp_c": fnum(row["temperature_c"]),
                        "rh_pct": fnum(row["relative_humidity_pct"]),
                        "mold_index": None,
                    }
                )
    return sorted(points, key=lambda p: p["t"])


def ventilation_series(end: datetime) -> list[dict]:
    # Hourly, 30 days: indoor air ~21 °C, RH 35–42 % with a daily rhythm.
    points = []
    for h in range(30 * 24, -1, -1):
        t = end - timedelta(hours=h)
        day = math.sin(2 * math.pi * (t.hour - 7) / 24)
        drift = math.sin(2 * math.pi * h / (24 * 9))
        points.append(
            {
                "t": t,
                "temp_c": round(21.0 + 0.6 * day + 0.3 * drift, 2),
                "rh_pct": round(38.5 + 2.5 * day + 1.5 * drift, 2),
                "mold_index": None,
            }
        )
    return points


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, separators=(",", ":")))


def write_series(sensor_id: str, points: list[dict]) -> None:
    end = points[-1]["t"]
    for label, days in [("24h", 1), ("7d", 7), ("30d", 30)]:
        window = [p for p in points if p["t"] >= end - timedelta(days=days)]
        write_json(
            OUT / "series" / f"{sensor_id}-{label}.json",
            {
                "id": sensor_id,
                "range": label,
                "points": [{**p, "t": iso(p["t"])} for p in downsample(window)],
            },
        )


def main() -> None:
    # The mock dir is fully generated — rebuild it from scratch.
    for sub in ("sensors", "series"):
        shutil.rmtree(OUT / sub, ignore_errors=True)
        (OUT / sub).mkdir(parents=True)

    devices = {d["id"]: d for d in json.loads((DATA / "devices.json").read_text())}
    rhts = {s["sensor_id"]: s for s in json.loads((DATA / "sensors.json").read_text())}
    updated = max(
        datetime.fromisoformat(d["latest"]["temperature_indoor"]["timestamp"].replace("Z", "+00:00"))
        for d in devices.values()
        if d["latest"].get("temperature_indoor")
    )

    house_sensors = []
    for sid, name, kind, zone, source in DEVICES:
        src_kind, _, src_id = source.partition(":")
        if src_kind == "rht":
            lat = rhts[int(src_id)]["latest"]
            latest = {
                "temp_c": lat["temperature"]["value"],
                "rh_pct": lat["relative_humidity"]["value"],
                "mold_index": None,
                "fan_rpm": None,
            }
            series = rht_series(int(src_id))
        elif src_kind == "fan":
            lat = devices[src_id]["latest"]
            val = lambda k: (lat.get(k) or {}).get("value")  # noqa: E731
            latest = {
                "temp_c": val("temperature_indoor"),
                "rh_pct": val("relative_humidity_indoor"),
                "mold_index": val("mold_index"),
                "fan_rpm": val("fan_rpm") if kind == "fan" else None,
            }
            series = fan_series(src_id)
        else:
            latest = {"temp_c": 21.2, "rh_pct": 39.0, "mold_index": None, "fan_rpm": 1450}
            series = ventilation_series(updated)

        base = {"id": sid, "name": name, "kind": kind, "zone": zone, "status": "ok"}
        house_sensors.append({**base, "primary": True, "latest": latest})
        write_json(
            OUT / "sensors" / f"{sid}.json",
            {
                **base,
                "status_text": STATUS_TEXT[kind],
                "latest": latest,
                "updated_at": iso(updated),
            },
        )
        write_series(sid, series)

    write_json(
        OUT / "house.json",
        {
            "score": 86,
            "score_word": "Good",
            "score_trend": "stable",
            "summary": (
                "Your house is in good shape. The roof is drying normally for "
                "early October and indoor air is comfortable."
            ),
            "weather": {"temp_c": 8.6, "condition": "overcast", "location": "Vaasa"},
            "attention": [],
            "sensors": house_sensors,
            "simulating": False,
            "updated_at": iso(updated),
        },
    )
    print(f"wrote {len(house_sensors)} devices, updated_at={iso(updated)}")


if __name__ == "__main__":
    main()
