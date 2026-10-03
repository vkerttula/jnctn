#!/usr/bin/env python3
"""Generate mock API fixtures for the frontend from the VILPE dataset.

The demo home is a detached house at Yliopistonranta 1, Vaasa: four moisture
sensors in the roof (two per slope), a roof fan on the ridge, and the crawl
space package — a humidity sensor plus the fan that dries the crawl space.
Every device is backed by a real VILPE Sense series from data/.

Writes the contract-shaped JSON the mock API serves (see
docs/specs/2026-10-03-frontend-design.md):

    frontend/public/mock/house.json
    frontend/public/mock/sensors/<id>.json
    frontend/public/mock/series/<id>-<range>.json
    frontend/public/mock/report.json

Run from the repo root:  python scripts/gen_mock_data.py
"""

import csv
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "frontend" / "public" / "mock"

HELSINKI = ZoneInfo("Europe/Helsinki")
MAX_POINTS = 300
FIELDS = ("temp_c", "rh_pct", "fan_rpm", "mold_index")

# source: "rht:<sensor_id>" (zip-export RHT-2) or "fan:<device_id>" (MCU-2)
# fields: which readings this device exposes
DEVICES = [
    {"id": "roof-sw", "name": "South-west roof", "kind": "leak_sensor", "zone": "roof_south",
     "source": "rht:18927", "fields": ("temp_c", "rh_pct")},
    {"id": "roof-se", "name": "South-east roof", "kind": "leak_sensor", "zone": "roof_south",
     "source": "rht:18918", "fields": ("temp_c", "rh_pct")},
    {"id": "roof-nw", "name": "North-west roof", "kind": "leak_sensor", "zone": "roof_north",
     "source": "rht:18796", "fields": ("temp_c", "rh_pct")},
    {"id": "roof-ne", "name": "North-east roof", "kind": "leak_sensor", "zone": "roof_north",
     "source": "rht:18920", "fields": ("temp_c", "rh_pct")},
    {"id": "roof-fan", "name": "Roof fan", "kind": "fan", "zone": "ridge",
     "source": "fan:katto-1", "fields": ("temp_c", "rh_pct", "fan_rpm", "mold_index"),
     "state_label": "Running"},
    {"id": "crawl-space", "name": "Crawl space", "kind": "climate_sensor", "zone": "crawl_space",
     "source": "fan:katto-2", "fields": ("temp_c", "rh_pct", "mold_index"), "works_with": "crawl-fan"},
    {"id": "crawl-fan", "name": "Crawl space fan", "kind": "fan", "zone": "crawl_space",
     "source": "fan:hallin-alapohja", "fields": ("fan_rpm",), "works_with": "crawl-space",
     "state_label": "Drying"},
]

STATUS_TEXT = {
    "leak_sensor": "The roof structure here is dry — moisture is normal for the season.",
    "roof-fan": "The roof fan is running normally and keeping the roof structure dry.",
    "crawl-space": (
        "The crawl space is a little damp, which is normal for autumn. "
        "The crawl space fan is drying it."
    ),
    "crawl-fan": (
        "The fan is drying the crawl space. It speeds up on its own when "
        "the crawl space gets damper."
    ),
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
            points.append(
                {
                    "t": datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00")),
                    "temp_c": fnum(row["indoor_temp_c"]),
                    "rh_pct": fnum(row["indoor_rh_pct"]),
                    "fan_rpm": fnum(row["rpm"]),
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
                        "fan_rpm": None,
                        "mold_index": None,
                    }
                )
    return sorted(points, key=lambda p: p["t"])


def keep_fields(points: list[dict], fields: tuple[str, ...]) -> list[dict]:
    out = []
    for p in points:
        q = {"t": p["t"], **{f: (p[f] if f in fields else None) for f in FIELDS}}
        if any(q[f] is not None for f in fields):
            out.append(q)
    return out


def shift_to(points: list[dict], end: datetime) -> list[dict]:
    # The zip-export RHT history stops in Sept; slide it so the demo is "live".
    delta = end - points[-1]["t"]
    return [{**p, "t": p["t"] + delta} for p in points]


def latest_of(points: list[dict]) -> dict:
    # Fan CSVs are sparse (each value type has its own timestamps), so take
    # the last non-null value per field.
    return {
        f: next((p[f] for p in reversed(points) if p[f] is not None), None)
        for f in FIELDS
    }


WRITTEN: set[Path] = set()


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, separators=(",", ":")))
    WRITTEN.add(path)


