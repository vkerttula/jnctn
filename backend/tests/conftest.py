import pytest

from app.db import db


@pytest.fixture(autouse=True)
def _offline_weather_history(monkeypatch):
    """Keep the suite off the network: analyses run without weather history
    unless a test stubs `weather.history` itself."""
    monkeypatch.setattr("app.analysis.weather._fetch_history", lambda start, end: None)


@pytest.fixture(autouse=True)
def _isolated_narration(monkeypatch):
    """Tests share the dev database: never spend the Gemini quota, and never
    leave test-seeded analyses or sensor summaries in the caches the app
    serves."""
    from app.analysis import llm, sensor_summary, service

    monkeypatch.setattr(llm, "available", lambda: False)
    monkeypatch.setattr(service, "analyses", db["test_analyses"])
    monkeypatch.setattr(sensor_summary, "summaries", db["test_sensor_summaries"])
    yield
    db["test_analyses"].drop()
    db["test_sensor_summaries"].drop()
