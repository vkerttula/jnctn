"""The frontend contract (frontend/src/api/types.ts, docs/specs/…design.md):

    GET  /api/house                          -> HouseState
    GET  /api/sensors/{id}                   -> SensorDetail
    GET  /api/sensors/{id}/series?range=     -> SensorSeries
    POST /api/help-requests                  -> {message}
    GET  /api/report                         -> Report
    POST /api/simulate/leak                  -> start demo leak simulation
    POST /api/simulate/reset                 -> stop it

The API exposes a *logical* sensor catalog — 7 devices of a detached house:
four roof moisture quadrants (aggregates of the 51-sensor grid), a roof fan
(the katto-*/viherkatto-* fans), and the crawl-space package
(hallin-alapohja split into a climate sensor + its drying fan).
"""

import statistics
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.analysis import digest as digest_mod
from app.analysis import fallback, sensor_summary, service, simulate, weather
from app.db import db

router = APIRouter(tags=["house"])

# Logical sensors in display order. Roof quadrants aggregate the sensor grid
# by layout coordinates; the crawl-space pair maps to hallin-alapohja.
CATALOG = [
    {"id": "roof-sw", "name": "South-west roof", "kind": "leak_sensor", "zone": "roof_south"},
    {"id": "roof-se", "name": "South-east roof", "kind": "leak_sensor", "zone": "roof_south"},
    {"id": "roof-nw", "name": "North-west roof", "kind": "leak_sensor", "zone": "roof_north"},
    {"id": "roof-ne", "name": "North-east roof", "kind": "leak_sensor", "zone": "roof_north"},
    {"id": "roof-fan", "name": "Roof fan", "kind": "fan", "zone": "ridge"},
    {
        "id": "crawl-space", "name": "Crawl space", "kind": "climate_sensor",
        "zone": "crawl_space", "works_with": "crawl-fan",
    },
    {
        "id": "crawl-fan", "name": "Crawl space fan", "kind": "fan",
        "zone": "crawl_space", "works_with": "crawl-space",
    },
]

ROOF_FAN_SLUGS = [
    "katto-1", "katto-2", "katto-3", "katto-4", "viherkatto-1", "viherkatto-2",
]
CRAWL_SLUG = "hallin-alapohja"
CLIMATE_FINDINGS = {"RH_SUSTAINED_HIGH", "MOLD_INDEX_ELEVATED", "AH_INVERSION", "GRID_HUMID"}
FAN_FINDINGS = {"FAN_STOPPED", "FAN_NO_DATA", "DEVICE_ALERT"}

STATUS_TEXT = {
    "ok": {
        "leak_sensor": "Moisture here is stable and within the normal range for the season.",
        "climate_sensor": (
            "The crawl space is a little damp, which is normal for autumn. "
            "The crawl space fan is drying it."
        ),
        "fan": "Ventilation is keeping this structure dry — humidity is in the normal range.",
    },
    "watch": "Humidity has been a bit higher than usual here recently.",
    "alert": "Humidity has been unusually high here — this area needs attention.",
    "sim_watch": "Humidity here is rising slowly. We're watching it — no action needed yet.",
    "sim_alert": (
        "Humidity has risen sharply here in the last hour — "
        "this pattern usually means a new leak."
    ),
}

SCORE_WORDS = {"all_good": "Good", "watch": "Fair", "attention": "Attention"}
SEVERITY_MAP = {"attention": "alert", "watch": "watch", "info": "ok"}
MAX_POINTS = 300

# Demo pacing — mirrors the mock client so the moment unfolds identically.
SIM_ALERT_AFTER_S = 45       # watch -> alert
SIM_SCORE_FLOOR = 52         # score glides here over SIM_SCORE_S
SIM_SCORE_S = 150
SIM_RH_TARGET = 92.0         # leak humidity target
SIM_RH_RAMP_S = 240
SIM_DEFAULT_TARGET = "roof-nw"  # north slope — where moisture collects

HOME = {"address": "Yliopistonranta 1", "city": "Vaasa"}

