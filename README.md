# jnctn

*no time for vowels — see [HCKTN.md](HCKTN.md)*

[![CI](https://github.com/vkerttula/jnctn/actions/workflows/ci.yml/badge.svg)](https://github.com/vkerttula/jnctn/actions/workflows/ci.yml)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm--NC-blue)](LICENSE)

Weekend hackathon project: **"Oura for a house."** A consumer app that turns
VILPE Sense humidity & temperature data into things a homeowner understands —
one 0–100 score, a plain-language summary, attention items, and a rotatable
3D house with clickable sensors. See `docs/VISION.md` for the why and
`docs/specs/` for the design contract.

## Stack

- **Backend** (`backend/`): FastAPI on Python 3.12, managed with `uv`;
  pymongo client against `MONGODB_URI`; serves `/api/*` on port 8000.
  `app/analysis/` is the interpretation layer: it digests the `sense_*`
  Mongo collections into a context packet, scores it deterministically
  (0–100 + findings) and narrates it via Gemini (`GEMINI_API_KEY` —
  deterministic template fallback without a key), cached per period.
  `uv run python -m app.ingest` populates Mongo from the live VILPE Sense
  API plus the bundled sensor CSV (`data/`).
- **Frontend** (`frontend/`): Vite + React 19 + TypeScript + Tailwind CSS v4,
  linted with oxlint; react-router, react-three-fiber (the 3D house) and
  recharts. **Mock-first**: `VITE_API_MODE=mock` (the default) serves
  `public/mock/*.json` fixtures — no backend needed; `live` calls the real
  `/api` contract through the dev proxy on port 5173. Regenerate fixtures
  with `python scripts/gen_mock_data.py`.
- **Database**: MongoDB 8 sidecar — `mongodb://db:27017` inside the
  devcontainer (`MONGODB_URI` is preset), `mongodb://localhost:27017` on the
  host; no auth in dev. mongo-express provides a browser UI with full CRUD
  at `http://localhost:8081`.

## Quickstart

After `make rebuild` (see below), the dev servers start automatically with the
container — the compose `command` runs `scripts/dev.sh` detached, logging to
`/tmp/dev.log`. On the host:

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

Inside the app: `/` is the 3D house + score + attention feed, `/sensors` and
`/sensors/:id` list devices and per-sensor trend charts, `/report` is a
printable moisture-history report (PDF via browser print), `/data` explores
the raw ingested dataset, `/status` exercises the stack end to end.

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
  every `/api/*` call requires it as the `X-Demo-Key` header — the frontend
  sends it after the login-page access code. `/api/health` stays open for
  deploy health checks.
- `frontend/.env` — `VITE_API_MODE` (`mock` default, `live` for the real
  API; a signed-in preset user's `dataMode` overrides it),
  `VITE_API_URL` (only when serving the frontend without the dev proxy).

The access code is a casual-traffic gate, not a secret — it ships in the
frontend bundle. It keeps bots and random traffic off a public demo.

## Development environment

The devcontainer (`.devcontainer/`) provides Node.js, Python 3.12 and MongoDB.
With Docker and the devcontainer CLI (`npm i -g @devcontainers/cli`) installed:

```bash
make start    # build & start the devcontainer
make mongo    # open mongosh
make stop     # stop everything
make rebuild  # rebuild after changing .devcontainer
```

### New developer onboarding

1. On the host: Docker + `npm i -g @devcontainers/cli`, clone the repo.
2. `make start` — post-create installs `uv`, dev servers auto-start; open
   http://localhost:5173. That's all — development needs nothing else.
3. For live mode: `cd backend && uv run python -m app.ingest` once, and add
   `GEMINI_API_KEY` to `backend/.env` if you want LLM narration.
4. To commit/push from inside the container: `gh auth login` once, then
   `./scripts/git-identity.sh` — it sets a repo-local git identity (GitHub
   noreply email) and wires gh as the credential helper. Both survive
   rebuilds via the gh-data volume and the workspace mount.

MongoDB runs in a sidecar container on the same compose network. From VS Code,
use "Dev Containers: Reopen in Container" instead of the Makefile.

The Docker VM needs **~8 GB of RAM and 4 CPUs** (half of the M1 Pro's 16 GB is a
good fit) — the remote server and extension hosts alone use ~1.5 GB, and a
starved VM causes OOM kills and dropped IDE connections. Resize it per runtime:

```bash
colima stop && colima start --cpu 4 --memory 8   # colima/lima
# Docker Desktop: Settings → Resources → Memory → 8 GB
# OrbStack: Settings → System → Memory → 8 GB
```

Verify with `docker info | grep -i "total memory"` on the host, or `free -h`
inside the container.

## Deploy

Quick demo without deploying anything:
`cloudflared tunnel --url http://localhost:5173` — the Vite proxy serves the
whole stack behind that one public URL (works only while the container runs).

Real deploy (~30 min, free tiers): a single Docker image serves everything —
the root `Dockerfile` builds the frontend, then FastAPI serves `dist/` and
`/api/*` from the same origin (one service, one URL, no CORS). The database
is MongoDB Atlas.

1. **MongoDB Atlas**: create an M0 (free) cluster and a database user, allow
   connections from `0.0.0.0/0` (Render's outbound IPs are dynamic), copy the
   `mongodb+srv://…` connection string.
2. **Render**: New → Blueprint → this repo. `render.yaml` provisions a free
   Docker web service (Frankfurt) and prompts for `MONGODB_URI` and
   `DEMO_KEY` — paste the Atlas string, and set `DEMO_KEY` to the login
   access code (`sense-demo` in `frontend/src/auth.ts`) to gate the API.
3. Done — the app is live at `https://<name>.onrender.com` and every push to
   `main` rebuilds and redeploys it. For live mode, run the ingest once
   against the Atlas URI: `MONGODB_URI=<atlas> uv run python -m app.ingest`.

Notes: the free plan sleeps after ~15 min idle (first hit takes ~30 s) —
ping it before demoing, or upgrade to keep it warm. To gate deploys on green
CI, turn off Render's auto-deploy and call the service's deploy hook from a
CI step instead.

## License

PolyForm Noncommercial 1.0.0 — free to use, modify and share for
noncommercial purposes; commercial use requires permission. See `LICENSE`.
