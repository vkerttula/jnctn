import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.routers import analysis, dataset, health, house, notes, stats

load_dotenv()

app = FastAPI(title="jnctn")

# Comma-separated origins; the Vite dev proxy doesn't need CORS, this is for
# deployments where the frontend lives on another origin.
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Public-demo gate: when DEMO_KEY is set, every /api/* route requires the
# X-Demo-Key header (the frontend sends it after the login-page access code).
# Bots hitting the API directly get 401 before touching Mongo or the LLM.
# /api/health stays open — Render's healthCheckPath needs it. Unset = open,
# which keeps local dev unchanged.
DEMO_KEY = os.getenv("DEMO_KEY")


@app.middleware("http")
async def demo_key_gate(request: Request, call_next):
    if (
        DEMO_KEY
        and request.url.path.startswith("/api/")
        and request.url.path != "/api/health"
    ):
        if request.headers.get("x-demo-key") != DEMO_KEY:
            return JSONResponse({"detail": "demo key required"}, status_code=401)
    return await call_next(request)


app.include_router(health.router, prefix="/api")
app.include_router(notes.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(dataset.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")
app.include_router(house.router, prefix="/api")


# In the deploy image the built frontend is served from the same origin, so
# there's no CORS and no separate static host. In dev the dist dir only exists
# after `npm run build`; until then keep redirecting / to the API docs.
STATIC_DIR = Path(
    os.getenv("STATIC_DIR", str(Path(__file__).resolve().parents[2] / "frontend" / "dist"))
)

if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
else:

    @app.get("/", include_in_schema=False)
    def index() -> RedirectResponse:
        return RedirectResponse("/docs")
