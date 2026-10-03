#!/usr/bin/env python3
"""Generate mock API fixtures for the frontend from the VILPE dataset.

Reads data/*.json + data/readings/*.csv and writes the contract-shaped JSON
the mock API serves (see docs/specs/2026-10-03-frontend-design.md):

    frontend/public/mock/house.json
    frontend/public/mock/sensors/<id>.json
    frontend/public/mock/series/<id>-<range>.json

Run from the repo root:  python scripts/gen_mock_data.py
"""

import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "frontend" / "public" / "mock"

HELSINKI = ZoneInfo("Europe/Helsinki")
MAX_POINTS = 300

# Fan id -> zone on the demo house
FAN_ZONES = {
    "katto-1": "flat_roof",
    "katto-2": "flat_roof",
    "katto-3": "flat_roof",
    "katto-4": "flat_roof",
    "viherkatto-1": "green_roof",
    "viherkatto-2": "green_roof",
    "hallin-alapohja": "crawl_space",
}

# Hand-picked spread of leak sensors (sensor_id -> zone), chosen by x/y on the
# roof layout: green roof = right side where the viherkatto fans sit, ridge =
# high edge, wall = south face, rest flat roof.
LEAK_SENSORS = {
    18927: "flat_roof",
    18918: "flat_roof",
    18904: "wall",
    18928: "ridge",
    19305: "flat_roof",
    19221: "flat_roof",
    18849: "ridge",
    18796: "green_roof",
    18920: "green_roof",
}

