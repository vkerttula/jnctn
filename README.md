# jnctn

Weekend hackathon project. Currently a working scaffold: a FastAPI backend,
a Vite + React frontend, and a MongoDB database, all running inside a
devcontainer. See `docs/VISION.md` for what it's meant to become (TODO).

## Stack

- **Backend** (`backend/`): FastAPI on Python 3.12, managed with `uv`;
  pymongo client against `MONGODB_URI`; serves `/api/*` on port 8000
- **Frontend** (`frontend/`): Vite + React 19 + TypeScript + Tailwind CSS v4,
  linted with oxlint; dev server on port 5173 proxies `/api` to the backend
- **Database**: MongoDB 8 sidecar — `mongodb://db:27017` inside the
  devcontainer (`MONGODB_URI` is preset), `mongodb://localhost:27017` on the
  host; no auth in dev. mongo-express provides a browser UI with full CRUD
  at `http://localhost:8081`

## Quickstart

After `make rebuild` (see below), the dev servers start automatically with the
container — the compose `command` runs `scripts/dev.sh` detached, logging to
`/tmp/dev.log`. On the host:

- http://localhost:5173 — status page; exercises browser → Vite proxy →
  FastAPI → MongoDB end to end
- http://localhost:8000 — API root, redirects to `/docs` (Swagger UI)
- http://localhost:8081 — mongo-express, browser CRUD for the database
- `mongodb://localhost:27017` — for mongosh / Compass

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
3. To commit/push from inside the container: `gh auth login` once, then
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

Real deploy (~30 min, free tiers):

- **Backend**: `backend/Dockerfile` → Render / Fly.io / Koyeb; set
  `MONGODB_URI`, `MONGODB_DB` and `CORS_ORIGINS` env vars
- **Frontend**: `npm run build` → static `dist/` → Cloudflare Pages / Vercel /
  GitHub Pages, with `VITE_API_URL` set to the backend URL
- **Database**: MongoDB Atlas M0 (free)

## License

PolyForm Noncommercial 1.0.0 — free to use, modify and share for
noncommercial purposes; commercial use requires permission. See `LICENSE`.
