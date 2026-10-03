"""Ingest the VILPE Sense demo-site dataset into MongoDB.

Pulls the public Sense API (same endpoints as scripts/fetch_sense_data.py —
kept self-contained so the backend can refresh without the scripts dir) and
upserts into these collections:

    sense_site            single document: site metadata, gateway, layout info
    sense_devices         7 MCU-2 fans, keyed by serial_number
    sense_sensors         51 RHT-2 sensors, keyed by serial_number
    sense_fan_readings    per-fan merged readings, unique on (device, ts)
    sense_sensor_readings hourly sensor rows from data/readings/sensors.csv,
                          unique on (sensor, ts) — naive Helsinki -> UTC

Run from backend/:

    uv run python -m app.ingest            # full ingest
    uv run python -m app.ingest --no-csv   # API only, skip sensors.csv
"""

import argparse
import csv
import json
import math
import time
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pymongo import ASCENDING, UpdateOne

from app.db import db

API = "https://tdqn5whm3k.execute-api.eu-west-1.amazonaws.com/prod"
SITE_LINK = "QGeCB7NEn9"
DEVICE_LINKS = {
    "N112741ZDLY": "fxyTiqZfob",  # Katto 1
    "N112562K4C8": "xtxxftb2fY",  # Katto 2
    "N11251233JN": "no2IoVSy8L",  # Katto 3
    "N1104957TCM": "LdQ0OlL85z",  # Katto 4
    "N1109203B9X": "vaWUGFNH2j",  # Viherkatto 1
    "N112560ZEBX": "zHzaMMgmZw",  # Viherkatto 2
    "N112711X79B": "inIthx1Tk4",  # Hallin alapohja
}
HELSINKI = ZoneInfo("Europe/Helsinki")
DATA_DIR = Path(__file__).resolve().parents[2] / "data"

# (identifier, isIndoor) -> (subdoc, field); subdoc None = top level
SERIES_TO_FIELD = {
    ("fan_rpm", None): (None, "rpm"),
    ("mold_index", None): (None, "mold_index"),
    ("temperature", True): ("indoor", "temp_c"),
    ("relative_humidity", True): ("indoor", "rh_pct"),
    ("temperature", False): ("outdoor", "temp_c"),
    ("relative_humidity", False): ("outdoor", "rh_pct"),
}


