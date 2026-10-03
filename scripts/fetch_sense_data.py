"""Fetch the VILPE Sense demo-site dataset directly from the public API
behind https://sense.vilpe.com/public/* share links.

No auth needed — the links are public. Endpoints used:

    GET {API}/roofs/public/{site_link}                  site + devices + sensors
    GET {API}/roofs/public/{site_link}?valueSetId={id}  sensor values at a snapshot
    GET {API}/roofs/public/{site_link}/presigned-layout-url  layout image URL
    GET {API}/public-measurements/{device_link}/{start}/{end}  full device history
        (start/end are ignored by the API — it always returns everything)

Usage from the repo root (stdlib only):

    python scripts/fetch_sense_data.py [data] [--sensor-history]

--sensor-history additionally downloads every humidity-map value set
(~730 requests) into readings/sensor-snapshots.csv at 12 h granularity.
"""

import csv
import json
import math
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

API = "https://tdqn5whm3k.execute-api.eu-west-1.amazonaws.com/prod"
SITE_LINK = "QGeCB7NEn9"

# serial_number -> public link id, from VILPE Vantaan varasto.docx
DEVICE_LINKS = {
    "N112741ZDLY": "fxyTiqZfob",  # Katto 1
    "N112562K4C8": "xtxxftb2fY",  # Katto 2
    "N11251233JN": "no2IoVSy8L",  # Katto 3
    "N1104957TCM": "LdQ0OlL85z",  # Katto 4
    "N1109203B9X": "vaWUGFNH2j",  # Viherkatto 1
    "N112560ZEBX": "zHzaMMgmZw",  # Viherkatto 2
    "N112711X79B": "inIthx1Tk4",  # Hallin alapohja
}

LOCATION_BY_PURPOSE = {
    "roof": "roof",
    "green_roof": "green_roof",
    "crawl_space": "crawl_space",
    "base_floor": "crawl_space",
}

FAN_CSV_HEADER = [
    "timestamp",
    "rpm",
    "mold_index",
    "indoor_temp_c",
    "indoor_rh_pct",
    "indoor_abs_humidity_g_m3",
    "outdoor_temp_c",
    "outdoor_rh_pct",
    "outdoor_abs_humidity_g_m3",
]
SERIES_TO_COLUMN = {
    ("fan_rpm", None): "rpm",
    ("mold_index", None): "mold_index",
    ("temperature", True): "indoor_temp_c",
    ("relative_humidity", True): "indoor_rh_pct",
    ("temperature", False): "outdoor_temp_c",
    ("relative_humidity", False): "outdoor_rh_pct",
}