HELP_MESSAGES = {
    "inspection": "Inspection requested. A local VILPE-certified inspector "
    "will call you within one working day.",
    "expert": "Sent to a VILPE expert. You'll get their assessment of the "
    "readings within 24 hours.",
}
HELP_STATUS = {
    "inspection": "Inspector calls within 1 working day",
    "expert": "Reply within 24 hours",
}
FAN_LABELS = {"roof-fan": "Running", "crawl-fan": "Drying"}


class LeakRequest(BaseModel):
    sensor_id: str | None = None


class HelpRequest(BaseModel):
    kind: Literal["inspection", "expert"]
    sensor_id: str | None = None


# ---------------------------------------------------------------- helpers


def _iso(dt: datetime | None) -> str | None:
    return dt.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z") if dt else None


def _quadrant_members() -> dict[str, list[dict]]:
    """Split roof sensors into logical quadrant ids by layout coordinates."""
    out: dict[str, list[dict]] = {q: [] for q in ("roof-nw", "roof-ne", "roof-sw", "roof-se")}
    sensors = [s for s in db.sense_sensors.find() if s.get("coordinates")]
    if not sensors:
        return out
    mid_x = statistics.median(s["coordinates"]["x"] for s in sensors)
    mid_y = statistics.median(s["coordinates"]["y"] for s in sensors)
    for s in sensors:
        x, y = s["coordinates"]["x"], s["coordinates"]["y"]
        quad = ("roof-n" if y <= mid_y else "roof-s") + ("w" if x <= mid_x else "e")
        out[quad].append(s)
    return out


def _lat(device_id: int, dotted: str) -> tuple[float | None, datetime | None]:
    doc = db.sense_fan_readings.find_one(
        {"device_id": device_id, dotted: {"$ne": None}},
        {dotted: 1, "ts": 1},
        sort=[("ts", -1)],
    )
    if not doc:
        return None, None
    node = doc
    for part in dotted.split("."):
        node = node[part]
    return node, doc["ts"]


def _devices() -> dict[str, dict]:
    return {d.get("slug") or d["serial_number"]: d for d in db.sense_devices.find()}


def _latest_for(sensor_id: str, quads: dict[str, list[dict]]) -> dict[str, Any]:
    """latest{} + last_reading_at for a logical sensor id."""
    latest: dict[str, Any] = {
        "temp_c": None, "rh_pct": None, "mold_index": None, "fan_rpm": None
    }
    if sensor_id in quads:
        ids = [s["sensor_id"] for s in quads[sensor_id]]
        docs = list(
            db.sense_sensor_readings.find(
                {"sensor_id": {"$in": ids}},
                {"sensor_id": 1, "temp_c": 1, "rh_pct": 1, "ts": 1},
                sort=[("ts", -1)],
                limit=len(ids) * 4,
            )
        )
        seen: dict[int, dict] = {}
        for d in docs:  # newest first — first doc per sensor is its latest
            seen.setdefault(d["sensor_id"], d)
        temps = [d["temp_c"] for d in seen.values() if d["temp_c"] is not None]
        rhs = [d["rh_pct"] for d in seen.values() if d["rh_pct"] is not None]
        latest["temp_c"] = round(sum(temps) / len(temps), 1) if temps else None
        latest["rh_pct"] = round(sum(rhs) / len(rhs), 1) if rhs else None
        last_ts = max((d["ts"] for d in seen.values()), default=None)
    elif sensor_id == "roof-fan":
        devs = _devices()
        temps, rhs, rpms, molds, tss = [], [], [], [], []
        for slug in ROOF_FAN_SLUGS:
            dev = devs.get(slug)
            if not dev:
                continue
            for field, acc in (
                ("indoor.temp_c", temps),
                ("indoor.rh_pct", rhs),
                ("rpm", rpms),
                ("mold_index", molds),
            ):
                v, ts = _lat(dev["device_id"], field)
                if v is not None:
                    acc.append(v)
                    tss.append(ts)
        latest["temp_c"] = round(sum(temps) / len(temps), 1) if temps else None
        latest["rh_pct"] = round(sum(rhs) / len(rhs), 1) if rhs else None
        latest["fan_rpm"] = round(sum(rpms) / len(rpms)) if rpms else None
        latest["mold_index"] = round(max(molds), 4) if molds else None
        last_ts = max(tss) if tss else None
    elif sensor_id == "crawl-space":
        dev = _devices().get(CRAWL_SLUG)
        tss = []
        if dev:
            for field, key in (
                ("indoor.temp_c", "temp_c"),
                ("indoor.rh_pct", "rh_pct"),
                ("mold_index", "mold_index"),
            ):
                v, ts = _lat(dev["device_id"], field)
                latest[key] = round(v, 4) if v is not None else None
                if ts:
                    tss.append(ts)
        last_ts = max(tss) if tss else None
    elif sensor_id == "crawl-fan":
        dev = _devices().get(CRAWL_SLUG)
        rpm, last_ts = _lat(dev["device_id"], "rpm") if dev else (None, None)
        latest["fan_rpm"] = rpm
    else:
        last_ts = None
    return {"latest": latest, "last_reading_at": _iso(last_ts)}


