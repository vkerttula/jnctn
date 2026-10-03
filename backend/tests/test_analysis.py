from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.analysis import digest as digest_mod
from app.analysis import fallback, llm
from app.analysis import score as score_mod
from app.db import db
from app.main import app

client = TestClient(app)

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)


def _points(start: datetime, hours: list[float], value: float):
    return [(start + timedelta(hours=h), value) for h in hours]


def _healthy_digest():
    return {
        "window": "day",
        "events": [],
        "devices": [{"device": "x", "span": {"indoor_ah_mean": 7, "outdoor_ah_mean": 7.2}}],
        "sensor_grid": {"span": {"pct_sensors_mean_rh_ge_90": 0}},
    }


def test_sustained_runs_detects_long_episode():
    pts = _points(NOW, range(0, 30), 90.0)
    runs = digest_mod._sustained_runs(pts, 85.0, timedelta(hours=24))
    assert len(runs) == 1
    assert runs[0]["peak"] == 90.0


def test_sustained_runs_ignores_short_spike_and_splits_on_gap():
    pts = _points(NOW, range(0, 5), 90.0)  # 5h — too short
    assert digest_mod._sustained_runs(pts, 85.0, timedelta(hours=24)) == []

    # two 24h+ runs separated by a >12h gap stay separate
    pts = _points(NOW, range(0, 26), 90.0) + _points(NOW, range(60, 90), 90.0)
    assert len(digest_mod._sustained_runs(pts, 85.0, timedelta(hours=24))) == 2


def test_score_healthy_digest():
    r = score_mod.score_digest(_healthy_digest())
    assert r["score"] >= 80
    assert r["tone"] == "all_good"
    assert r["findings"] == []


def test_score_drops_with_mold_event():
    d = _healthy_digest()
    d["events"] = [
        {
            "type": "MOLD_INDEX_ELEVATED",
            "device": "hallin-alapohja",
            "label": "the crawl space",
            "ongoing": True,
            "peak": 0.83,
        }
    ]
    r = score_mod.score_digest(d)
    assert r["score"] < 80
    assert r["findings"][0]["code"] == "MOLD_INDEX_ELEVATED"
    assert r["findings"][0]["location"] == "the crawl space"


def test_score_weather_tracking_rh_is_cheap():
    d = _healthy_digest()
    d["events"] = [
        {
            "type": "RH_SUSTAINED_HIGH",
            "device": "x",
            "label": "roof",
            "duration_hours": 30,
            "peak_rh": 92,
            "ongoing": False,
        }
    ]
    humid = score_mod.score_digest(d)["score"]
    # same event but the structure is wetter than outdoors -> full weight
    d["devices"][0]["span"]["indoor_ah_mean"] = 9.0
    wetter = score_mod.score_digest(d)["score"]
    assert humid > wetter


def test_fallback_all_good():
    scored = score_mod.score_digest(_healthy_digest())
    n = fallback.render(_healthy_digest(), scored)
    assert "everything is looking good" in n.summary.lower()


def test_fallback_attention_names_location():
    d = _healthy_digest()
    d["events"] = [
        {
            "type": "MOLD_INDEX_ELEVATED",
            "device": "hallin-alapohja",
            "label": "the crawl space",
            "ongoing": True,
            "peak": 0.9,
        }
    ]
    n = fallback.render(d, score_mod.score_digest(d))
    assert "crawl space" in n.summary
    assert any("crawl space" in i.title for i in n.attention_items)


def test_llm_unavailable_without_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    assert not llm.available()


@pytest.fixture()
def seeded_device():
    db.sense_devices.insert_one(
        {
            "device_id": 999999,
            "serial_number": "TESTSERIAL",
            "slug": "test-device",
            "is_online": True,
        }
    )
    docs = [
        {
            "device_id": 999999,
            "device": "test-device",
            "serial_number": "TESTSERIAL",
            "ts": datetime.now(UTC) - timedelta(hours=h),
            "indoor": {"rh_pct": 60.0, "temp_c": 15.0, "abs_humidity_g_m3": 7.5},
            "outdoor": {"rh_pct": 70.0, "temp_c": 10.0, "abs_humidity_g_m3": 7.0},
            "rpm": 1200,
        }
        for h in range(12)
    ]
    db.sense_fan_readings.insert_many(docs)
    yield
    db.sense_devices.delete_one({"device_id": 999999})
    db.sense_fan_readings.delete_many({"device_id": 999999})


