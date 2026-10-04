"""Aggregate raw Mongo readings into a compact digest for scoring + narration.

The LLM never sees raw time series — it sees this digest. Statistics preserve
the facts (peaks, durations, deltas) that prose summaries would lose, and the
same `build_digest(window)` path powers day/week/month/year analyses by just
widening the span and bucketing coarser.

Only the physical sources behind the house's logical sensors
(`app.catalog`) are read, and they are labelled with the UI's names.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from app import catalog
from app.analysis import weather
from app.db import db

SITE_TZ = ZoneInfo("Europe/Helsinki")

Window = Literal["day", "week", "month", "year"]

WINDOWS: dict[str, dict[str, Any]] = {
    "day": {"span": timedelta(hours=24), "baseline": timedelta(days=7), "bucket": None},
    "week": {"span": timedelta(days=7), "baseline": timedelta(days=7), "bucket": "day"},
    "month": {"span": timedelta(days=30), "baseline": timedelta(days=30), "bucket": "week"},
    "year": {"span": timedelta(days=365), "baseline": None, "bucket": "month"},
}

# How fresh the cached analysis may be before we regenerate, per window.
PERIOD_KEY_FORMAT = {
    "day": "%Y-%m-%dT%H",  # at most hourly
    "week": "%Y-%m-%d",  # daily
    "month": "%Y-%m-%d",
    "year": "%Y-%m",
}


# Event-detection thresholds. mold_index is VILPE's own mold-risk metric,
# observed in the data on a ~0..1 scale.
RH_HIGH_PCT = 85.0
MOLD_ELEVATED = 0.5
AH_INVERSION_DELTA = 0.5  # indoor abs humidity this far above outdoor = not drying
MAX_GAP = timedelta(hours=12)  # longer reading gap breaks a "sustained" run
MIN_RUN = {"day": timedelta(hours=6), "week": timedelta(hours=24),
           "month": timedelta(hours=24), "year": timedelta(hours=48)}

_STATS_GROUP = {
    "n": {"$sum": 1},
    "indoor_rh_mean": {"$avg": "$indoor.rh_pct"},
    "indoor_rh_max": {"$max": "$indoor.rh_pct"},
    "indoor_temp_mean": {"$avg": "$indoor.temp_c"},
    "indoor_ah_mean": {"$avg": "$indoor.abs_humidity_g_m3"},
    "outdoor_rh_mean": {"$avg": "$outdoor.rh_pct"},
    "outdoor_temp_mean": {"$avg": "$outdoor.temp_c"},
    "outdoor_ah_mean": {"$avg": "$outdoor.abs_humidity_g_m3"},
    "mold_mean": {"$avg": "$mold_index"},
    "mold_max": {"$max": "$mold_index"},
    "rpm_mean": {"$avg": "$rpm"},
    "rpm_min": {"$min": "$rpm"},
}


def period_key(window: Window, now: datetime) -> str:
    return now.strftime(PERIOD_KEY_FORMAT[window])


def build_digest(
    window: Window,
    now: datetime | None = None,
    weather_days: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build the context packet for a window from Mongo (+ daily weather)."""
    if window not in WINDOWS:
        raise ValueError(f"unknown window {window!r}")
    now = now or datetime.now(UTC)
    if weather_days is None:
        weather_days = _weather_days(window, now)
    cfg = WINDOWS[window]
    span_start = now - cfg["span"]
    baseline_start = span_start - cfg["baseline"] if cfg["baseline"] else None

    stats = _device_stats(span_start, now)
    baseline = _device_stats(baseline_start, span_start) if baseline_start else {}
    buckets = _device_buckets(span_start, cfg["bucket"]) if cfg["bucket"] else {}

    devices = []
    for meta in db.sense_devices.find({"slug": {"$in": catalog.FAN_DEVICES}}):
        slug = meta["slug"]
        devices.append(
            _device_digest(meta, stats.get(slug), baseline.get(slug),
                           buckets.get(slug, []), span_start, now)
        )

    return {
        "window": window,
        "generated_at": now.isoformat(),
        "period": {"start": span_start.isoformat(), "end": now.isoformat()},
        "season": _season(now),
        "site": _site(),
        "devices": devices,
        "sensor_grid": _sensor_grid(span_start, now),
        "weather": _weather_block(weather_days, cfg["bucket"], span_start, baseline_start, now),
        "events": [],  # filled in below; needs the sensor grid too
    }