def get(path: str) -> dict:
    req = urllib.request.Request(f"{API}{path}", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def get_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def slugify(name: str) -> str:
    import re

    slug = name.lower().replace("vilpe vantaa,", "").strip()
    return re.sub(r"[^a-z0-9]+", "-", slug).strip("-")


def abs_humidity(temp_c: float, rh_pct: float) -> float:
    """Absolute humidity in g/m³ from °C and %RH (Magnus formula)."""
    es = 6.112 * math.exp(17.67 * temp_c / (temp_c + 243.5))
    return round(2.1674 * es * rh_pct / (273.15 + temp_c), 2)


def fetch_device_series(link_id: str) -> dict:
    return get(f"/public-measurements/{link_id}/1970-01-01T00:00:00Z/2999-01-01T00:00:00Z")


def series_rows(meas: dict) -> list[list]:
    """Merge all valueTypes into one union-of-timestamps table."""
    points: dict[str, dict] = {}
    for vt in meas["valueTypes"]:
        col = SERIES_TO_COLUMN.get((vt["identifier"], vt.get("isIndoor")))
        if not col:
            continue
        for v in vt["values"]:
            points.setdefault(v["timestamp"], {})[col] = v["value"]
    rows = []
    for ts in sorted(points):
        p = points[ts]
        for side in ("indoor", "outdoor"):
            t, rh = p.get(f"{side}_temp_c"), p.get(f"{side}_rh_pct")
            if t is not None and rh is not None:
                p[f"{side}_abs_humidity_g_m3"] = abs_humidity(t, rh)
        rows.append([ts.replace(".000Z", "Z"), *[p.get(c) for c in FAN_CSV_HEADER[1:]]])
    return rows


def main() -> None:
    outdir = Path(sys.argv[1] if len(sys.argv) > 1 else "data")
    want_history = "--sensor-history" in sys.argv
    (outdir / "readings" / "fans").mkdir(parents=True, exist_ok=True)

    # Non-API fields preserved from the zip-derived dataset, if present.
    prev_devices = {}
    prev_path = outdir / "devices.json"
    if prev_path.exists():
        prev_devices = {d["serial_number"]: d for d in json.loads(prev_path.read_text())}
    prev_site = {}
    site_path = outdir / "site.json"
    if site_path.exists():
        prev_site = json.loads(site_path.read_text())

    print(f"site: {API}/roofs/public/{SITE_LINK}")
    site = get(f"/roofs/public/{SITE_LINK}")

    # --- layout image ---
    layout_url = get(f"/roofs/public/{SITE_LINK}/presigned-layout-url")["downloadUrl"]
    (outdir / "site-layout.png").write_bytes(get_bytes(layout_url))
    print("layout: site-layout.png")

    # --- fans: dedupe site devices by serial, fetch each public link ---
    fans = {}
    for d in site["devices"]:
        fans.setdefault(d["serialNumber"], d)

    devices = []
    for serial, d in sorted(fans.items(), key=lambda kv: kv[1]["name"]):
        link = DEVICE_LINKS.get(serial)
        prev = prev_devices.get(serial, {})
        device = {
            "id": prev.get("id") or slugify(d["name"]),
            "name": d["name"],
            "serial_number": serial,
            "type": d["type"],
            "device_id": d["id"],
            "category": prev.get("category", "ventilation_fan"),
            "location": prev.get("location"),
            "purpose": prev.get("purpose"),
            "building_material": prev.get("building_material"),
            "owner": prev.get("owner"),
            "status": "online" if d["isOnline"] else "offline",
            "is_alert": d["isAlert"],
            "coordinates": d["coordinatesInRoofLayout"],
            "public_link": f"https://sense.vilpe.com/public/{link}" if link else None,
        }
        if not link:
            print(f"  {d['name']}: no public link, skipped measurements")
            devices.append(device)
            continue

        meas = fetch_device_series(link)
        rows = series_rows(meas)
        csv_path = outdir / "readings" / "fans" / f"{device['id']}.csv"
        with open(csv_path, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(FAN_CSV_HEADER)
            w.writerows(rows)

        device["location"] = device["location"] or LOCATION_BY_PURPOSE.get(
            meas.get("purpose"), "roof"
        )
        device["transmitters"] = [
            {
                "serial_number": t["serialNumber"],
                "type": t["type"],
                "role": "indoor" if t["isIndoorMaster"] else "outdoor",
            }
            for t in meas.get("transmitters", [])
        ]
        device["latest"] = {}
        for m in d.get("latestMeasurements", []):
            k = m["identifier"]
            if m.get("isIndoor") is not None:
                k += "_indoor" if m["isIndoor"] else "_outdoor"
            device["latest"][k] = {"value": m["value"], "timestamp": m["timestamp"]}
        device["readings_file"] = f"readings/fans/{device['id']}.csv"
        device["readings_count"] = len(rows)
        devices.append(device)
        print(f"  {device['id']}: {len(rows)} rows, purpose={meas.get('purpose')}")

    # --- sensors (VILPE RHT-2 smart fasteners) ---
    sensors = [
        {
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
                m["identifier"]: {"value": m["value"], "timestamp_ms": m["timestamp"]}
                for m in f.get("latestMeasurements", [])
            },
        }
        for f in site["smartFasteners"]
    ]

    # --- site ---
    site_json = {
        "id": "vilpe-vantaa",
        "api_site_id": site["id"],
        "name": site["name"],
        "description_fi": prev_site.get("description_fi"),
        "public_site_link": f"https://sense.vilpe.com/public/site/{SITE_LINK}",
        "api_base": API,
        "timezone": "Europe/Helsinki",
        "layout_file": "site-layout.png",
        "layout_calibration_factor": site["layoutCalibrationFactor"],
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
        "value_sets": {
            "count": len(site["valueSets"]),
            "latest": site["valueSets"][-1]["timestamp"] if site["valueSets"] else None,
            "note": "12 h humidity-map snapshots; fetch with --sensor-history",
        },
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    (outdir / "site.json").write_text(
        json.dumps(site_json, indent=2, ensure_ascii=False) + "\n"
    )
    (outdir / "devices.json").write_text(
        json.dumps(devices, indent=2, ensure_ascii=False) + "\n"
    )
    (outdir / "sensors.json").write_text(
        json.dumps(sensors, indent=2, ensure_ascii=False) + "\n"
    )

    # --- optional: sensor history via value sets ---
    if want_history:
        out = outdir / "readings" / "sensor-snapshots.csv"
        ids = [v["id"] for v in site["valueSets"]]

        def fetch_vs(vsid):
            s = get(f"/roofs/public/{SITE_LINK}?valueSetId={vsid}")
            rows = []
            for f in s["smartFasteners"]:
                m = {x["identifier"]: x for x in f.get("measurementsInValueSet") or []}
                t, rh = m.get("temperature"), m.get("relative_humidity")
                if t or rh:
                    rows.append(
                        [
                            f["id"],
                            f["serialNumber"],
                            t["timestamp"] if t else None,
                            t["value"] if t else None,
                            rh["value"] if rh else None,
                        ]
                    )
            return rows

        print(f"sensor history: {len(ids)} value sets")
        with open(out, "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(
                ["sensor_id", "sensor_serial", "timestamp_ms", "temperature_c", "rh_pct"]
            )
            with ThreadPoolExecutor(max_workers=8) as ex:
                for i, rows in enumerate(ex.map(fetch_vs, ids)):
                    w.writerows(rows)
                    if i % 100 == 0:
                        print(f"  {i}/{len(ids)}")

    print(f"done: {len(devices)} devices, {len(sensors)} sensors")


if __name__ == "__main__":
    main()