def test_analysis_endpoint_and_cache(seeded_device):
    r = client.get("/api/analysis", params={"window": "day", "refresh": True})
    assert r.status_code == 200
    body = r.json()
    assert body["window"] == "day"
    assert 0 <= body["score"] <= 100
    assert body["tone"] in ("all_good", "watch", "attention")
    assert body["source"] in ("fallback", "llm")
    assert isinstance(body["attention_items"], list)

    # Mongo stores ms precision — compare to the second to prove the cache hit
    cached = client.get("/api/analysis", params={"window": "day"}).json()
    assert cached["generated_at"][:19] == body["generated_at"][:19]


def test_analysis_digest_endpoint(seeded_device):
    r = client.get("/api/analysis/digest", params={"window": "week"})
    assert r.status_code == 200
    assert any(d["device"] == "test-device" for d in r.json()["devices"])


def test_analysis_rejects_bad_window():
    assert client.get("/api/analysis", params={"window": "decade"}).status_code == 422


def test_house_contract():
    r = client.get("/api/house")
    assert r.status_code == 200
    body = r.json()
    assert 0 <= body["score"] <= 100
    assert body["score_word"] in ("Good", "Fair", "Attention")
    assert body["score_trend"] in ("improving", "stable", "declining")
    assert {"address", "city"} <= set(body["home"])
    assert isinstance(body["headline"], str) and body["headline"]
    assert isinstance(body["summary"], str) and body["summary"]
    assert body["simulating"] is False
    assert {"temp_c", "condition", "humidity_pct", "wind_ms", "location"} <= set(
        body["weather"]
    )
    assert len(body["sensors"]) == 7
    for s in body["sensors"]:
        assert {"id", "name", "kind", "zone", "status", "latest", "last_reading_at",
                "state_label"} <= set(s)
        assert s["kind"] in ("leak_sensor", "fan", "climate_sensor")
        assert s["zone"] in ("roof_south", "roof_north", "ridge", "crawl_space")
        assert s["status"] in ("ok", "watch", "alert")
    assert {a["id"] for a in body["areas"]} == {"roof", "crawl_space"}
    for a in body["areas"]:
        assert a["status"] in ("ok", "watch", "alert")
    assert isinstance(body["open_requests"], list)
    for a in body["attention"]:
        assert {"sensor_id", "severity", "message", "since", "actions"} <= set(a)
        assert a["severity"] in ("watch", "alert")


def test_sensor_detail_and_series():
    r = client.get("/api/sensors/crawl-fan")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "crawl-fan"
    assert body["kind"] == "fan"
    assert {"temp_c", "rh_pct", "mold_index", "fan_rpm"} <= set(body["latest"])

    r = client.get("/api/sensors/crawl-space/series", params={"range": "7d"})
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "crawl-space"
    assert "normal" in body
    if body["normal"]:
        lo, hi = body["normal"]["rh_pct"]
        assert 0 <= lo < hi <= 100
    for p in body["points"][:50]:
        assert {"t", "temp_c", "rh_pct", "mold_index"} <= set(p)

    r = client.get("/api/sensors/roof-nw/series", params={"range": "24h"})
    assert r.status_code == 200

    assert client.get("/api/sensors/nope").status_code == 404


def test_help_request():
    try:
        r = client.post(
            "/api/help-requests", json={"kind": "expert", "sensor_id": "crawl-space"}
        )
        assert r.status_code == 200
        assert r.json()["message"]
        assert client.post("/api/help-requests", json={"kind": "nope"}).status_code == 422
        open_reqs = client.get("/api/house").json()["open_requests"]
        assert any(r["kind"] == "expert" and r["status_text"] for r in open_reqs)
    finally:
        db.help_requests.delete_many({})


def test_report():
    r = client.get("/api/report")
    assert r.status_code == 200
    body = r.json()
    assert {"id", "issued", "period", "headline", "summary", "months",
            "structures", "measurements", "mold_threshold"} <= set(body)
    assert {"from", "to"} <= set(body["period"])
    for s in body["structures"]:
        assert {"name", "avg_rh_pct", "peak_mold_index", "coverage_pct",
                "status"} <= set(s)


def test_simulate_leak_flow():
    r = client.post("/api/simulate/leak", json={"sensor_id": "roof-nw"})
    assert r.status_code == 200
    assert r.json()["simulating"] is True

    house = client.get("/api/house").json()
    assert house["simulating"] is True
    sim_sensor = next(s for s in house["sensors"] if s["id"] == "roof-nw")
    assert sim_sensor["status"] in ("watch", "alert")
    assert any("roof-nw" == a["sensor_id"] for a in house["attention"])

    r = client.post("/api/simulate/reset")
    assert r.status_code == 200
    assert client.get("/api/house").json()["simulating"] is False
