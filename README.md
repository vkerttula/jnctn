# jnctn

*no time for vowels*

[![CI](https://github.com/vkerttula/jnctn/actions/workflows/ci.yml/badge.svg)](https://github.com/vkerttula/jnctn/actions/workflows/ci.yml)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm--NC-blue)](LICENSE)

**"Oura for a house."** VILPE Sense hardware measures humidity and
temperature inside building structures — but measuring isn't understanding.
jnctn is the interpretation layer: raw sensor series in; a deterministic
0–100 condition score, LLM-written plain-language summaries, attention
items and a printable moisture report out.

<img width="720" height="405" alt="jnctn demo" src="https://github.com/user-attachments/assets/53d9277d-e4b8-48ce-8ad3-e4afaeab80a8" />

> **Concept project, built in under 24 hours** at the Junction X Vaasa
> 2026 hackathon by Valtteri Kerttula and Lauri Alanen. Archived — kept as
> a reference, not maintained, no live deployment.

Further reading: `docs/VISION.md` (the product), `docs/specs/` (design
specs), `docs/architecture/` (how the analysis actually works). The
hackathon's challenge-topic notes (`docs/topics/`) were removed on archiving.

## The pipeline

Interpretation is a staged pipeline over MongoDB. The `sense_*` collections
hold a real demo site — 51 RHT-2 sensors and 7 MCU-2 fans (Vantaa) — plus
CSV history from `data/`:

```
ingest    idempotent upserts, unique on (device, ts) — safe to re-run
digest    per-window context packet: stats + detected events, never raw
          series — context size stays flat as history grows
score     deterministic 0–100 + findings, computed in code — the LLM can
          narrate but never picks the number
narrate   an LLM (Gemini) summarizes the packet into consumer copy —
          headline, recommendations, attention feed — as structured JSON,
          validated before serving | template fallback, identical shape
cache     results per (window, period) — a ~20 req/day Gemini free tier
          survives a full demo day
```

Around that core:

- **Physical → logical.** The raw site maps to the 7 devices a homeowner
  recognizes (`backend/app/catalog.py`). Each one reads exactly one
  physical source, with no averaging: four grid sensors for the roof, one
  roof fan, and the underfloor package split into a crawl-space sensor and
  a drying fan. The analysis reads only these sources, so the score, the
  narrative and the UI always talk about the same devices.
- **Weather context.** Daily Open-Meteo history for the sensor site
  (Vantaa) goes into the digest. It discounts RH episodes that only
  followed a wet spell, weighs up structures that stay damp in dry
  weather, and gives the narrator "after a rainy week" context. The
  sidebar shows current Open-Meteo conditions for the demo home (Vaasa),
  cached 30 min, with the fans' own outdoor transmitters as fallback.
- **`POST /api/simulate/leak`.** Injects a synthetic moisture event the
  whole pipeline — digest, score, narrative, UI — reacts to. The demo
  moment is real data flow, not a scripted overlay.
- **Per-sensor AI summaries.** The same narrate-or-fallback path runs over
  each chart's own hourly buckets and writes the "AI insight" line on
  sensor detail pages, cached per (sensor, range, period).

## Frontend

Built contract-first: `frontend/src/api/types.ts` is the contract the
backend implements, and `VITE_API_MODE` picks the data source — `mock`
(the default) serves generated fixtures, so the entire UI runs with no
backend at all; `live` calls `/api/*` through the dev proxy. Fixtures
aren't hand-written: `scripts/gen_mock_data.py` shapes real Sense series
into the contract, including a client-side leak simulation.

react-three-fiber renders the rotatable house with status dots and pinned
callout cards; recharts draws the trends. The report is print-styled to a
single A4 page — `print-color-adjust: exact` keeps status colors and navy
surfaces in the exported PDF.

## Deliberate cuts — what's not built

Under 24 hours meant scoping hard; these are known gaps, not bugs:

- **No real auth or multi-tenancy.** Sign-in is three preset users plus
  localStorage, and the access code ships in the JS bundle. Real accounts,
  `POST /api/houses` and session auth were designed (the onboarding spec
  shapes `HouseProfile` as the request body) but not implemented.
- **No onboarding flow.** `docs/specs/2026-10-03-onboarding-design.md`
  specs address lookup → house profile → dragging sensors onto the 3D
  model; the demo house is hardcoded fixtures instead.
- **Sensors aren't live.** Fans and weather stream from the live Sense
  API and Open-Meteo, but the 51 RHT sensors come from a one-year CSV
  snapshot ending 2026-09-11 — ingest doesn't tail a live feed.
- **No alerting.** Analysis is computed on request and cached — there's
  no scheduler recomputing it and no push or email when the score moves.
- **Help requests go nowhere.** `POST /api/help-requests` persists the
  "book an inspection" intent to Mongo; nothing consumes it. The
  marketplace, remote expert review and sellable certified report are
  business-model ammo in `VISION.md`, deliberately out of scope.
- **Web only, no frontend tests.** Desktop web is the demo surface; CI
  lints and builds the frontend, but only the backend has a pytest suite.

## Stack

- **Backend** (`backend/`): FastAPI on Python 3.12, managed with `uv`;
  pymongo client against `MONGODB_URI`; serves `/api/*` on port 8000
- **Frontend** (`frontend/`): Vite + React 19 + TypeScript + Tailwind CSS
  v4, linted with oxlint; dev server on port 5173 proxies `/api` → :8000
- **Database**: MongoDB 8 sidecar — `mongodb://db:27017` inside the
  devcontainer (`MONGODB_URI` is preset), `mongodb://localhost:27017` on
  the host; no auth in dev. mongo-express provides a browser UI with full
  CRUD at `http://localhost:8081`

## Try it

The quickest way: the frontend's default mock mode runs the whole UI from
generated fixtures — no backend, database or Docker needed (Node.js 24):

```bash
cd frontend && npm install && npm run dev
```

Open http://localhost:5173, enter the access code `sense-demo` and sign in
as **Demo Family**. The sidebar's *Simulate leak* triggers the demo moment.

## Quickstart (full stack)

After `make rebuild` (see below), the dev servers start automatically with
the container — the compose `command` runs `scripts/dev.sh` detached,
logging to `/tmp/dev.log`. On the host:

- http://localhost:5173 — the app. The login page asks for the demo access
  code (`sense-demo`), then a preset user picks the data mode:
  - **Demo Family** — mock fixtures; the sidebar's *Simulate leak* /
    *Reset demo* controls drive the demo moment
  - **Matti Virtanen** — live mode; real Sense data through the backend
    (requires `uv run python -m app.ingest` to have populated Mongo)
  - **Facility Ops** — enterprise demo: a data-center site view
  - `/status` and `/data` stay open while signed out — they're dev pages
- http://localhost:8000 — API root, redirects to `/docs` (Swagger UI)
- http://localhost:8081 — mongo-express, browser CRUD for the database
- `mongodb://localhost:27017` — for mongosh / Compass

Inside the app: `/` is the 3D house + score + attention feed, `/sensors`
and `/sensors/:id` list devices and per-sensor trend charts, `/report` is
the printable moisture-history report, `/data` explores the raw ingested
dataset, `/status` exercises the stack end to end.

To run servers in a foreground terminal inside the container (live logs,
Ctrl-C to stop):

```bash
pkill -f 'uvicorn app.main'; pkill -f 'node_modules/.bin/vite'
./scripts/dev.sh            # backend + frontend
./scripts/dev.sh backend    # only FastAPI on :8000
./scripts/dev.sh frontend   # only Vite on :5173, proxies /api → :8000
```

Checks (inside the devcontainer):

```bash
cd backend && uv run pytest && uv run ruff check .
cd frontend && npm run lint && npm run build
```

## Configuration

Copy each `.env.example` to `.env` in the same directory to override:

- `backend/.env` — `MONGODB_URI`, `MONGODB_DB`, `CORS_ORIGINS`,
  `GEMINI_API_KEY`/`GEMINI_MODEL` (optional; analysis falls back to
  deterministic templates without a key). `DEMO_KEY` (optional): when set,
  every `/api/*` call requires it as the `X-Demo-Key` header — the
  frontend sends it after the login-page access code. `/api/health` stays
  open for deploy health checks.
- `frontend/.env` — `VITE_API_MODE` (`mock` default, `live` for the real
  API; a signed-in preset user's `dataMode` overrides it), `VITE_API_URL`
  (only when serving the frontend without the dev proxy).

The access code was a casual-traffic gate for the hosted demo, not a
secret — it ships in the frontend bundle.

## Development environment

The devcontainer (`.devcontainer/`) provides Node.js, Python 3.12 and
MongoDB. With Docker and the devcontainer CLI (`npm i -g
@devcontainers/cli`) installed:

```bash
make start    # build & start the devcontainer
make mongo    # open mongosh
make stop     # stop everything
make rebuild  # rebuild after changing .devcontainer
```

For live mode, run `cd backend && uv run python -m app.ingest` once to
populate MongoDB, and add `GEMINI_API_KEY` to `backend/.env` if you want
LLM narration. From VS Code, "Dev Containers: Reopen in Container" works
instead of the Makefile. Give the Docker VM ~8 GB of RAM and 4 CPUs — less
causes OOM kills inside the container.

## License

Copyright 2026 Valtteri Kerttula and Lauri Alanen. PolyForm Noncommercial
1.0.0 — free to use, modify and share for noncommercial purposes;
commercial use requires permission. See `LICENSE`.
