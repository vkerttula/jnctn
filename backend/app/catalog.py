"""The demo house's logical sensors and the one physical source behind each.

The VILPE Sense site has 7 fans and 51 grid sensors; the demo house shows 7
devices. Each logical sensor reads exactly one physical source — no
averaging across devices — and the analysis only looks at these sources, so
the score, the narrative and the UI always talk about the same things.

Pure data (no DB imports): scripts/gen_mock_data.py imports it too, so mock
fixtures are backed by the same sources as the live API.
"""

ROOF_FAN = "katto-3"
CRAWL = "hallin-alapohja"

# Readings a fan source exposes -> its field in sense_fan_readings.
FAN_FIELDS = {
    "temp_c": "indoor.temp_c",
    "rh_pct": "indoor.rh_pct",
    "fan_rpm": "rpm",
    "mold_index": "mold_index",
}

# Display order. Grid picks are the sensor nearest each roof quadrant's
# centre (by layout coordinates) whose humidity sits near the quadrant median.
SENSORS = [
    {"id": "roof-sw", "name": "South-west roof", "kind": "leak_sensor", "zone": "roof_south",
     "grid": {"sensor_id": 18877, "serial": "P672786W5BZ"}},
    {"id": "roof-se", "name": "South-east roof", "kind": "leak_sensor", "zone": "roof_south",
     "grid": {"sensor_id": 18945, "serial": "P686956XTAM"}},
    {"id": "roof-nw", "name": "North-west roof", "kind": "leak_sensor", "zone": "roof_north",
     "grid": {"sensor_id": 18965, "serial": "P672830B96G"}},
    {"id": "roof-ne", "name": "North-east roof", "kind": "leak_sensor", "zone": "roof_north",
     "grid": {"sensor_id": 18790, "serial": "P655155KDRK"}},
    {"id": "roof-fan", "name": "Roof fan", "kind": "fan", "zone": "ridge",
     "fan": ROOF_FAN, "fields": ("temp_c", "rh_pct", "fan_rpm", "mold_index")},
    {"id": "crawl-space", "name": "Crawl space", "kind": "climate_sensor", "zone": "crawl_space",
     "fan": CRAWL, "fields": ("temp_c", "rh_pct", "mold_index"), "works_with": "crawl-fan"},
    {"id": "crawl-fan", "name": "Crawl space fan", "kind": "fan", "zone": "crawl_space",
     "fan": CRAWL, "fields": ("fan_rpm",), "works_with": "crawl-space"},
]

BY_ID = {s["id"]: s for s in SENSORS}

# Physical sources the analysis reads.
FAN_DEVICES = [ROOF_FAN, CRAWL]
GRID = {s["grid"]["serial"]: s for s in SENSORS if "grid" in s}
GRID_IDS = [s["grid"]["sensor_id"] for s in GRID.values()]

# How findings and the narrator name each source — the UI's own names.
DEVICE_LABELS = {ROOF_FAN: "the roof", CRAWL: "the crawl space"}


def grid_label(serial: str) -> str:
    s = GRID.get(serial)
    return f"the {s['name'].lower()}" if s else serial
