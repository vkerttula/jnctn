"""Gemini narration — turns a scored digest into plain-language output.

The model only writes words. Score, tone and findings are computed
deterministically upstream and passed in as ground truth; the response is
validated against the Narrative schema, with one retry before the caller
falls back to templates.
"""

import json
import os
from typing import Any

from app.analysis.models import Narrative, SensorSummary

MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")

SYSTEM = """\
You are the voice of a home-monitoring product — "Oura for a house". \
You interpret building sensor data (roof structures, crawl spaces, \
ventilation fans) for homeowners who cannot read charts.

Rules:
- Match the requested tone exactly: all_good = brief reassurance; \
watch = calm "we're keeping an eye on it"; attention = clear but calm \
advice that something deserves action. Never panic, never falsely reassure.
- You observe, you never diagnose. Do not state or imply the home has \
mold, a leak or other damage — describe only what the sensors show \
("moisture has stayed high", "the fan stopped"). If a condition could \
matter, hedge it ("could allow mold", "may need a look"). When tone is \
attention, point the homeowner to a qualified professional to assess it — \
we measure, they diagnose.
- Plain language only. No units, decimals, ppm, percentages or jargon. \
Say "the crawl space has been damp for a while", not "RH 98.1% for 20h". \
Never say "mold_index". One concrete number per sentence \
at most, only when it truly helps ("for about two weeks").
- Refer to locations by their label ("the crawl space", "roof section 3").
- Seasonal awareness: autumn wetting is expected; what matters is whether \
the structure keeps up with drying when it can.
- headline: one short verdict line, e.g. "Your home is in good shape" \
or "One area needs watching" — never a diagnosis.
- summary: ONE short sentence, under ~110 characters — say what the \
sensors show, nothing more. attention_items: at most 3, only real \
findings. recommendations: at most 2 — keep an eye on it, or have a \
professional check it when tone is attention. If tone is all_good, both \
lists may be empty or contain a single light reassurance.
"""

SENSOR_SYSTEM = """\
You are the voice of a home-monitoring product — "Oura for a house". \
You get statistics about one sensor's readings over a time range and \
write one sentence (two short ones at most) for the homeowner, shown \
above that sensor's trend chart.

Rules:
- Describe the trend, not the numbers: "humidity crept up over the \
week", "stayed in its normal range", "the fan ran steadily". No units, \
decimals, ppm or jargon. At most one concrete number, only when it \
helps ("for about three days").
- Calm and factual — say what the readings did and whether it matters. \
Don't start with the sensor's name; the page already shows it.
- Never diagnose — no claims of mold or leaks. If the readings look \
concerning, at most suggest a professional could assess it.
- If readings are sparse or missing for part of the range, say so \
plainly.
"""

WINDOW_NAMES = {
    "day": "today (last 24 hours, compared with the previous week)",
    "week": "this week (compared with the week before)",
    "month": "this month (compared with the month before)",
    "year": "the past year",
}


def available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))


def narrate(
    digest: dict[str, Any],
    scored: dict[str, Any],
    previous_summary: str | None = None,
) -> Narrative:
    from google import genai
    from google.genai import types

    context = {
        "audience_window": WINDOW_NAMES[digest["window"]],
        "required_tone": scored["tone"],
        "score_out_of_100": scored["score"],
        "season": digest["season"],
        "site": digest["site"],
        "findings": scored["findings"],
        "events": digest["events"],
        "devices": digest["devices"],
        "sensor_grid": digest["sensor_grid"],
    }
    if previous_summary:
        context["previous_summary_for_continuity"] = previous_summary

    client = genai.Client()
    prompt = "Here is the current house condition as structured data:\n" + json.dumps(
        context, default=str
    )
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM,
        response_mime_type="application/json",
        response_schema=Narrative,
        temperature=0.4,
    )

    last_error: Exception | None = None
    for _ in range(2):
        try:
            resp = client.models.generate_content(
                model=MODEL, contents=prompt, config=config
            )
            return Narrative.model_validate_json(resp.text)
        except Exception as e:  # bad JSON, quota, network — caller falls back
            last_error = e
    raise RuntimeError(f"gemini narration failed: {last_error}")


def narrate_sensor(context: dict[str, Any]) -> SensorSummary:
    from google import genai
    from google.genai import types

    client = genai.Client()
    config = types.GenerateContentConfig(
        system_instruction=SENSOR_SYSTEM,
        response_mime_type="application/json",
        response_schema=SensorSummary,
        temperature=0.4,
    )

    last_error: Exception | None = None
    for _ in range(2):
        try:
            resp = client.models.generate_content(
                model=MODEL, contents=json.dumps(context, default=str), config=config
            )
            return SensorSummary.model_validate_json(resp.text)
        except Exception as e:
            last_error = e
    raise RuntimeError(f"gemini sensor narration failed: {last_error}")
