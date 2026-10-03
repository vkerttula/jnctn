"""Per-sensor, per-range narrative for the trend view.

Stats are computed from the same hourly buckets the chart draws, so the
words always match what the homeowner sees. Results cache in
`sensor_summaries` per (sensor, range, period) — hourly for 24h, daily
for 7d/30d — mirroring how service.py caches whole-house analyses.
"""

import logging
from datetime import UTC, datetime
from typing import Any

from app.analysis import fallback, llm
from app.db import db

log = logging.getLogger(__name__)

summaries = db["sensor_summaries"]
summaries.create_index(
    [("sensor_id", 1), ("range", 1), ("period_key", 1)], unique=True
)

RANGE_LABEL = {
    "24h": "the last 24 hours",
    "7d": "the past week",
    "30d": "the past month",
}
PERIOD_KEY_FORMAT = {"24h": "%Y-%m-%dT%H", "7d": "%Y-%m-%d", "30d": "%Y-%m-%d"}


def _col(points: list[dict], key: str) -> list[float]:
    return [p[key] for p in points if p.get(key) is not None]


def _stats(points: list[dict]) -> dict[str, Any]:
    stats: dict[str, Any] = {"bucket_count": len(points)}

    rh = _col(points, "rh_pct")
    if rh:
        stats["rh_pct"] = {
            "first": rh[0],
            "last": rh[-1],
            "delta": round(rh[-1] - rh[0], 1),
            "min": min(rh),
            "mean": round(sum(rh) / len(rh), 1),
            "max": max(rh),
            "share_ge_90": round(sum(1 for v in rh if v >= 90) / len(rh), 2),
        }
    temp = _col(points, "temp_c")
    if temp:
        stats["temp_c"] = {
            "mean": round(sum(temp) / len(temp), 1),
            "min": min(temp),
            "max": max(temp),
        }
    mold = _col(points, "mold_index")
    if mold:
        stats["mold_index"] = {"last": mold[-1], "max": max(mold)}
    rpm = _col(points, "fan_rpm")
    if rpm:
        stats["fan_rpm"] = {
            "mean": round(sum(rpm) / len(rpm)),
            "last": rpm[-1],
            "stopped_share": round(sum(1 for v in rpm if not v) / len(rpm), 2),
        }
    return stats


def get_summary(
    sensor: dict,
    range_: str,
    points: list[dict],
    normal: dict | None,
    simulated: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    """{"summary": str|None, "source": ...} for one sensor's series."""
    if not points:
        return {"summary": None, "source": "no-data"}

    now = now or datetime.now(UTC)
    pkey = now.strftime(PERIOD_KEY_FORMAT[range_])
    key = {"sensor_id": sensor["id"], "range": range_, "period_key": pkey}
    if not simulated:
        cached = summaries.find_one(key)
        if cached:
            return {"summary": cached["summary"], "source": cached["source"]}

    end = datetime.fromisoformat(points[-1]["t"].replace("Z", "+00:00"))
    context = {
        "sensor": sensor["name"],
        "kind": sensor["kind"],
        "zone": sensor["zone"],
        "range": RANGE_LABEL[range_],
        "month": end.strftime("%B"),
        "normal_band": normal,
        "stats": _stats(points),
    }

    if llm.available():
        try:
            narrative, source = llm.narrate_sensor(context), "llm"
        except Exception:
            log.exception("LLM sensor narration failed; using fallback")
            narrative, source = fallback.describe_sensor(context), "fallback"
    else:
        narrative, source = fallback.describe_sensor(context), "fallback"

    if not simulated:
        summaries.replace_one(
            key, {**key, "generated_at": now, "summary": narrative.summary,
                  "source": source},
            upsert=True,
        )
    return {"summary": narrative.summary, "source": source}