def build(window: Window, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    days = _weather_days(window, now)
    digest = build_digest(window, now, days)
    digest["events"] = _events(digest, now, days)
    return digest


def _local_date(ts: datetime) -> date:
    return ts.astimezone(SITE_TZ).date()


def _weather_days(window: Window, now: datetime) -> list[dict[str, Any]]:
    """Daily weather covering baseline + span; [] when unavailable."""
    cfg = WINDOWS[window]
    start = now - cfg["span"] - (cfg["baseline"] or timedelta(0))
    return weather.history(_local_date(start), _local_date(now)) or []


def _days_between(days, start: datetime, end: datetime) -> list[dict[str, Any]]:
    lo, hi = _local_date(start).isoformat(), _local_date(end).isoformat()
    return [d for d in days if lo <= d["date"] <= hi]


def _bucket_key(day: str, unit: str) -> str:
    # Mirrors Mongo's $dateTrunc defaults used for the device buckets
    # (weeks start on Sunday) so weather buckets line up with device buckets.
    d = date.fromisoformat(day)
    if unit == "week":
        d -= timedelta(days=(d.weekday() + 1) % 7)
    elif unit == "month":
        d = d.replace(day=1)
    return d.isoformat()


def _weather_block(days, unit, span_start, baseline_start, now) -> dict[str, Any] | None:
    """Outdoor weather at the sensor site over the span (and its baseline)."""
    span_days = _days_between(days, span_start, now)
    if not span_days:
        return None
    out: dict[str, Any] = {
        "location": weather.SITE["location"],
        "source": "Open-Meteo",
        "span": weather.summarize(span_days),
    }
    if baseline_start:
        # The span's first local day also belongs to the baseline's last;
        # keep it on the span side.
        first = span_days[0]["date"]
        base = [d for d in _days_between(days, baseline_start, span_start) if d["date"] < first]
        out["baseline"] = weather.summarize(base)
    if unit:
        groups: dict[str, list[dict]] = {}
        for d in span_days:
            groups.setdefault(_bucket_key(d["date"], unit), []).append(d)
        out["buckets"] = [
            {"bucket": k, **{f: s[f] for f in ("condition", "precip_mm", "rainy_days",
                                               "temp_mean", "rh_mean")}}
            for k, g in groups.items()
            if (s := weather.summarize(g))
        ]
    return out


def _brief(summary: dict[str, Any] | None) -> dict[str, Any] | None:
    """The weather fields attached to an event (what scoring reads)."""
    if not summary:
        return None
    return {f: summary[f] for f in ("condition", "days", "precip_mm", "rainy_days", "rh_mean")}


def _season(now: datetime) -> str:
    names = ["winter", "winter", "spring", "spring", "spring", "summer",
             "summer", "summer", "autumn", "autumn", "autumn", "winter"]
    return f"{names[now.month - 1]} ({now.strftime('%B')})"


def _site() -> dict[str, Any]:
    site = db.sense_site.find_one() or {}
    return {"name": site.get("name"), "location": "Vantaa, Finland"}


def _device_stats(start: datetime, end: datetime | None) -> dict[str, dict]:
    match: dict[str, Any] = {"device": {"$in": catalog.FAN_DEVICES}, "ts": {"$gte": start}}
    if end:
        match["ts"]["$lt"] = end
    return {
        r["_id"]: _round_dict(r)
        for r in db.sense_fan_readings.aggregate(
            [{"$match": match}, {"$group": {"_id": "$device", **_STATS_GROUP}}]
        )
    }


def _device_buckets(start: datetime, unit: str) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for r in db.sense_fan_readings.aggregate(
        [
            {"$match": {"device": {"$in": catalog.FAN_DEVICES}, "ts": {"$gte": start}}},
            {
                "$group": {
                    "_id": {
                        "device": "$device",
                        "bucket": {"$dateTrunc": {"date": "$ts", "unit": unit}},
                    },
                    **_STATS_GROUP,
                }
            },
            {"$sort": {"_id.bucket": 1}},
        ]
    ):
        row = _round_dict(r)
        row["bucket"] = r["_id"]["bucket"].strftime("%Y-%m-%d")
        out.setdefault(r["_id"]["device"], []).append(row)
    return out


def _latest_field(device_id: int, dotted: str, start: datetime) -> dict[str, Any] | None:
    doc = db.sense_fan_readings.find_one(
        {"device_id": device_id, "ts": {"$gte": start}, dotted: {"$ne": None}},
        {"ts": 1, dotted: 1},
        sort=[("ts", -1)],
    )
    if not doc:
        return None
    value = doc
    for part in dotted.split("."):
        value = value[part]
    return {"value": value, "ts": doc["ts"].isoformat()}


def _device_digest(meta, stats, baseline, buckets, span_start, now) -> dict[str, Any]:
    slug = meta.get("slug") or meta["serial_number"]
    lookback = now - timedelta(days=400)  # latest values can predate the span
    out = {
        "device": slug,
        "label": catalog.DEVICE_LABELS.get(slug, slug),
        "is_online": meta.get("is_online"),
        "is_alert": meta.get("is_alert"),
        "latest": {
            k: _latest_field(meta["device_id"], f, lookback)
            for k, f in {
                "indoor": "indoor.rh_pct",
                "indoor_temp": "indoor.temp_c",
                "indoor_ah": "indoor.abs_humidity_g_m3",
                "outdoor_ah": "outdoor.abs_humidity_g_m3",
                "outdoor": "outdoor.rh_pct",
                "outdoor_temp": "outdoor.temp_c",
                "mold_index": "mold_index",
                "rpm": "rpm",
            }.items()
        },
        "span": stats,
        "baseline": baseline,
        "buckets": buckets,
    }
    if stats and baseline:
        out["trend"] = _round_dict(
            {
                "indoor_rh_delta": _sub(
                    stats.get("indoor_rh_mean"), baseline.get("indoor_rh_mean")
                ),
                "mold_delta": _sub(stats.get("mold_mean"), baseline.get("mold_mean")),
                "ah_delta_delta": _sub(
                    _sub(stats.get("indoor_ah_mean"), stats.get("outdoor_ah_mean")),
                    _sub(baseline.get("indoor_ah_mean"), baseline.get("outdoor_ah_mean")),
                ),
            }
        )
    return out


def _sensor_grid(start: datetime, now: datetime) -> dict[str, Any]:
    # The sensor grid comes from a CSV snapshot that ends before "now" while fan
    # data is live. Anchor the grid window at the latest available reading and
    # report `as_of` so scoring/narration know the grid's data vintage.
    ids = {"sensor_id": {"$in": catalog.GRID_IDS}}
    latest_doc = db.sense_sensor_readings.find_one(ids, sort=[("ts", -1)], projection={"ts": 1})
    as_of = latest_doc["ts"].replace(tzinfo=UTC) if latest_doc else None
    span_len = now - start
    if as_of is None:
        return {"count": 0, "offline_count": 0, "as_of": None, "span": {}, "outliers": [],
                "offline": []}
    if as_of < start:
        start = as_of - span_len

    per_sensor = {
        r["_id"]: r
        for r in db.sense_sensor_readings.aggregate(
            [
                {"$match": {**ids, "ts": {"$gte": start}}},
                {
                    "$group": {
                        "_id": "$sensor_id",
                        "serial": {"$last": "$sensor_serial"},
                        "rh_mean": {"$avg": "$rh_pct"},
                        "rh_max": {"$max": "$rh_pct"},
                        "temp_mean": {"$avg": "$temp_c"},
                        "n": {"$sum": 1},
                        "last_ts": {"$max": "$ts"},
                    }
                },
            ]
        )
    }
    meta_by_id = {s["sensor_id"]: s for s in db.sense_sensors.find(ids)}

    means = sorted(r["rh_mean"] for r in per_sensor.values() if r["rh_mean"] is not None)
    median = means[len(means) // 2] if means else None

    sensors = []
    for sensor_id, m in meta_by_id.items():
        agg = per_sensor.get(sensor_id)
        offline = not m.get("is_online", True) or agg is None
        sensors.append(
            {
                "sensor_id": sensor_id,
                "serial": m.get("serial_number"),
                "label": catalog.grid_label(m.get("serial_number")),
                "offline": offline,
                "span": _round_dict(
                    {
                        "rh_mean": agg["rh_mean"] if agg else None,
                        "rh_max": agg["rh_max"] if agg else None,
                        "temp_mean": agg["temp_mean"] if agg else None,
                        "n": agg["n"] if agg else 0,
                    }
                ),
            }
        )

    live = [s for s in sensors if not s["offline"] and s["span"]["rh_mean"] is not None]
    return {
        "count": len(sensors),
        "offline_count": len(sensors) - len(live),
        "as_of": as_of.isoformat(),
        "data_lag_days": round((now - as_of).total_seconds() / 86400, 1),
        "span": {
            "rh_median": _round(median),
            "pct_sensors_mean_rh_ge_80": _pct(live, lambda s: s["span"]["rh_mean"] >= 80),
            "pct_sensors_mean_rh_ge_90": _pct(live, lambda s: s["span"]["rh_mean"] >= 90),
        },
        "outliers": [
            {"serial": s["serial"], "label": s["label"], "rh_mean": s["span"]["rh_mean"],
             "rh_max": s["span"]["rh_max"]}
            for s in live
            if median is not None and s["span"]["rh_mean"] >= median + 10
        ],
        "offline": [s["serial"] for s in sensors if s["offline"]],
    }


def _series(device_id: int, dotted: str, start: datetime) -> list[tuple[datetime, float]]:
    parent, _, leaf = dotted.rpartition(".")
    out = []
    for doc in db.sense_fan_readings.find(
        {"device_id": device_id, "ts": {"$gte": start}, dotted: {"$ne": None}},
        {"ts": 1, dotted: 1},
        sort=[("ts", 1)],
    ):
        node = doc.get(parent, {}) if parent else doc
        if node.get(leaf) is not None:
            out.append((doc["ts"].replace(tzinfo=UTC), node[leaf]))
    return out


def _sustained_runs(
    points: list[tuple[datetime, float]], threshold: float, min_duration: timedelta
) -> list[dict[str, Any]]:
    """Episodes where the series stayed >= threshold, splitting on long gaps."""
    runs: list[dict[str, Any]] = []
    cur = None
    prev_ts = None
    for ts, v in points:
        fresh = prev_ts is None or ts - prev_ts <= MAX_GAP
        prev_ts = ts
        if v >= threshold and fresh:
            if cur is None:
                cur = {"start": ts, "peak": v}
            cur["end"], cur["peak"] = ts, max(cur["peak"], v)
        else:
            if cur and cur["end"] - cur["start"] >= min_duration:
                runs.append(cur)
            cur = None
    if cur and cur["end"] - cur["start"] >= min_duration:
        runs.append(cur)
    return runs


def _events(
    digest: dict[str, Any], now: datetime, weather_days: list[dict[str, Any]] | None = None
) -> list[dict[str, Any]]:
    events = []
    days = weather_days or []
    span_weather = _brief((digest.get("weather") or {}).get("span"))
    window = digest["window"]
    span_start = datetime.fromisoformat(digest["period"]["start"])
    min_run = MIN_RUN[window]
    meta = {d.get("slug") or d["serial_number"]: d for d in db.sense_devices.find()}

    for d in digest["devices"]:
        device_id = meta[d["device"]]["device_id"]
        label = d["label"]

        for run in _sustained_runs(
            _series(device_id, "indoor.rh_pct", span_start), RH_HIGH_PCT, min_run
        ):
            events.append(
                {
                    "type": "RH_SUSTAINED_HIGH",
                    "device": d["device"],
                    "label": label,
                    "start": run["start"].isoformat(),
                    "end": run["end"].isoformat(),
                    "ongoing": run["end"] >= now - timedelta(hours=6),
                    "peak_rh": round(run["peak"], 1),
                    "duration_hours": round((run["end"] - run["start"]).total_seconds() / 3600),
                    "outdoor_weather": _brief(
                        weather.summarize(_days_between(days, run["start"], run["end"]))
                    ),
                }
            )

        for run in _sustained_runs(
            _series(device_id, "mold_index", span_start), MOLD_ELEVATED, timedelta(0)
        ):
            events.append(
                {
                    "type": "MOLD_INDEX_ELEVATED",
                    "device": d["device"],
                    "label": label,
                    "start": run["start"].isoformat(),
                    "end": run["end"].isoformat(),
                    "ongoing": run["end"] >= now - timedelta(hours=24),
                    "peak": round(run["peak"], 2),
                }
            )

        span = d.get("span") or {}
        ih, oh = span.get("indoor_ah_mean"), span.get("outdoor_ah_mean")
        if ih is not None and oh is not None and ih - oh >= AH_INVERSION_DELTA:
            events.append(
                {
                    "type": "AH_INVERSION",
                    "device": d["device"],
                    "label": label,
                    "detail": "structure holds more moisture than outdoor air "
                    "— it is wetting, not drying",
                    "indoor_ah": ih,
                    "outdoor_ah": oh,
                    "outdoor_weather": span_weather,
                }
            )

        rpm = d["latest"].get("rpm")
        if rpm and rpm["value"] is not None and rpm["value"] < 100:
            events.append(
                {"type": "FAN_STOPPED", "device": d["device"], "label": label, "rpm": rpm["value"]}
            )
        elif rpm is None:
            events.append({"type": "FAN_NO_DATA", "device": d["device"], "label": label})

        if d.get("is_alert"):
            events.append({"type": "DEVICE_ALERT", "device": d["device"], "label": label})

    for serial in digest["sensor_grid"]["offline"]:
        events.append({"type": "SENSOR_OFFLINE", "serial": serial,
                       "label": catalog.grid_label(serial)})

    return events


def _sub(a, b):
    return round(a - b, 2) if a is not None and b is not None else None


def _round(v, nd=2):
    return round(v, nd) if isinstance(v, (int, float)) else v


def _round_dict(d: dict) -> dict:
    return {k: _round(v) for k, v in d.items() if k != "_id"}


def _pct(rows, pred) -> float | None:
    if not rows:
        return None
    return round(100 * sum(1 for r in rows if pred(r)) / len(rows), 1)
