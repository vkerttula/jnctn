"""The frontend contract (frontend/src/api/types.ts, docs/specs/…design.md):

    GET  /api/house                          -> HouseState
    GET  /api/sensors/{id}                   -> SensorDetail
    GET  /api/sensors/{id}/series?range=     -> SensorSeries
    POST /api/simulate/leak                  -> start demo leak simulation
    POST /api/simulate/reset                 -> stop it

Sensor ids: fan slugs ("katto-1", "hallin-alapohja", …) and "rht-<sensor_id>"
for roof sensors. Zone/name conventions mirror scripts/gen_mock_data.py.
"""

from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.analysis import digest as digest_mod
from app.analysis import fallback, service, simulate
from app.db import db

router = APIRouter(tags=["house"])

FAN_ZONES = {
    "katto-1": "flat_roof",
    "katto-2": "flat_roof",
    "katto-3": "flat_roof",
    "katto-4": "flat_roof",
    "viherkatto-1": "green_roof",
    "viherkatto-2": "green_roof",
    "hallin-alapohja": "crawl_space",
}

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

ZONE_NAMES = {
    "flat_roof": "Flat roof",
    "green_roof": "Green roof",
    "ridge": "Roof ridge",
    "crawl_space": "Crawl space",
    "wall": "South wall",
}

STATUS_TEXT = {
    "ok": {
        "fan": "Ventilation is keeping this structure dry — humidity is in the normal range.",
        "leak_sensor": "Moisture here is stable and within the normal range for the season.",
    },
    "watch": "Humidity has been a bit higher than usual here recently.",
    "alert": "Humidity has been unusually high here — this area needs attention.",
    "simulated": "Humidity is climbing quickly — looks like a leak.",
}

SCORE_WORDS = {"all_good": "Good", "watch": "Fair", "attention": "Attention"}
SEVERITY_MAP = {"attention": "alert", "watch": "watch", "info": "ok"}
MAX_POINTS = 300


class LeakRequest(BaseModel):
    sensor_id: str | None = None


def _catalog() -> list[dict[str, Any]]:
    """Canonical sensor list: 7 fans + the hand-picked leak sensors."""
    counts: dict[str, int] = {}
    out = []
    devices = {d.get("slug"): d for d in db.sense_devices.find()}
    for slug, zone in FAN_ZONES.items():
        dev = devices.get(slug)
        counts[zone] = counts.get(zone, 0) + 1
        nice = (dev or {}).get("name", slug).replace("VILPE Vantaa, ", "")
        out.append(
            {
                "id": slug,
                "name": f"{ZONE_NAMES[zone]} fan {counts[zone]} · {nice}",
                "kind": "fan",
                "zone": zone,
                "device_id": (dev or {}).get("device_id"),
            }
        )
    counts.clear()
    meta = {s["sensor_id"]: s for s in db.sense_sensors.find()}
    for sensor_id, zone in LEAK_SENSORS.items():
        m = meta.get(sensor_id, {})
        counts[zone] = counts.get(zone, 0) + 1
        out.append(
            {
                "id": f"rht-{sensor_id}",
                "name": f"{ZONE_NAMES[zone]} sensor {counts[zone]} · "
                f"{m.get('serial_number', sensor_id)}",
                "kind": "leak_sensor",
                "zone": zone,
                "sensor_id": sensor_id,
                "serial": m.get("serial_number"),
            }
        )
    return out


def _status_map(findings: list[dict]) -> dict[str, str]:
    """ref (device slug or sensor serial) -> worst frontend status."""
    rank = {"alert": 2, "watch": 1, "ok": 0}
    out: dict[str, str] = {}
    for f in findings:
        ref = f.get("ref")
        if not ref:
            continue
        status = SEVERITY_MAP.get(f["severity"], "ok")
        if rank[status] > rank.get(out.get(ref, "ok"), 0):
            out[ref] = status
    return out


