from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.analysis import digest as digest_mod
from app.analysis import fallback, llm, weather
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


def _wx_days(start: str, n: int, precip: float, rh: float):
    d0 = datetime.fromisoformat(start).date()
    return [
        {"date": (d0 + timedelta(days=i)).isoformat(), "precip_mm": precip,
         "temp_mean": 8.0, "temp_min": 4.0, "temp_max": 11.0, "rh_mean": rh,
         "wind_max_ms": 5.0}
        for i in range(n)
    ]


def test_weather_summarize_classifies_conditions():
    wet = weather.summarize(_wx_days("2026-09-26", 7, 4.0, 85))
    assert wet["condition"] == "wet"
    assert wet["rainy_days"] == 7 and wet["precip_mm"] == 28.0
    assert weather.summarize(_wx_days("2026-09-26", 7, 0.0, 70))["condition"] == "dry"
    assert weather.summarize(_wx_days("2026-09-26", 7, 0.0, 85))["condition"] == "mixed"
    assert weather.summarize([]) is None


def test_weather_block_buckets_and_baseline():
    days = _wx_days("2026-09-19", 15, 0.0, 70)  # Sat 19th .. Sat 3rd
    span_start, now = NOW - timedelta(days=7), NOW
    block = digest_mod._weather_block(days, "day", span_start, span_start - timedelta(days=7),
                                      now)
    assert block["location"] == "Vantaa"
    assert block["span"]["days"] == 8  # 26th .. 3rd, local dates incl. both ends
    assert block["baseline"]["days"] == 7  # 19th .. 25th, no overlap with span
    assert len(block["buckets"]) == 8
    weekly = digest_mod._weather_block(days, "week", span_start, None, now)
    assert [b["bucket"] for b in weekly["buckets"]] == ["2026-09-20", "2026-09-27"]
    assert digest_mod._weather_block([], "day", span_start, None, now) is None


def _rh_event(condition=None):
    ev = {"type": "RH_SUSTAINED_HIGH", "device": "x", "label": "roof",
          "duration_hours": 30, "peak_rh": 92, "ongoing": False}
    if condition:
        ev["outdoor_weather"] = {"condition": condition}
    return ev


def test_score_wet_weather_discounts_rh_without_ah_data():
    d = _healthy_digest()
    d["devices"][0]["span"] = {"indoor_ah_mean": 7.0, "outdoor_ah_mean": None}
    d["events"] = [_rh_event()]
    dry_r = score_mod.score_digest(d)  # no AH delta must not raise
    assert dry_r["findings"][0]["detail"]["weather_driven"] is False
    d["events"] = [_rh_event("wet")]
    wet_r = score_mod.score_digest(d)
    assert wet_r["findings"][0]["detail"]["weather_driven"] is True
    assert wet_r["score"] > dry_r["score"]


def test_score_wet_weather_does_not_excuse_a_wet_structure():
    d = _healthy_digest()
    d["devices"][0]["span"]["indoor_ah_mean"] = 9.0  # +1.8 over outdoor
    d["events"] = [_rh_event("wet")]
    r = score_mod.score_digest(d)
    assert r["findings"][0]["detail"]["weather_driven"] is False


def test_score_ah_inversion_weighs_more_in_dry_weather():
    def scored(condition):
        d = _healthy_digest()
        d["events"] = [{"type": "AH_INVERSION", "device": "x", "label": "the crawl space",
                        "indoor_ah": 9.0, "outdoor_ah": 7.2,
                        "outdoor_weather": {"condition": condition}}]
        return score_mod.score_digest(d)

    dry, mixed = scored("dry"), scored("mixed")
    assert dry["score"] < mixed["score"]
    assert dry["findings"][0]["detail"]["dry_weather"] is True
    assert "dry weather" in fallback.describe_finding(dry["findings"][0]).detail


def test_fallback_mentions_weather_for_weather_driven_rh():
    d = _healthy_digest()
    d["events"] = [_rh_event()]  # AH tracks outdoor air -> weather-driven
    finding = score_mod.score_digest(d)["findings"][0]
    assert "weather" in fallback.describe_finding(finding).detail


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
def seeded_device(monkeypatch):
    from app import catalog

    monkeypatch.setattr(catalog, "FAN_DEVICES", [*catalog.FAN_DEVICES, "test-device"])
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


def test_analysis_digest_endpoint(seeded_device, monkeypatch):
    calls = []

    def fake_history(start, end):
        calls.append((start, end))
        return _wx_days(start.isoformat(), (end - start).days + 1, 3.0, 88)

    monkeypatch.setattr(weather, "history", fake_history)
    r = client.get("/api/analysis/digest", params={"window": "week"})
    assert r.status_code == 200
    body = r.json()
    assert any(d["device"] == "test-device" for d in body["devices"])
    assert len(calls) == 1  # digest + events share one fetch
    assert body["weather"]["span"]["condition"] == "wet"
    assert body["weather"]["baseline"]["days"] == 7
    for ev in body["events"]:
        if ev["type"] in ("RH_SUSTAINED_HIGH", "AH_INVERSION"):
            assert ev["outdoor_weather"]["condition"] == "wet"


