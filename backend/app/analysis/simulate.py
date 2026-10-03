"""Demo leak simulation.

POST /api/simulate/leak writes an `active` doc here; while it exists the
analysis pipeline injects a synthetic moisture event for the target sensor so
the score, tone and narrative react as if a real leak started — the "simulate
leak" demo moment. POST /api/simulate/reset clears it.

Only the analysis/narration layer reacts — raw readings are never modified.
"""

from datetime import UTC, datetime
from typing import Any

from app.db import db

sims = db["simulation"]


def active() -> dict[str, Any] | None:
    return sims.find_one({"_id": "active"})


def start(sensor_id: str, device: str | None, label: str) -> dict[str, Any]:
    doc = {
        "_id": "active",
        "sensor_id": sensor_id,
        "device": device,
        "label": label,
        "started_at": datetime.now(UTC).replace(tzinfo=None),
    }
    sims.replace_one({"_id": "active"}, doc, upsert=True)
    return doc


def stop() -> None:
    sims.delete_one({"_id": "active"})


def inject(digest: dict[str, Any], sim: dict[str, Any]) -> None:
    """Append a synthetic event describing the simulated leak."""
    label = sim.get("label") or "the house"
    started = sim["started_at"].replace(tzinfo=UTC)
    if sim.get("device"):
        digest["events"].append(
            {
                "type": "LEAK_SIMULATED",
                "device": sim["device"],
                "label": label,
                "start": started.isoformat(),
                "end": datetime.now(UTC).isoformat(),
                "ongoing": True,
                "peak_rh": 97.0,
                "detail": "humidity rising sharply — looks like a leak",
                "simulated": True,
            }
        )
    else:
        digest["events"].append(
            {
                "type": "SENSOR_LEAK_SIMULATED",
                "serial": sim["sensor_id"],
                "label": label,
                "start": started.isoformat(),
                "ongoing": True,
                "peak_rh": 98.0,
                "detail": "sensor reading climbing fast — looks like a leak",
                "simulated": True,
            }
        )
