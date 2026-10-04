"""Deterministic house score (0-100) and findings from a digest.

The LLM never decides the score or the tone — it only narrates what this
module concludes. That keeps the number stable and honest, and means the
fallback narrative can render the same conclusions without an LLM at all.
"""

from typing import Any

from app.analysis.digest import AH_INVERSION_DELTA

TONE_ALL_GOOD = "all_good"
TONE_WATCH = "watch"
TONE_ATTENTION = "attention"

WEATHER_DISCOUNT = 0.35  # RH episode explained by the outdoor air / weather
TRACKS_OUTDOOR_AH = 0.2  # indoor AH this close to outdoor = mirrors the air
DRY_WEATHER_MULTIPLIER = 1.5  # still wetter than outdoors in dry weather


def score_digest(digest: dict[str, Any]) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    penalty = 0.0

    # Indoor-vs-outdoor absolute-humidity delta per device: <= ~0 means the
    # structure tracks the weather (benign); positive means it holds moisture.
    ah_delta = {
        d["device"]: _sub(
            (d.get("span") or {}).get("indoor_ah_mean"),
            (d.get("span") or {}).get("outdoor_ah_mean"),
        )
        for d in digest.get("devices", [])
    }

    # Repeated episodes of the same kind in the same place shouldn't stack
    # linearly — the worst one counts fully, each recurrence adds a little.
    groups: dict[tuple, list[tuple[dict, dict, float]]] = {}
    for ev in digest.get("events", []):
        finding, points = _score_event(ev)
        if not finding:
            continue
        points = _weather_adjust(ev, finding, points, ah_delta.get(ev.get("device")))
        key = (ev["type"], ev.get("device") or ev.get("serial"))
        groups.setdefault(key, []).append((ev, finding, points))

    # Worst episode of each group counts fully; recurrences add up to +50%.
    # Penalties are then discounted harmonically across groups (worst finding
    # counts fully, each additional one less) so long windows with many minor
    # episodes can't zero the score on their own.
    group_penalties: list[tuple[float, dict, str]] = []
    for (etype, _), group in groups.items():
        group.sort(key=lambda g: g[2], reverse=True)
        ev, finding, points = group[0]
        finding["occurrences"] = len(group)
        starts = [e["start"] for e, _, _ in group if e.get("start")]
        if starts:
            finding["since"] = min(starts)
        findings.append(finding)
        group_penalties.append(
            (points * min(1.5, 1 + 0.05 * (len(group) - 1)), finding, etype)
        )

    group_penalties.sort(key=lambda g: g[0], reverse=True)
    offline_points = 0.0
    for rank, (points, _finding, etype) in enumerate(group_penalties):
        discounted = points / (rank + 1)
        if etype == "SENSOR_OFFLINE":
            offline_points = min(5, offline_points + discounted)
        else:
            penalty += discounted
    penalty += offline_points

    grid = digest.get("sensor_grid") or {}
    pct90 = (grid.get("span") or {}).get("pct_sensors_mean_rh_ge_90")
    if pct90:
        penalty += min(10, pct90 / 5)
        findings.append(
            {
                "code": "GRID_HUMID",
                "severity": "watch",
                "detail": {"pct_sensors_high": pct90},
            }
        )

    score = max(0, min(100, round(100 - penalty)))
    tone = (
        TONE_ALL_GOOD
        if score >= 80
        else TONE_WATCH
        if score >= 55
        else TONE_ATTENTION
    )
    findings.sort(key=lambda f: _SEVERITY_RANK.get(f["severity"], 0), reverse=True)
    return {"score": score, "tone": tone, "findings": findings}


_SEVERITY_RANK = {"attention": 2, "watch": 1, "info": 0}


def _sub(a, b):
    return a - b if a is not None and b is not None else None


