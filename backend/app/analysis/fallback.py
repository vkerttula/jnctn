"""Template narrative — renders the same Narrative shape without an LLM.

Used when GEMINI_API_KEY is unset or the model call fails, so /api/analysis
always works: in CI, in dev before keys exist, and as a demo safety net.
"""

from typing import Any

from app.analysis.models import AttentionItem, Narrative
from app.analysis.score import TONE_ALL_GOOD, TONE_ATTENTION

_ITEM_TITLES = {
    "MOLD_INDEX_ELEVATED": "Elevated mold risk in {loc}",
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
    "MOLD_INDEX_ELEVATED": "Moisture conditions there have been favorable "
    "for mold growth. Worth watching closely.",
    "RH_SUSTAINED_HIGH": "Humidity has stayed high there for a while rather "
    "than coming and going with the weather.",
    "AH_INVERSION": "The structure currently holds more moisture than the "
    "outdoor air, so it is getting wetter rather than drying out.",
    "FAN_STOPPED": "The ventilation fan there isn't spinning, so moist air isn't being moved out.",
    "FAN_NO_DATA": "We haven't heard from that unit recently — the reading may be stale.",
    "DEVICE_ALERT": "The monitoring system itself raised a flag for this location.",
    "GRID_HUMID": "A noticeable share of the roof sensors are reading humid conditions.",
    "SENSOR_OFFLINE": "One roof sensor isn't reporting — this doesn't affect the house itself.",
    "LEAK_SIMULATED": "Humidity is climbing fast there — consistent with "
    "a leak. Worth checking promptly.",
    "SENSOR_LEAK_SIMULATED": "Humidity is climbing fast there — consistent "
    "with a leak. Worth checking promptly.",
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
        recs = ["Consider having the area inspected if readings don't improve."]
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


def _loc(finding: dict[str, Any], capitalize: bool = False) -> str:
    loc = finding.get("location") or "the house"
    return loc[0].upper() + loc[1:] if capitalize else loc