def _weather(digest: dict[str, Any]) -> dict[str, Any]:
    temps, rhs = [], []
    for d in digest["devices"]:
        t = (d["latest"].get("outdoor_temp") or {}).get("value")
        r = (d["latest"].get("outdoor") or {}).get("value")
        if t is not None:
            temps.append(t)
        if r is not None:
            rhs.append(r)
    temp = round(sum(temps) / len(temps), 1) if temps else None
    rh = sum(rhs) / len(rhs) if rhs else None
    condition = (
        "misty" if rh and rh >= 95
        else "overcast" if rh and rh >= 80
        else "partly cloudy" if rh and rh >= 60
        else "clear"
    )
    return {"temp_c": temp, "condition": condition, "location": "Vantaa"}


def _serial_to_rht() -> dict[str, str]:
    return {s["serial_number"]: f"rht-{s['sensor_id']}" for s in db.sense_sensors.find()}


@router.get("/house")
def house_state() -> dict[str, Any]:
    analysis = service.get_analysis("day")
    digest = digest_mod.build("day")
    findings = analysis["findings"]
    status = _status_map(findings)
    serial_to_rht = _serial_to_rht()
    sim = simulate.active()

    sensors = []
    for s in _catalog():
        ref = s["id"] if s["kind"] == "fan" else s.get("serial")
        st = status.get(ref, "ok")
        if sim and s["id"] == sim["sensor_id"]:
            st = "alert"
        sensors.append(
            {k: s[k] for k in ("id", "name", "kind", "zone")} | {"status": st, "primary": True}
        )

    attention = []
    for f in findings:
        if f["severity"] not in ("watch", "attention"):
            continue
        ref = f.get("ref")
        sensor_id = ref if ref in FAN_ZONES else serial_to_rht.get(ref)
        item = fallback.describe_finding(f)
        attention.append(
            {
                "sensor_id": sensor_id or ref,
                "severity": SEVERITY_MAP[f["severity"]],
                "message": f"{item.title} — {item.detail}",
                "since": f.get("since") or analysis["generated_at"],
            }
        )

    return {
        "score": analysis["score"],
        "score_word": SCORE_WORDS[analysis["tone"]],
        "score_trend": analysis["score_trend"],
        "summary": analysis["summary"],
        "weather": _weather(digest),
        "attention": attention,
        "sensors": sensors,
        "simulating": bool(sim),
        "updated_at": analysis["generated_at"] + "Z",
    }


def _catalog_entry(sensor_id: str) -> dict[str, Any]:
    for s in _catalog():
        if s["id"] == sensor_id:
            return s
    raise HTTPException(404, f"unknown sensor {sensor_id!r}")


def _sim_latest(sim: dict | None, sensor_id: str, base_rh: float | None = None) -> float | None:
    """Simulated RH for the leak target: climbs above baseline, saturating ~97."""
    if not sim or sim.get("sensor_id") != sensor_id:
        return None
    started = sim["started_at"].replace(tzinfo=UTC)
    hours = (datetime.now(UTC) - started).total_seconds() / 3600
    base = base_rh if base_rh is not None else 70.0
    return round(min(97.0, base + 10 + hours * 10), 1)


