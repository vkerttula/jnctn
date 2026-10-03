"""Orchestration: digest -> score -> narrate, cached in the `analyses` collection.

One document per (window, period_key) — period keys are coarse (hourly for
"day", daily for "week"/"month", monthly for "year") so page loads reuse the
same analysis until the data has had time to change.
"""

import logging
from datetime import UTC, datetime
from typing import Any

from app.analysis import digest as digest_mod
from app.analysis import fallback, llm, simulate
from app.analysis import score as score_mod
from app.db import db

log = logging.getLogger(__name__)

analyses = db["analyses"]
analyses.create_index([("window", 1), ("period_key", 1)], unique=True)


def get_analysis(
    window: str, refresh: bool = False, now: datetime | None = None
) -> dict[str, Any]:
    if window not in digest_mod.WINDOWS:
        raise ValueError(f"unknown window {window!r}")
    now = now or datetime.now(UTC)
    pkey = digest_mod.period_key(window, now)  # type: ignore[arg-type]
    sim = simulate.active()

    if not refresh and not sim:
        cached = analyses.find_one({"window": window, "period_key": pkey})
        if cached:
            return _response(cached)

    digest = digest_mod.build(window, now)  # type: ignore[arg-type]
    if sim:
        simulate.inject(digest, sim)
    scored = score_mod.score_digest(digest)

    if not digest["devices"] and not digest["sensor_grid"]["count"]:
        narrative, source = _no_data(), "no-data"
    elif llm.available():
        try:
            narrative = llm.narrate(digest, scored, _previous_summary(window, pkey))
            source = "llm"
        except Exception:
            log.exception("LLM narration failed; using fallback")
            narrative, source = fallback.render(digest, scored), "fallback"
    else:
        narrative, source = fallback.render(digest, scored), "fallback"

    doc = {
        "window": window,
        "period_key": pkey,
        "generated_at": now.replace(tzinfo=None),  # stored naive like ingest.py
        "score": scored["score"],
        "score_trend": score_mod.score_trend(digest),
        "tone": scored["tone"],
        "findings": scored["findings"],
        "headline": narrative.headline,
        "summary": narrative.summary,
        "attention_items": [i.model_dump() for i in narrative.attention_items],
        "recommendations": narrative.recommendations,
        "source": source,
        "period": digest["period"],
        "digest": digest,
    }
    # While simulating, keep the cache clean — simulated analyses must not
    # persist past POST /api/simulate/reset.
    if not sim:
        analyses.replace_one({"window": window, "period_key": pkey}, doc, upsert=True)
    return _response(doc)


def _previous_summary(window: str, pkey: str) -> str | None:
    prev = analyses.find_one(
        {"window": window, "period_key": {"$ne": pkey}},
        {"summary": 1},
        sort=[("generated_at", -1)],
    )
    return prev["summary"] if prev else None


def _no_data():
    from app.analysis.models import Narrative

    return Narrative(
        headline="Waiting for sensor data",
        summary="We don't have sensor data for this house yet — "
        "check back once the sensors report in.",
        attention_items=[],
        recommendations=[],
    )


def _response(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "window": doc["window"],
        "period_key": doc["period_key"],
        "period": doc["period"],
        "generated_at": doc["generated_at"].isoformat(),
        "score": doc["score"],
        "score_trend": doc.get("score_trend", "stable"),
        "tone": doc["tone"],
        "headline": doc.get("headline") or doc["summary"].split(".")[0],
        "summary": doc["summary"],
        "attention_items": doc["attention_items"],
        "recommendations": doc["recommendations"],
        "findings": doc["findings"],
        "source": doc["source"],
    }