def _weather_adjust(ev, finding, points: float, ah_delta: float | None) -> float:
    """Weigh an event against the outdoor weather it happened in."""
    condition = (ev.get("outdoor_weather") or {}).get("condition")
    if ev["type"] == "RH_SUSTAINED_HIGH":
        # High indoor RH that merely mirrors humid outdoor air, or that rode a
        # wet spell without the structure clearly holding extra moisture, is
        # weather — not a moisture problem. Downweight it.
        tracks_air = ah_delta is not None and ah_delta <= TRACKS_OUTDOOR_AH
        wet_spell = condition == "wet" and (ah_delta is None or ah_delta < AH_INVERSION_DELTA)
        finding["detail"]["weather_driven"] = tracks_air or wet_spell
        if tracks_air or wet_spell:
            points *= WEATHER_DISCOUNT
    elif ev["type"] == "AH_INVERSION":
        # Wetter than outdoor air even though the weather gave it every
        # chance to dry — the structure isn't keeping up. Weigh it up.
        finding["detail"]["dry_weather"] = condition == "dry"
        if condition == "dry":
            points *= DRY_WEATHER_MULTIPLIER
    return points


def score_trend(digest: dict[str, Any]) -> str:
    """improving | stable | declining — from span-vs-baseline deltas."""
    deltas = [
        (d.get("trend") or {}).get("indoor_rh_delta")
        for d in digest.get("devices", [])
    ]
    deltas = [x for x in deltas if x is not None]
    if not deltas:
        return "stable"
    mean_delta = sum(deltas) / len(deltas)
    if mean_delta <= -1.5:
        return "improving"
    if mean_delta >= 1.5:
        return "declining"
    return "stable"


def _score_event(ev: dict[str, Any]) -> tuple[dict[str, Any] | None, float]:
    t = ev["type"]

    if t == "MOLD_INDEX_ELEVATED":
        points = min(40, 15 + ev.get("peak", 0) * 30)
        if not ev.get("ongoing"):
            points *= 0.5
        return (
            {
                "code": t,
                "severity": "attention" if ev.get("peak", 0) >= 0.8 else "watch",
                "location": ev.get("label"),
                "ref": ev.get("device"),
                "detail": {"peak": ev.get("peak"), "ongoing": ev.get("ongoing")},
            },
            points,
        )

    if t == "RH_SUSTAINED_HIGH":
        # High indoor RH alone is often just humid weather; sustained or
        # ongoing runs matter more than brief overnight spikes.
        hours = ev.get("duration_hours", 0)
        points = min(12, 3 + hours / 12)
        if ev.get("ongoing"):
            points += 3
        return (
            {
                "code": t,
                "severity": "watch",
                "location": ev.get("label"),
                "ref": ev.get("device"),
                "detail": {
                    "peak_rh": ev.get("peak_rh"),
                    "duration_hours": hours,
                    "ongoing": ev.get("ongoing"),
                },
            },
            points,
        )

    if t == "AH_INVERSION":
        return (
            {
                "code": t,
                "severity": "watch",
                "location": ev.get("label"),
                "ref": ev.get("device"),
                "detail": {
                    "indoor_ah": ev.get("indoor_ah"),
                    "outdoor_ah": ev.get("outdoor_ah"),
                },
            },
            6,
        )

    if t in ("LEAK_SIMULATED", "SENSOR_LEAK_SIMULATED"):
        return (
            {
                "code": t,
                "severity": "attention",
                "location": ev.get("label"),
                "ref": ev.get("device") or ev.get("serial"),
                "detail": {"peak_rh": ev.get("peak_rh"), "simulated": True},
            },
            30,
        )

    if t == "FAN_STOPPED":
        return (
            {
                "code": t,
                "severity": "watch",
                "location": ev.get("label"),
                "ref": ev.get("device"),
                "detail": {"rpm": ev.get("rpm")},
            },
            8,
        )

    if t == "FAN_NO_DATA":
        return (
            {"code": t, "severity": "info", "location": ev.get("label"),
                "ref": ev.get("device"), "detail": {}},
            3,
        )

    if t == "DEVICE_ALERT":
        return (
            {"code": t, "severity": "watch", "location": ev.get("label"),
                "ref": ev.get("device"), "detail": {}},
            10,
        )

    if t == "SENSOR_OFFLINE":
        return (
            {
                "code": t,
                "severity": "info",
                "ref": ev.get("serial"),
                "detail": {"serial": ev.get("serial")},
            },
            1,
        )

    return None, 0