@router.get("/sensors/{sensor_id}")
def sensor_detail(sensor_id: str) -> dict[str, Any]:
    entry = _catalog_entry(sensor_id)
    analysis = service.get_analysis("day")
    status = _status_map(analysis["findings"])
    sim = simulate.active()

    ref = entry["id"] if entry["kind"] == "fan" else entry.get("serial")
    st = "alert" if sim and sim.get("sensor_id") == sensor_id else status.get(ref, "ok")

    if entry["kind"] == "fan":
        dev = db.sense_devices.find_one({"slug": entry["id"]}) or {}
        latest = {
            "temp_c": _lat(dev["device_id"], "indoor.temp_c"),
            "rh_pct": _lat(dev["device_id"], "indoor.rh_pct"),
            "mold_index": _lat(dev["device_id"], "mold_index"),
            "fan_rpm": _lat(dev["device_id"], "rpm"),
        }
    else:
        doc = db.sense_sensor_readings.find_one(
            {"sensor_id": entry["sensor_id"]}, sort=[("ts", -1)]
        ) or {}
        latest = {
            "temp_c": doc.get("temp_c"),
            "rh_pct": doc.get("rh_pct"),
            "mold_index": None,
            "fan_rpm": None,
        }

    sim_rh = _sim_latest(sim, sensor_id, latest.get("rh_pct"))
    if sim_rh is not None:
        latest["rh_pct"] = sim_rh

    return {
        "id": entry["id"],
        "name": entry["name"],
        "kind": entry["kind"],
        "zone": entry["zone"],
        "status": st,
        "status_text": (
            STATUS_TEXT["simulated"]
            if sim and sim.get("sensor_id") == sensor_id
            else STATUS_TEXT["ok"][entry["kind"]]
            if st == "ok"
            else STATUS_TEXT[st]
        ),
        "latest": latest,
        "updated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }


def _lat(device_id: int, dotted: str) -> float | None:
    doc = db.sense_fan_readings.find_one(
        {"device_id": device_id, dotted: {"$ne": None}},
        {dotted: 1},
        sort=[("ts", -1)],
    )
    if not doc:
        return None
    node = doc
    for part in dotted.split("."):
        node = node[part]
    return node


@router.get("/sensors/{sensor_id}/series")
def sensor_series(
    sensor_id: str, range: Literal["24h", "7d", "30d"] = "7d"
) -> dict[str, Any]:
    entry = _catalog_entry(sensor_id)
    days = {"24h": 1, "7d": 7, "30d": 30}[range]

    if entry["kind"] == "fan":
        coll, filt = db.sense_fan_readings, {"device_id": entry["device_id"]}
        proj = {"ts": 1, "indoor": 1, "mold_index": 1}
    else:
        coll, filt = db.sense_sensor_readings, {"sensor_id": entry["sensor_id"]}
        proj = {"ts": 1, "temp_c": 1, "rh_pct": 1}

    end = (coll.find_one(filt, {"ts": 1}, sort=[("ts", -1)]) or {}).get("ts")
    if end is None:
        return {"id": sensor_id, "range": range, "points": []}
    start = end - timedelta(days=days)

    docs = list(coll.find({**filt, "ts": {"$gte": start}}, proj).sort("ts", 1))
    stride = max(1, len(docs) // MAX_POINTS)
    docs = docs[::stride]

    points = [
        {
            "t": d["ts"].replace(tzinfo=UTC).isoformat().replace("+00:00", "Z"),
            "temp_c": (d.get("indoor") or {}).get("temp_c") or d.get("temp_c"),
            "rh_pct": (d.get("indoor") or {}).get("rh_pct") or d.get("rh_pct"),
            "mold_index": d.get("mold_index"),
        }
        for d in docs
    ]

    sim = simulate.active()
    if sim and sim.get("sensor_id") == sensor_id and points:
        n = min(12, len(points))
        base = (
            points[-n - 1]["rh_pct"] if len(points) > n else points[0]["rh_pct"]
        ) or 70.0
        target = _sim_latest(sim, sensor_id, base) or 97.0
        for i, p in enumerate(points[-n:], 1):
            p["rh_pct"] = round(base + (target - base) * i / n, 1)

    return {"id": sensor_id, "range": range, "points": points}


@router.post("/simulate/leak")
def simulate_leak(req: LeakRequest) -> dict[str, Any]:
    sensor_id = req.sensor_id or "katto-1"
    entry = _catalog_entry(sensor_id)
    sim = simulate.start(
        sensor_id=sensor_id,
        device=entry["id"] if entry["kind"] == "fan" else None,
        label=digest_mod.DEVICE_LABELS.get(entry["id"], entry["name"].split(" · ")[0].lower()),
    )
    return {"simulating": True, "sensor_id": sim["sensor_id"]}


@router.post("/simulate/reset")
def simulate_reset() -> dict[str, Any]:
    simulate.stop()
    return {"simulating": False}