def _state_label(entry: dict, latest: dict) -> str | None:
    """One-word operating state — fans only; None for passive sensors."""
    if entry["kind"] != "fan":
        return None
    if not latest.get("fan_rpm"):
        return "Stopped"
    return FAN_LABELS[entry["id"]]


def _finding_sensor_id(finding: dict, serial_quad: dict[str, str]) -> str | None:
    """Map a finding's ref (device slug / serial / logical id) to a catalog id."""
    ref = finding.get("ref")
    if not ref:
        return None
    if ref in {s["id"] for s in CATALOG}:
        return ref
    if ref == CRAWL_SLUG:
        return "crawl-fan" if finding["code"] in FAN_FINDINGS else "crawl-space"
    if ref in ROOF_FAN_SLUGS:
        return "roof-fan"
    return serial_quad.get(ref)


def _sim_severity(sim: dict) -> str:
    elapsed = (datetime.now(UTC) - sim["started_at"].replace(tzinfo=UTC)).total_seconds()
    return "alert" if elapsed >= SIM_ALERT_AFTER_S else "watch"


def _sim_rh(sim: dict, base_rh: float | None) -> float | None:
    if base_rh is None:
        return None
    elapsed = (datetime.now(UTC) - sim["started_at"].replace(tzinfo=UTC)).total_seconds()
    k = min(1.0, elapsed / SIM_RH_RAMP_S)
    return round(base_rh + (SIM_RH_TARGET - base_rh) * k, 1)


# ---------------------------------------------------------------- endpoints