def api_get(path: str) -> dict:
    req = urllib.request.Request(f"{API}{path}", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def abs_humidity(temp_c: float, rh_pct: float) -> float:
    es = 6.112 * math.exp(17.67 * temp_c / (temp_c + 243.5))
    return round(2.1674 * es * rh_pct / (273.15 + temp_c), 2)


def bulk_upsert(coll, ops: list[UpdateOne], label: str) -> None:
    for i in range(0, len(ops), 1000):
        coll.bulk_write(ops[i : i + 1000], ordered=False)
    print(f"  {label}: {len(ops)} docs upserted")


def ingest_site(site: dict) -> None:
    doc = {
        "_id": "vilpe-vantaa",
        "api_site_id": site["id"],
        "name": site["name"],
        "public_site_link": f"https://sense.vilpe.com/public/site/{SITE_LINK}",
        "layout_url": site.get("layoutUrl"),
        "layout_calibration_factor": site.get("layoutCalibrationFactor"),
        "humidity_map_sensitivity": site.get("humidityMapSensitivity"),
        "gateways": [
            {
                "id": g["id"],
                "serial_number": g["serialNumber"],
                "name": g["name"],
                "type": g["type"],
                "coordinates": g["coordinatesInRoofLayout"],
            }
            for g in site["gateways"]
        ],
        "value_set_count": len(site["valueSets"]),
        "fetched_at": datetime.now(UTC),
    }
    db.sense_site.replace_one({"_id": doc["_id"]}, doc, upsert=True)
    print(f"site: {doc['name']} ({len(doc['gateways'])} gateways)")


def ingest_sensors(site: dict) -> None:
    ops = []
    for f in site["smartFasteners"]:
        doc = {
            "sensor_id": f["id"],
            "serial_number": f["serialNumber"],
            "type": f["type"],
            "name": f["name"],
            "is_online": f["isOnline"],
            "is_alert": f["isAlert"],
            "humidity_deviation_alert": f["isHumidityDeviationAlert"],
            "coordinates": f["coordinatesInRoofLayout"],
            "gateway_id": f["gatewayId"],
            "latest": {
                m["identifier"]: {
                    "value": m["value"],
                    "ts": datetime.fromtimestamp(m["timestamp"] / 1000, UTC),
                }
                for m in f.get("latestMeasurements", [])
            },
        }
        ops.append(
            UpdateOne({"serial_number": f["serialNumber"]}, {"$set": doc}, upsert=True)
        )
    bulk_upsert(db.sense_sensors, ops, "sensors")


def ingest_devices(site: dict) -> dict[str, dict]:
    """Upsert devices; return {serial: {id, slug}} for the readings step."""
    fans = {}
    for d in site["devices"]:
        fans.setdefault(d["serialNumber"], d)

    slugs = {}
    ops = []
    for serial, d in fans.items():
        slug = d["name"].lower().replace("vilpe vantaa,", "").strip()
        slug = "".join(c if c.isalnum() else "-" for c in slug).strip("-")
        slugs[serial] = {"id": d["id"], "slug": slug}
        link = DEVICE_LINKS.get(serial)
        doc = {
            "device_id": d["id"],
            "serial_number": serial,
            "name": d["name"],
            "slug": slug,
            "type": d["type"],
            "is_online": d["isOnline"],
            "is_alert": d["isAlert"],
            "coordinates": d["coordinatesInRoofLayout"],
            "gateway_id": d["gatewayId"],
            "public_link": f"https://sense.vilpe.com/public/{link}" if link else None,
            "latest": {
                latest_key(m): {"value": m["value"], "ts": parse_ts(m["timestamp"])}
                for m in d.get("latestMeasurements", [])
            },
        }
        ops.append(UpdateOne({"serial_number": serial}, {"$set": doc}, upsert=True))
    bulk_upsert(db.sense_devices, ops, "devices")
    return slugs


def latest_key(m: dict) -> str:
    if m.get("isIndoor") is None:
        return m["identifier"]
    return m["identifier"] + ("_indoor" if m["isIndoor"] else "_outdoor")


def merged_readings(meas: dict) -> dict[datetime, dict]:
    """Merge a device's valueTypes into {ts: {field: value, indoor: {...}}}."""
    points: dict[datetime, dict] = {}
    for vt in meas["valueTypes"]:
        target = SERIES_TO_FIELD.get((vt["identifier"], vt.get("isIndoor")))
        if not target:
            continue
        subdoc, field = target
        for v in vt["values"]:
            p = points.setdefault(parse_ts(v["timestamp"]), {})
            if subdoc:
                p.setdefault(subdoc, {})[field] = v["value"]
            else:
                p[field] = v["value"]
    for p in points.values():
        for side in ("indoor", "outdoor"):
            s = p.get(side)
            if s and s.get("temp_c") is not None and s.get("rh_pct") is not None:
                s["abs_humidity_g_m3"] = abs_humidity(s["temp_c"], s["rh_pct"])
    return points


def ingest_fan_readings(slugs: dict[str, dict]) -> None:
    coll = db.sense_fan_readings
    for serial, meta in slugs.items():
        link = DEVICE_LINKS.get(serial)
        if not link:
            continue
        meas = api_get(
            f"/public-measurements/{link}/1970-01-01T00:00:00Z/2999-01-01T00:00:00Z"
        )
        points = merged_readings(meas)
        ops = [
            UpdateOne(
                {"device_id": meta["id"], "ts": ts},
                {
                    "$set": {
                        "device_id": meta["id"],
                        "device": meta["slug"],
                        "serial_number": serial,
                        "ts": ts,
                        **p,
                    }
                },
                upsert=True,
            )
            for ts, p in points.items()
        ]
        bulk_upsert(coll, ops, f"{meta['slug']} readings")


def ingest_sensor_csv(path: Path) -> None:
    ops = []
    with open(path) as fh:
        for r in csv.DictReader(fh):
            ts = datetime.fromisoformat(r["timestamp"]).replace(tzinfo=HELSINKI)
            doc = {
                "sensor_id": int(r["sensor_id"]),
                "sensor_serial": r["sensor_serial"],
                "ts": ts,
                "temp_c": float(r["temperature_c"]) if r["temperature_c"] else None,
                "rh_pct": (
                    float(r["relative_humidity_pct"])
                    if r["relative_humidity_pct"]
                    else None
                ),
                "abs_humidity_g_m3": (
                    float(r["absolute_humidity_g_m3"])
                    if r["absolute_humidity_g_m3"]
                    else None
                ),
            }
            ops.append(
                UpdateOne(
                    {"sensor_id": doc["sensor_id"], "ts": ts}, {"$set": doc}, upsert=True
                )
            )
    bulk_upsert(db.sense_sensor_readings, ops, "sensor readings (csv)")


def ensure_indexes() -> None:
    db.sense_devices.create_index([("serial_number", ASCENDING)], unique=True)
    db.sense_sensors.create_index([("serial_number", ASCENDING)], unique=True)
    db.sense_fan_readings.create_index(
        [("device_id", ASCENDING), ("ts", ASCENDING)], unique=True
    )
    db.sense_sensor_readings.create_index(
        [("sensor_id", ASCENDING), ("ts", ASCENDING)], unique=True
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-csv", action="store_true", help="skip sensors.csv ingest")
    ap.add_argument("--csv", type=Path, default=DATA_DIR / "readings" / "sensors.csv")
    args = ap.parse_args()

    t0 = time.monotonic()
    site = api_get(f"/roofs/public/{SITE_LINK}")
    ingest_site(site)
    ingest_sensors(site)
    slugs = ingest_devices(site)
    ingest_fan_readings(slugs)
    if not args.no_csv and args.csv.exists():
        ingest_sensor_csv(args.csv)
    ensure_indexes()
    print(f"done in {time.monotonic() - t0:.1f}s")


if __name__ == "__main__":
    main()