STATUS_TEXT = {
    "fan": (
        "Ventilation is keeping this structure dry — humidity sits in the "
        "normal range for October."
    ),
    "leak_sensor": (
        "Moisture here is stable and within the normal range for the season."
    ),
}


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_utc(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def parse_helsinki(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=HELSINKI)


def downsample(points: list[dict], cap: int = MAX_POINTS) -> list[dict]:
    if len(points) <= cap:
        return points
    step = len(points) / cap
    return [points[int(i * step)] for i in range(cap)]


def fnum(v: str) -> float | None:
    v = v.strip()
    return float(v) if v else None


def fan_series(device_id: str) -> list[dict]:
    path = DATA / "readings" / "fans" / f"{device_id}.csv"
    points = []
    with open(path) as f:
        for row in csv.DictReader(f):
            points.append(
                {
                    "t": parse_utc(row["timestamp"]),
                    "temp_c": fnum(row["indoor_temp_c"]),
                    "rh_pct": fnum(row["indoor_rh_pct"]),
                    "mold_index": fnum(row["mold_index"]),
                }
            )
    points.sort(key=lambda p: p["t"])
    return [p for p in points if p["temp_c"] is not None or p["rh_pct"] is not None]


def leak_sensor_series(sensor_id: int) -> list[dict]:
    points = []
    with open(DATA / "readings" / "sensors.csv") as f:
        for row in csv.DictReader(f):
            if int(row["sensor_id"]) == sensor_id:
                points.append(
                    {
                        "t": parse_helsinki(row["timestamp"]),
                        "temp_c": fnum(row["temperature_c"]),
                        "rh_pct": fnum(row["relative_humidity_pct"]),
                        "mold_index": None,
                    }
                )
    points.sort(key=lambda p: p["t"])
    return points


def write_series(sensor_id: str, points: list[dict]) -> None:
    if not points:
        return
    end = points[-1]["t"]
    for label, span in [("24h", 1), ("7d", 7), ("30d", 30)]:
        start = end - timedelta(days=span)
        window = [p for p in points if p["t"] >= start]
        sampled = [
            {
                "t": iso(p["t"]),
                "temp_c": p["temp_c"],
                "rh_pct": p["rh_pct"],
                "mold_index": p["mold_index"],
            }
            for p in downsample(window)
        ]
        payload = {"id": sensor_id, "range": label, "points": sampled}
        (OUT / "series" / f"{sensor_id}-{label}.json").write_text(
            json.dumps(payload, separators=(",", ":"))
        )


def main() -> None:
    (OUT / "sensors").mkdir(parents=True, exist_ok=True)
    (OUT / "series").mkdir(parents=True, exist_ok=True)

    devices = {d["id"]: d for d in json.loads((DATA / "devices.json").read_text())}
    sensors_meta = {
        s["sensor_id"]: s for s in json.loads((DATA / "sensors.json").read_text())
    }

    house_sensors = []
    latest_ts: datetime | None = None

    def note_ts(dt: datetime) -> None:
        nonlocal latest_ts
        if latest_ts is None or dt > latest_ts:
            latest_ts = dt

    # --- fans ---
    zone_names = {
        "flat_roof": "Flat roof",
        "green_roof": "Green roof",
        "ridge": "Roof ridge",
        "crawl_space": "Crawl space",
        "wall": "South wall",
    }
    counts: dict[str, int] = {}
    for device_id, zone in FAN_ZONES.items():
        dev = devices[device_id]
        counts[zone] = counts.get(zone, 0) + 1
        nice = dev["name"].replace("VILPE Vantaa, ", "")
        name = f"{zone_names[zone]} fan {counts[zone]} · {nice}"
        lat = dev.get("latest", {})

        def lv(key: str) -> float | None:
            v = lat.get(key)
            return v["value"] if isinstance(v, dict) else None

        if lat.get("temperature_indoor", {}).get("timestamp"):
            note_ts(parse_utc(lat["temperature_indoor"]["timestamp"]))

        house_sensors.append(
            {
                "id": device_id,
                "name": name,
                "kind": "fan",
                "zone": zone,
                "status": "ok",
                "primary": True,
            }
        )
        detail = {
            "id": device_id,
            "name": name,
            "kind": "fan",
            "zone": zone,
            "status": "ok",
            "status_text": STATUS_TEXT["fan"],
            "latest": {
                "temp_c": lv("temperature_indoor"),
                "rh_pct": lv("relative_humidity_indoor"),
                "mold_index": lv("mold_index"),
                "fan_rpm": lv("fan_rpm"),
            },
            "updated_at": "",
        }
        (OUT / "sensors" / f"{device_id}.json").write_text(
            json.dumps(detail, separators=(",", ":"))
        )
        write_series(device_id, fan_series(device_id))

    # --- leak sensors ---
    counts.clear()
    for sensor_id, zone in LEAK_SENSORS.items():
        meta = sensors_meta[sensor_id]
        counts[zone] = counts.get(zone, 0) + 1
        name = f"{zone_names[zone]} sensor {counts[zone]} · {meta['serial_number']}"
        lat = meta.get("latest", {})
        ms = lat.get("temperature", {}).get("timestamp_ms")
        if ms:
            note_ts(datetime.fromtimestamp(ms / 1000, tz=timezone.utc))

        sensor_key = f"rht-{sensor_id}"
        house_sensors.append(
            {
                "id": sensor_key,
                "name": name,
                "kind": "leak_sensor",
                "zone": zone,
                "status": "ok",
                "primary": True,
            }
        )
        detail = {
            "id": sensor_key,
            "name": name,
            "kind": "leak_sensor",
            "zone": zone,
            "status": "ok",
            "status_text": STATUS_TEXT["leak_sensor"],
            "latest": {
                "temp_c": lat.get("temperature", {}).get("value"),
                "rh_pct": lat.get("relative_humidity", {}).get("value"),
                "mold_index": None,
                "fan_rpm": None,
            },
            "updated_at": "",
        }
        (OUT / "sensors" / f"{sensor_key}.json").write_text(
            json.dumps(detail, separators=(",", ":"))
        )
        write_series(sensor_key, leak_sensor_series(sensor_id))

    # --- house snapshot ---
    updated = iso(latest_ts) if latest_ts else iso(datetime.now(timezone.utc))
    house = {
        "score": 84,
        "score_word": "Good",
        "score_trend": "stable",
        "summary": (
            "Your roof structures are drying normally for early October. "
            "The green roof is the dampest area but trending down."
        ),
        "weather": {"temp_c": 8.6, "condition": "overcast", "location": "Vaasa"},
        "attention": [],
        "sensors": house_sensors,
        "simulating": False,
        "updated_at": updated,
    }
    (OUT / "house.json").write_text(json.dumps(house, separators=(",", ":")))

    # stamp updated_at into details
    for p in (OUT / "sensors").glob("*.json"):
        d = json.loads(p.read_text())
        d["updated_at"] = updated
        p.write_text(json.dumps(d, separators=(",", ":")))

    print(f"wrote {len(house_sensors)} sensors, updated_at={updated}")


if __name__ == "__main__":
    main()