@router.get("/house")
def house_state() -> dict[str, Any]:
    analysis = service.get_analysis("day")
    sim = simulate.active()

    quads = _quadrant_members()
    serial_quad = {
        s["serial_number"]: q for q, members in quads.items() for s in members
    }
    rank = {"alert": 2, "watch": 1, "ok": 0}
    status = {}
    for f in analysis["findings"]:
        sid = _finding_sensor_id(f, serial_quad)
        if not sid:
            continue
        mapped = SEVERITY_MAP.get(f["severity"], "ok")
        if rank.get(mapped, 0) > rank.get(status.get(sid, "ok"), 0):
            status[sid] = mapped

    sensors = []
    for entry in CATALOG:
        sim_hit = sim and sim.get("sensor_id") == entry["id"]
        st = _sim_severity(sim) if sim_hit else status.get(entry["id"], "ok")
        base = _latest_for(entry["id"], quads)
        if sim_hit:
            ramped = _sim_rh(sim, base["latest"]["rh_pct"])
            if ramped is not None:
                base["latest"]["rh_pct"] = ramped
            base["last_reading_at"] = _iso(datetime.now(UTC))
        sensors.append(
            {
                "id": entry["id"],
                "name": entry["name"],
                "kind": entry["kind"],
                "zone": entry["zone"],
                "status": st,
                "latest": base["latest"],
                "works_with": entry.get("works_with"),
                "state_label": _state_label(entry, base["latest"]),
                "last_reading_at": base["last_reading_at"],
                "primary": True,
            }
        )

    rank = {"alert": 2, "watch": 1, "ok": 0}
    by_id = {s["id"]: s["status"] for s in sensors}
    areas = [
        {
            "id": "roof",
            "name": "Roof",
            "status": max(
                (by_id[i] for i in ("roof-sw", "roof-se", "roof-nw", "roof-ne", "roof-fan")),
                key=lambda s: rank[s],
            ),
        },
        {
            "id": "crawl_space",
            "name": "Crawl space",
            "status": max(
                (by_id[i] for i in ("crawl-space", "crawl-fan")), key=lambda s: rank[s]
            ),
        },
    ]

    open_requests = [
        {
            "kind": r["kind"],
            "sensor_id": r.get("sensor_id"),
            "requested_at": _iso(r["created_at"]),
            "status_text": HELP_STATUS[r["kind"]],
        }
        for r in db.help_requests.find(sort=[("created_at", 1)])
    ]

    attention = []
    if sim:
        target = next(s for s in sensors if s["id"] == sim["sensor_id"])
        sev = _sim_severity(sim)
        where = target["name"].lower()
        attention.append(
            {
                "sensor_id": target["id"],
                "severity": sev,
                "message": (
                    f"Moisture in the {where} has risen sharply — this pattern "
                    "usually means a leak. We recommend having it checked."
                    if sev == "alert"
                    else f"Moisture in the {where} is rising slowly. "
                    "We're watching it — no action needed yet."
                ),
                "since": _iso(sim["started_at"].replace(tzinfo=UTC)),
                "actions": ["inspection", "expert"] if sev == "alert" else ["expert"],
            }
        )
    # Prefer the narrative's own wording for feed items, matched on the
    # location label findings carry. Each narrative item is consumed once so
    # two findings at the same location don't repeat the same text.
    narrative_items: dict[str, list[dict]] = {}
    for item in analysis["attention_items"]:
        loc = (item.get("location") or "").strip().lower()
        if loc:
            narrative_items.setdefault(loc, []).append(item)

    for f in analysis["findings"]:
        if f["severity"] not in ("watch", "attention"):
            continue
        if f["code"].endswith("_SIMULATED"):  # already covered above
            continue
        sid = _finding_sensor_id(f, serial_quad)
        if sid is None:
            continue
        items = narrative_items.get((f.get("location") or "").strip().lower())
        if items:
            n = items.pop(0)
            message = f"{n['title']} — {n['detail']}"
        else:
            item = fallback.describe_finding(f)
            message = f"{item.title} — {item.detail}"
        attention.append(
            {
                "sensor_id": sid,
                "severity": SEVERITY_MAP[f["severity"]],
                "message": message,
                "since": f.get("since") or analysis["generated_at"],
                "actions": ["inspection", "expert"]
                if f["severity"] == "attention"
                else ["expert"],
            }
        )
    # One item per sensor — the most severe one wins.
    attention.sort(key=lambda a: {"alert": 0, "watch": 1}[a["severity"]])
    seen_sids: set[str] = set()
    attention = [
        a for a in attention
        if a["sensor_id"] not in seen_sids and not seen_sids.add(a["sensor_id"])
    ][:5]

    score = analysis["score"]
    if sim:
        elapsed = (datetime.now(UTC) - sim["started_at"].replace(tzinfo=UTC)).total_seconds()
        score = max(
            SIM_SCORE_FLOOR,
            round(score - (score - SIM_SCORE_FLOOR) * min(1.0, elapsed / SIM_SCORE_S)),
        )
    score_word = "Good" if score >= 75 else "Fair" if score >= 60 else "Attention"

    headline = analysis["headline"]
    summary = analysis["summary"]
    if sim:
        sev = _sim_severity(sim)
        headline = (
            "Possible leak in the roof" if sev == "alert" else "One area needs watching"
        )
        summary = (
            "We found a likely leak in the roof. Everything else looks normal."
            if sev == "alert"
            else "One area of the roof needs watching — the rest of the house looks normal."
        )

    recommendations = analysis["recommendations"]
    if sim:
        recommendations = (
            ["Have the roof checked — fixing a leak early keeps repairs small."]
            if _sim_severity(sim) == "alert"
            else ["Keep an eye on the roof — we'll tell you if it keeps rising."]
        )

    return {
        "home": HOME,
        "score": score,
        "score_word": score_word,
        "score_trend": "declining" if sim else analysis["score_trend"],
        "areas": areas,
        "headline": headline,
        "summary": summary,
        "recommendations": recommendations,
        "narrative_source": "demo" if sim else analysis["source"],
        "weather": weather.current(),
        "attention": attention,
        "sensors": sensors,
        "open_requests": open_requests,
        "simulating": bool(sim),
        "updated_at": _iso(datetime.now(UTC)),
    }