def test_digest_reads_only_catalog_sources():
    from app import catalog

    d = digest_mod.build_digest("day", weather_days=[])
    assert {x["device"] for x in d["devices"]} <= set(catalog.FAN_DEVICES)
    assert all(x["label"] == catalog.DEVICE_LABELS[x["device"]] for x in d["devices"])
    assert d["sensor_grid"]["count"] <= len(catalog.GRID)


def test_statuses_take_the_most_severe_finding():
    from app.routers import house

    findings = [
        {"code": "MOLD_INDEX_ELEVATED", "severity": "attention", "ref": "hallin-alapohja"},
        {"code": "RH_SUSTAINED_HIGH", "severity": "watch", "ref": "hallin-alapohja"},
        {"code": "FAN_STOPPED", "severity": "watch", "ref": "katto-3"},
        {"code": "FAN_STOPPED", "severity": "watch", "ref": "viherkatto-2"},  # not in catalog
    ]
    assert house._statuses(findings) == {"crawl-space": "alert", "roof-fan": "watch"}


def test_sensor_latest_is_one_source_not_an_average():
    from app import catalog

    if not db.sense_devices.find_one({"slug": catalog.ROOF_FAN}):
        pytest.skip("no ingested dataset")
    dev = db.sense_devices.find_one({"slug": catalog.ROOF_FAN})
    rpm = db.sense_fan_readings.find_one(
        {"device_id": dev["device_id"], "rpm": {"$ne": None}}, sort=[("ts", -1)]
    )["rpm"]
    house = client.get("/api/house").json()
    roof_fan = next(s for s in house["sensors"] if s["id"] == "roof-fan")
    assert roof_fan["latest"]["fan_rpm"] == round(rpm)
    detail = client.get("/api/sensors/roof-fan").json()
    assert detail["latest"] == roof_fan["latest"]


def test_digest_without_weather(seeded_device):
    # conftest keeps history offline; a range never cached yields no weather
    assert digest_mod.build_digest("day", NOW - timedelta(days=4000))["weather"] is None


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
    assert body["summary"] is None or isinstance(body["summary"], str)
    assert body["summary_source"] in ("llm", "fallback", "no-data")
    if body["normal"]:
        lo, hi = body["normal"]["rh_pct"]
        assert 0 <= lo < hi <= 100
        for b in body["normal"].get("bands", []):
            assert b["from"] < b["to"]
            assert 0 <= b["rh_pct"][0] < b["rh_pct"][1] <= 100
    for p in body["points"][:50]:
        assert {"t", "temp_c", "rh_pct", "mold_index"} <= set(p)

    r = client.get("/api/sensors/crawl-space/series", params={"range": "1y"})
    assert r.status_code == 200
    bands = (r.json()["normal"] or {}).get("bands")
    if bands:
        assert len(bands) > 1  # stepped seasonal ribbon across months

    r = client.get("/api/sensors/roof-nw/series", params={"range": "24h"})
    assert r.status_code == 200

    assert client.get("/api/sensors/nope").status_code == 404


def test_sensor_summary_fallback_and_cache(monkeypatch):
    from app.analysis import sensor_summary

    monkeypatch.setattr(sensor_summary.llm, "available", lambda: False)
    sensor = {"id": "test-sensor", "name": "Test", "kind": "fan", "zone": "ridge"}
    points = [
        {"t": "2026-10-03T10:00:00Z", "rh_pct": 88.0, "fan_rpm": 1200},
        {"t": "2026-10-03T11:00:00Z", "rh_pct": 95.0, "fan_rpm": 0},
    ]
    try:
        r = sensor_summary.get_summary(sensor, "24h", points, None)
        assert r["source"] == "fallback"
        assert r["summary"]
        stats = sensor_summary._stats(points)
        assert stats["rh_pct"]["delta"] == 7.0
        assert stats["fan_rpm"]["stopped_share"] == 0.5
        assert sensor_summary.get_summary(sensor, "24h", points, None) == r
    finally:
        db.sensor_summaries.delete_many({"sensor_id": "test-sensor"})


def test_stale_narration_version_is_regenerated(seeded_device):
    from app.analysis import sensor_summary, service

    first = client.get("/api/analysis", params={"window": "day", "refresh": True}).json()
    service.analyses.update_one(
        {"window": "day", "period_key": first["period_key"]},
        {"$set": {"version": llm.NARRATION_VERSION - 1, "summary": "stale words"}},
    )
    again = client.get("/api/analysis", params={"window": "day"}).json()
    assert again["summary"] != "stale words"

    sensor = {"id": "test-sensor", "name": "Test", "kind": "fan", "zone": "ridge"}
    points = [{"t": "2026-10-03T10:00:00Z", "rh_pct": 60.0, "fan_rpm": 1200}]
    sensor_summary.get_summary(sensor, "24h", points, None)
    sensor_summary.summaries.update_many(
        {"sensor_id": "test-sensor"}, {"$set": {"version": 0, "summary": "stale words"}}
    )
    assert sensor_summary.get_summary(sensor, "24h", points, None)["summary"] != "stale words"


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


def test_report(seeded_device):
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
