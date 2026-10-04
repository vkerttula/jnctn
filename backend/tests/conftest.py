import pytest


@pytest.fixture(autouse=True)
def _offline_weather_history(monkeypatch):
    """Keep the suite off the network: analyses run without weather history
    unless a test stubs `weather.history` itself."""
    monkeypatch.setattr("app.analysis.weather._fetch_history", lambda start, end: None)