def _entry(sensor_id: str) -> dict[str, Any]:
    for s in CATALOG:
        if s["id"] == sensor_id:
            return s
    raise HTTPException(404, f"unknown sensor {sensor_id!r}")


@router.get("/sensors/{sensor_id}")
def sensor_detail(sensor_id: str) -> dict[str, Any]:
    entry = _entry(sensor_id)
    analysis = service.get_analysis("day")
    quads = _quadrant_members()
    serial_quad = {
        s["serial_number"]: q for q, members in quads.items() for s in members
    }
    status = {}
    for f in analysis["findings"]:
        sid = _finding_sensor_id(f, serial_quad)
        if sid:
            status[sid] = SEVERITY_MAP.get(f["severity"], "ok")
    sim = simulate.active()
    sim_hit = sim and sim.get("sensor_id") == sensor_id
    st = _sim_severity(sim) if sim_hit else status.get(sensor_id, "ok")

    base = _latest_for(sensor_id, quads)
    if sim_hit:
        ramped = _sim_rh(sim, base["latest"]["rh_pct"])
        if ramped is not None:
            base["latest"]["rh_pct"] = ramped
        base["last_reading_at"] = _iso(datetime.now(UTC))

    if sim_hit:
        status_text = STATUS_TEXT["sim_" + _sim_severity(sim)]
    elif st == "ok":
        status_text = STATUS_TEXT["ok"][entry["kind"]]
    else:
        status_text = STATUS_TEXT[st]

    return {
        "id": entry["id"],
        "name": entry["name"],
        "kind": entry["kind"],
        "zone": entry["zone"],
        "status": st,
        "status_text": status_text,
        "latest": base["latest"],
        "works_with": entry.get("works_with"),
        "state_label": _state_label(entry, base["latest"]),
        "last_reading_at": base["last_reading_at"],
        "updated_at": _iso(datetime.now(UTC)),
    }


