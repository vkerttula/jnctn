"""Template narrative — renders the same Narrative shape without an LLM.

Used when GEMINI_API_KEY is unset or the model call fails, so /api/analysis
always works: in CI, in dev before keys exist, and as a demo safety net.
"""

from typing import Any

from app.analysis.models import AttentionItem, Narrative, SensorSummary
from app.analysis.score import TONE_ALL_GOOD, TONE_ATTENTION

_ITEM_TITLES = {
    "MOLD_INDEX_ELEVATED": "Moisture in {loc} could allow mold",
    "RH_SUSTAINED_HIGH": "Humidity staying high in {loc}",
    "AH_INVERSION": "{loc} is holding moisture",
    "FAN_STOPPED": "Ventilation fan not running in {loc}",
    "FAN_NO_DATA": "No recent ventilation data for {loc}",
    "DEVICE_ALERT": "{loc} flagged by the monitoring system",
    "GRID_HUMID": "Roof sensor grid reading humid",
    "SENSOR_OFFLINE": "A sensor has gone quiet",
    "LEAK_SIMULATED": "Possible leak in {loc}",
    "SENSOR_LEAK_SIMULATED": "Possible leak in {loc}",
}

_ITEM_DETAILS = {
    "MOLD_INDEX_ELEVATED": "Moisture conditions there could allow mold "
    "to grow — worth having a professional check.",
    "RH_SUSTAINED_HIGH": "Humidity has stayed high there for a while rather "
    "than coming and going with the weather.",
    "AH_INVERSION": "The structure currently holds more moisture than the "
    "outdoor air, so it is getting wetter rather than drying out.",
    "FAN_STOPPED": "The ventilation fan there isn't spinning, so moist air isn't being moved out.",
    "FAN_NO_DATA": "We haven't heard from that unit recently — the reading may be stale.",
    "DEVICE_ALERT": "The monitoring system itself raised a flag for this location.",
    "GRID_HUMID": "A noticeable share of the roof sensors are reading humid conditions.",
    "SENSOR_OFFLINE": "One roof sensor isn't reporting — this doesn't affect the house itself.",
    "LEAK_SIMULATED": "Humidity is climbing fast there — worth having "
    "a professional check promptly.",
    "SENSOR_LEAK_SIMULATED": "Humidity is climbing fast there — worth having "
    "a professional check promptly.",
}


def render(digest: dict[str, Any], scored: dict[str, Any]) -> Narrative:
    findings = scored["findings"]
    items = [describe_finding(f) for f in findings[:5]]
    tone = scored["tone"]

    if tone == TONE_ALL_GOOD:
        headline = "Your home is in good shape"
        summary = "No worries — everything is looking good."
        recs = ["Nothing needed right now. We'll keep watching."]
    elif tone == TONE_ATTENTION:
        top = findings[0]
        headline = f"{_loc(top, capitalize=True)} needs attention"
        summary = (
            f"{_loc(top, capitalize=True)} needs attention — "
            "moisture levels there have been elevated for a while."
        )
        recs = ["Have a professional inspect the area if readings don't improve."]
    else:
        top = findings[0] if findings else None
        headline = "One area needs watching"
        summary = (
            f"Humidity is a bit up in {_loc(top)} — "
            "this may be normal fluctuation, but we're keeping an eye on it."
            if top
            else "Things look mostly fine, with minor fluctuations we're tracking."
        )
        recs = ["No action needed — check back in a few days."]

    return Narrative(
        headline=headline,
        summary=summary,
        attention_items=items,
        recommendations=recs,
    )


def describe_finding(finding: dict[str, Any]) -> AttentionItem:
    """Render one finding as a plain-language attention item."""
    loc = finding.get("location") or "the house"
    title = _ITEM_TITLES.get(finding["code"], "Something to keep an eye on").format(
        loc=loc
    )
    title = title[0].upper() + title[1:]
    detail = _ITEM_DETAILS.get(finding["code"], "We're monitoring this.")
    if finding.get("occurrences", 1) > 1:
        detail += f" This has come up {finding['occurrences']} times in this period."
    return AttentionItem(title=title, detail=detail, location=loc)


def describe_sensor(context: dict[str, Any]) -> SensorSummary:
    """Template one-liner for the trend view — same shape as the LLM output."""
    label = context["range"]
    stats = context["stats"]
    parts: list[str] = []

    rh = stats.get("rh_pct")
    if rh:
        if rh["share_ge_90"] >= 0.5:
            parts.append(
                f"Humidity stayed high for much of {label} — "
                "the structure is holding moisture."
            )
        elif rh["delta"] >= 5:
            parts.append(f"Humidity has been climbing over {label}.")
        elif rh["delta"] <= -5:
            parts.append(f"Humidity has been drying down over {label}.")
        else:
            parts.append(f"Humidity stayed near its normal range over {label}.")

    mold = stats.get("mold_index")
    if mold and mold["max"] >= 0.5:
        parts.append("Moisture conditions could have allowed mold at some point.")

    rpm = stats.get("fan_rpm")
    if rpm:
        if rpm["stopped_share"] >= 0.5:
            parts.append(f"The fan was stopped for most of {label}.")
        elif rpm["stopped_share"] > 0:
            parts.append("The fan stopped for part of the period.")
        else:
            parts.append(f"The fan ran steadily over {label}.")

    if not parts:
        parts.append(f"Only sparse readings came through over {label}.")
    return SensorSummary(summary=" ".join(parts[:2]))


def _loc(finding: dict[str, Any], capitalize: bool = False) -> str:
    loc = finding.get("location") or "the house"
    return loc[0].upper() + loc[1:] if capitalize else loc