def normal_band(points: list[dict]) -> dict | None:
    # "Normal for <month>": the device's own 20th–80th percentile humidity
    # over the last 30 days, widened a little. The real backend would derive
    # it from history + season + weather; this keeps the shape honest.
    end = points[-1]["t"]
    rh = sorted(p["rh_pct"] for p in points if p["rh_pct"] is not None and p["t"] >= end - timedelta(days=30))
    if len(rh) < 10:
        return None
    lo, hi = rh[len(rh) // 5], rh[len(rh) * 4 // 5]
    return {
        "label": f"Normal for {end.strftime('%B')}",
        "rh_pct": [max(0, round(lo - 3)), min(100, round(hi + 3))],
    }


def write_series(sensor_id: str, points: list[dict], end: datetime) -> None:
    normal = normal_band(points)
    last = points[-1]["t"]
    for label, days in [("24h", 1), ("7d", 7), ("30d", 30)]:
        window = [p for p in points if p["t"] >= last - timedelta(days=days)]
        write_json(
            OUT / "series" / f"{sensor_id}-{label}.json",
            {
                "id": sensor_id,
                "range": label,
                "normal": normal and {**normal, "label": f"Normal for {end.strftime('%B')}"},
                "points": [{**p, "t": iso(p["t"])} for p in downsample(window)],
            },
        )


def write_report() -> None:
    # Moisture History Report (concept, fictional history — mirrors the
    # "Moisture History Report mockup" PDF in docs/). Monthly peak mold index:
    # the roof peaks in winter, the crawl space in late summer, both far
    # below the growth threshold of 1.
    def seasonal(month: int, peak_month: int) -> float:
        return max(0.0, math.cos(2 * math.pi * (month - peak_month) / 12)) ** 2

    roof_year = {2021: 0.8, 2022: 0.85, 2023: 1.0, 2024: 0.75, 2025: 0.7, 2026: 0.65}
    crawl_year = {2021: 0.6, 2022: 0.75, 2023: 0.8, 2024: 1.0, 2025: 0.7, 2026: 0.65}
    months = []
    y, m = 2021, 11
    while (y, m) <= (2026, 9):
        roof = 0.04 + 0.36 * seasonal(m, 12) * roof_year[y]
        crawl = 0.03 + 0.27 * seasonal(m, 8) * crawl_year[y]
        months.append({"month": f"{y}-{m:02d}", "roof": round(roof, 2), "crawl_space": round(crawl, 2)})
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)

    def peak(key: str) -> dict:
        return max(months, key=lambda r: r[key])

    write_json(
        OUT / "report.json",
        {
            "id": "VS-2026-SAMPLE-0001",
            "issued": "2026-10-03",
            "period": {"from": "2021-11-01", "to": "2026-09-30"},
            "property": "Detached house, Vaasa",
            "address": "Yliopistonranta 1, Vaasa",
            "building": "2019 · timber frame, 1½ storeys",
            "sensors": "Roof · crawl space",
            "verified": "2021–2026",
            "headline": "Moisture within safe range for 5 years",
            "summary": (
                "Neither monitored structure reached conditions where mold can "
                "grow. Seasonal peaks — the roof in winter and the crawl space "
                "in late summer — stayed well below the risk threshold."
            ),
            "recommendations": [
                "No action needed — both monitored structures stayed dry "
                "through the whole period."
            ],
            "mold_threshold": 1,
            "months": months,
            "structures": [
                {
                    "name": "Roof · north slope",
                    "avg_rh_pct": 67,
                    "peak_mold_index": peak("roof")["roof"],
                    "peak_month": peak("roof")["month"],
                    "risk_periods": 0,
                    "coverage_pct": 99.1,
                    "status": "Dry",
                },
                {
                    "name": "Crawl space · base floor",
                    "avg_rh_pct": 71,
                    "peak_mold_index": peak("crawl_space")["crawl_space"],
                    "peak_month": peak("crawl_space")["month"],
                    "risk_periods": 0,
                    "coverage_pct": 98.9,
                    "status": "Dry",
                },
            ],
            "measurements": 512000,
            "interval": "every 10 min",
            "data_gaps": "1 · power cut, Jan 2023",
            "weather_context": "FMI · Vaasa",
            "last_sensor_check": "2026-09",
        },
    )


def main() -> None:
    # Overwrite in place and prune stale files afterwards — deleting the dirs
    # under a running Vite dev server makes it stop serving them.
    for sub in ("sensors", "series"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)

    devices = json.loads((DATA / "devices.json").read_text())
    updated = max(
        datetime.fromisoformat(d["latest"]["temperature_indoor"]["timestamp"].replace("Z", "+00:00"))
        for d in devices
        if d["latest"].get("temperature_indoor")
    )

    house_sensors = []
    for dev in DEVICES:
        src_kind, _, src_id = dev["source"].partition(":")
        raw = shift_to(rht_series(int(src_id)), updated) if src_kind == "rht" else fan_series(src_id)
        series = keep_fields(raw, dev["fields"])
        base = {
            "id": dev["id"],
            "name": dev["name"],
            "kind": dev["kind"],
            "zone": dev["zone"],
            "status": "ok",
            "works_with": dev.get("works_with"),
            "state_label": dev.get("state_label"),
            "latest": latest_of(series),
            "last_reading_at": iso(series[-1]["t"]),
        }
        house_sensors.append({**base, "primary": True})
        write_json(
            OUT / "sensors" / f"{dev['id']}.json",
            {
                **base,
                "status_text": STATUS_TEXT.get(dev["id"], STATUS_TEXT.get(dev["kind"], "")),
                "updated_at": iso(updated),
            },
        )
        write_series(dev["id"], series, updated)

    write_json(
        OUT / "house.json",
        {
            "home": {"address": "Yliopistonranta 1", "city": "Vaasa"},
            "score": 86,
            "score_word": "Good",
            "score_trend": "stable",
            "areas": [
                {"id": "roof", "name": "Roof", "status": "ok"},
                {"id": "crawl_space", "name": "Crawl space", "status": "ok"},
            ],
            "headline": "Your home is in good shape",
            "summary": (
                "The roof is drying normally for early October, and the crawl "
                "space fan is keeping the crawl space in check."
            ),
            "recommendations": [
                "Nothing needed right now. We'll keep watching."
            ],
            "narrative_source": "fallback",
            "weather": {
                "temp_c": 8.6,
                "condition": "Overcast",
                "humidity_pct": 87,
                "wind_ms": 4.2,
                "location": "Vaasa",
            },
            "attention": [],
            "sensors": house_sensors,
            "open_requests": [],
            "simulating": False,
            "updated_at": iso(updated),
        },
    )

    write_report()

    for sub in ("sensors", "series"):
        for stale in set((OUT / sub).glob("*.json")) - WRITTEN:
            stale.unlink()
    print(f"wrote {len(house_sensors)} devices, updated_at={iso(updated)}")


if __name__ == "__main__":
    main()