@router.get("/sensors/{sensor_id}/series")
def sensor_series(
    sensor_id: str, range: Literal["24h", "7d", "30d", "1y"] = "7d"
) -> dict[str, Any]:
    _entry(sensor_id)
    days = {"24h": 1, "7d": 7, "30d": 30, "1y": 365}[range]
    quads = _quadrant_members()

    if sensor_id in quads:
        ids = [s["sensor_id"] for s in quads[sensor_id]]
        match = {"sensor_id": {"$in": ids}}
        coll = db.sense_sensor_readings
        agg = {"temp_c": "$temp_c", "rh_pct": "$rh_pct"}
    elif sensor_id == "roof-fan":
        devs = _devices()
        ids = [devs[s]["device_id"] for s in ROOF_FAN_SLUGS if s in devs]
        match = {"device_id": {"$in": ids}}
        coll = db.sense_fan_readings
        agg = {
            "temp_c": "$indoor.temp_c",
            "rh_pct": "$indoor.rh_pct",
            "fan_rpm": "$rpm",
            "mold_index": "$mold_index",
        }
    elif sensor_id == "crawl-fan":
        dev = _devices().get(CRAWL_SLUG)
        match = {"device_id": dev["device_id"] if dev else -1}
        coll = db.sense_fan_readings
        agg = {"fan_rpm": "$rpm"}
    else:  # crawl-space
        dev = _devices().get(CRAWL_SLUG)
        match = {"device_id": dev["device_id"] if dev else -1}
        coll = db.sense_fan_readings
        agg = {
            "temp_c": "$indoor.temp_c",
            "rh_pct": "$indoor.rh_pct",
            "mold_index": "$mold_index",
        }

    end = (coll.find_one(match, {"ts": 1}, sort=[("ts", -1)]) or {}).get("ts")
    if end is None:
        return {
            "id": sensor_id,
            "range": range,
            "normal": None,
            "points": [],
            "summary": None,
            "summary_source": "no-data",
        }
    start = end - timedelta(days=days)

    # "Normal for <month>": the device's own 20th–80th percentile humidity
    # over the last 30 days, widened a little (same rule as the mock).
    normal = None
    if "rh_pct" in agg:
        rh_rows = [
            r["v"]
            for r in coll.aggregate(
                [
                    {"$match": {**match, "ts": {"$gte": end - timedelta(days=30)}}},
                    {
                        "$group": {
                            "_id": {
                                "$dateTrunc": {"date": "$ts", "unit": "hour"}
                            },
                            "v": {"$avg": agg["rh_pct"]},
                        }
                    },
                ]
            )
            if r["v"] is not None
        ]
        rh_rows.sort()
        if len(rh_rows) >= 10:
            lo, hi = rh_rows[len(rh_rows) // 5], rh_rows[len(rh_rows) * 4 // 5]
            normal = {
                "label": f"Normal for {end.strftime('%B')}",
                "rh_pct": [max(0, round(lo - 3)), min(100, round(hi + 3))],
            }

    # Bucket by hour for short ranges, by day for the year view, averaging
    # across whatever members feed this sensor.
    bucket = "hour" if days <= 30 else "day"
    rows = list(
        coll.aggregate(
            [
                {"$match": {**match, "ts": {"$gte": start}}},
                {
                    "$group": {
                        "_id": {"$dateTrunc": {"date": "$ts", "unit": bucket}},
                        **{k: {"$avg": v} for k, v in agg.items()},
                    }
                },
                {"$sort": {"_id": 1}},
            ]
        )
    )
    stride = max(1, len(rows) // MAX_POINTS)
    points = [
        {
            "t": _iso(r["_id"]),
            "temp_c": _round(r.get("temp_c"), 1),
            "rh_pct": _round(r.get("rh_pct"), 1),
            "fan_rpm": _round(r.get("fan_rpm"), 0),
            "mold_index": _round(r.get("mold_index"), 4),
        }
        for r in rows[::stride]
    ]

    # Mock-style ramp: the tail of the 24h series climbs toward the leak RH.
    sim = simulate.active()
    if sim and sim.get("sensor_id") == sensor_id and range == "24h" and points:
        elapsed = (
            datetime.now(UTC) - sim["started_at"].replace(tzinfo=UTC)
        ).total_seconds()
        t = min(1.0, elapsed / SIM_RH_RAMP_S)
        n = min(24, len(points))
        for i, p in enumerate(points[-n:]):
            k = i / n
            if p["rh_pct"] is None:
                continue
            p["rh_pct"] = round(p["rh_pct"] + (SIM_RH_TARGET - p["rh_pct"]) * t * k, 1)

    # Narrated after the sim ramp so the words see the developing leak.
    summary = sensor_summary.get_summary(
        _entry(sensor_id),
        range,
        points,
        normal,
        simulated=bool(
            sim and sim.get("sensor_id") == sensor_id and range == "24h"
        ),
    )
    return {
        "id": sensor_id,
        "range": range,
        "normal": normal,
        "points": points,
        "summary": summary["summary"],
        "summary_source": summary["source"],
    }


def _round(v, nd):
    return round(v, nd) if isinstance(v, (int, float)) else v


@router.get("/report")
def report() -> dict[str, Any]:
    """Moisture History Report — real aggregates over the full data history."""
    first = db.sense_fan_readings.find_one(sort=[("ts", 1)])
    last = db.sense_fan_readings.find_one(sort=[("ts", -1)])
    if not first or not last:
        raise HTTPException(503, "no measurement data ingested yet")
    start, end = first["ts"], last["ts"]
    span_days = max(1, (end - start).days)

    # Monthly peak mold index per structure group (mold_index exists from
    # 2026-03 in the source data — earlier months simply have no series).
    devs = _devices()
    roof_ids = [devs[s]["device_id"] for s in ROOF_FAN_SLUGS if s in devs]
    crawl_id = devs.get(CRAWL_SLUG, {}).get("device_id")
    monthly: dict[str, dict[str, Any]] = {}
    for r in db.sense_fan_readings.aggregate(
        [
            {"$match": {"mold_index": {"$ne": None}}},
            {
                "$group": {
                    "_id": {
                        "m": {"$dateTrunc": {"date": "$ts", "unit": "month"}},
                        "roof": {"$in": ["$device_id", roof_ids]},
                    },
                    "peak": {"$max": "$mold_index"},
                }
            },
            {"$sort": {"_id.m": 1}},
        ]
    ):
        row = monthly.setdefault(
            r["_id"]["m"].strftime("%Y-%m"), {"month": None, "roof": None, "crawl_space": None}
        )
        row["month"] = r["_id"]["m"].strftime("%Y-%m")
        key = "roof" if r["_id"]["roof"] else "crawl_space"
        row[key] = round(max(row[key] or 0, r["peak"]), 2)
    months = [
        {"month": m["month"], "roof": m["roof"] or 0.0, "crawl_space": m["crawl_space"] or 0.0}
        for m in monthly.values()
    ]

    analysis = service.get_analysis("year")
    structures = _report_structures(start, end, span_days, roof_ids, crawl_id)
    total = (
        db.sense_fan_readings.estimated_document_count()
        + db.sense_sensor_readings.estimated_document_count()
    )

    return {
        "id": f"VS-{end.year}-0001",
        "issued": datetime.now(UTC).date().isoformat(),
        "period": {
            "from": start.date().isoformat(),
            "to": end.date().isoformat(),
        },
        "property": "Detached house, Vaasa",
        "address": f"{HOME['address']}, {HOME['city']}",
        "building": "2019 · timber frame, 1½ storeys",
        "sensors": "Roof · crawl space",
        "verified": f"{start.year}–{end.year}",
        "headline": analysis["headline"],
        "summary": analysis["summary"],
        "recommendations": analysis["recommendations"],
        "mold_threshold": 1,
        "months": months,
        "structures": structures,
        "measurements": total,
        "interval": "hourly",
        "data_gaps": "none detected",
        "weather_context": "FMI · Vaasa",
        "last_sensor_check": end.strftime("%Y-%m"),
    }


def _report_structures(start, end, span_days, roof_ids, crawl_id) -> list[dict[str, Any]]:
    quads = _quadrant_members()
    structures = []

    def structure(name, rh_filter, mold_ids):
        rh = [
            r["avg"]
            for r in db.sense_sensor_readings.aggregate(
                [{"$match": {**rh_filter, "ts": {"$gte": start}}},
                 {"$group": {"_id": None, "avg": {"$avg": "$rh_pct"}}}]
            )
        ] if rh_filter else []
        mold = [
            r
            for r in db.sense_fan_readings.aggregate(
                [
                    {"$match": {"device_id": {"$in": mold_ids}, "mold_index": {"$ne": None}}},
                    {
                        "$group": {
                            "_id": {"$dateTrunc": {"date": "$ts", "unit": "month"}},
                            "peak": {"$max": "$mold_index"},
                            "n": {"$sum": 1},
                        }
                    },
                    {"$sort": {"peak": -1}},
                    {"$limit": 1},
                ]
            )
        ]
        n_readings = db.sense_sensor_readings.count_documents(
            {**rh_filter, "ts": {"$gte": start}}
        ) if rh_filter else db.sense_fan_readings.count_documents(
            {"device_id": {"$in": mold_ids}}
        )
        n_members = len(rh_filter["sensor_id"]["$in"]) if rh_filter else len(mold_ids)
        expected = span_days * 24 * max(n_members, 1)
        peak = mold[0] if mold else None
        return {
            "name": name,
            "avg_rh_pct": round(rh[0]) if rh else 0,
            "peak_mold_index": round(peak["peak"], 2) if peak else 0.0,
            "peak_month": peak["_id"].strftime("%Y-%m") if peak else end.strftime("%Y-%m"),
            "risk_periods": _risk_months(mold_ids),
            "coverage_pct": round(min(100.0, 100 * n_readings / max(expected, 1)), 1),
            "status": "Dry"
            if (peak is None or peak["peak"] < 0.6)
            else "Moisture risk",
        }

    north_ids = [s["sensor_id"] for q in ("roof-nw", "roof-ne") for s in quads[q]]
    south_ids = [s["sensor_id"] for q in ("roof-sw", "roof-se") for s in quads[q]]
    structures.append(
        structure("Roof · north slope", {"sensor_id": {"$in": north_ids}}, roof_ids)
    )
    structures.append(
        structure("Roof · south slope", {"sensor_id": {"$in": south_ids}}, roof_ids)
    )
    structures.append(
        structure(
            "Crawl space · base floor",
            {},
            [crawl_id] if crawl_id else [],
        )
    )
    # crawl-space avg RH comes from the fan's indoor transmitter, not the grid
    crawl = structures[-1]
    if not crawl["avg_rh_pct"] and crawl_id:
        row = list(
            db.sense_fan_readings.aggregate(
                [
                    {"$match": {"device_id": crawl_id, "indoor.rh_pct": {"$ne": None}}},
                    {"$group": {"_id": None, "avg": {"$avg": "$indoor.rh_pct"}}},
                ]
            )
        )
        if row:
            crawl["avg_rh_pct"] = round(row[0]["avg"])
            crawl["coverage_pct"] = round(
                min(
                    100.0,
                    100
                    * db.sense_fan_readings.count_documents(
                        {"device_id": crawl_id, "indoor.rh_pct": {"$ne": None}}
                    )
                    / max(span_days * 24, 1),
                ),
                1,
            )
    return structures


def _risk_months(device_ids: list[int]) -> int:
    """Months whose peak mold index crossed the elevated threshold."""
    if not device_ids:
        return 0
    return len(
        list(
            db.sense_fan_readings.aggregate(
                [
                    {
                        "$match": {
                            "device_id": {"$in": device_ids},
                            "mold_index": {"$gte": digest_mod.MOLD_ELEVATED},
                        }
                    },
                    {
                        "$group": {
                            "_id": {"$dateTrunc": {"date": "$ts", "unit": "month"}}
                        }
                    },
                ]
            )
        )
    )


@router.post("/help-requests")
def help_request(req: HelpRequest) -> dict[str, Any]:
    # One open request per kind — same dedupe rule as the mock client.
    if not db.help_requests.find_one({"kind": req.kind}):
        db.help_requests.insert_one(
            {
                "kind": req.kind,
                "sensor_id": req.sensor_id,
                "created_at": datetime.now(UTC).replace(tzinfo=None),
            }
        )
    return {"message": HELP_MESSAGES[req.kind]}


@router.post("/simulate/leak")
def simulate_leak(req: LeakRequest) -> dict[str, Any]:
    sensor_id = req.sensor_id or SIM_DEFAULT_TARGET
    entry = _entry(sensor_id)
    sim = simulate.start(
        sensor_id=sensor_id,
        device=entry["id"] if entry["kind"] == "fan" else None,
        label=entry["name"].lower(),
    )
    return {"simulating": True, "sensor_id": sim["sensor_id"]}


@router.post("/simulate/reset")
def simulate_reset() -> dict[str, Any]:
    simulate.stop()
    db.help_requests.delete_many({})
    return {"simulating": False}
