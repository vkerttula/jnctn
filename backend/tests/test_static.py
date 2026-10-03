from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import SPAStaticFiles


def make_client(tmp_path):
    (tmp_path / "index.html").write_text("<html>spa</html>")
    (tmp_path / "asset.txt").write_text("hi")
    app = FastAPI()
    app.mount("/", SPAStaticFiles(directory=tmp_path, html=True))
    return TestClient(app)


def test_spa_fallback_serves_index(tmp_path):
    r = make_client(tmp_path).get("/sensors/roof-ne")
    assert r.status_code == 200
    assert "spa" in r.text


def test_spa_real_files_still_serve(tmp_path):
    r = make_client(tmp_path).get("/asset.txt")
    assert r.status_code == 200
    assert r.text == "hi"


def test_spa_api_paths_stay_404(tmp_path):
    r = make_client(tmp_path).get("/api/definitely-not-a-route")
    assert r.status_code == 404
