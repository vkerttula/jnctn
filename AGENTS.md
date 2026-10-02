# AGENTS.md

Guidance for agents working on this repository. Read this first.

## Project context

**jnctn** is a weekend hackathon project. Speed of iteration matters, but keep the
codebase coherent — another agent or human may pick up where you left off at any
point. Leave the repo in a state you could hand over without explanation.

**Read `docs/VISION.md` first.** It is written for you, the agent — it states
what the product is, who it's for, and what the demo should prove. Treat it as
the north star: when a choice isn't specified anywhere else, pick the option
that serves the vision. If it's still a TODO, ask the human for the vision
before building features.

### Stack

- **Backend:** FastAPI (Python 3.12), package management with `uv`, pymongo
- **Frontend:** Vite + React 19 + TypeScript + Tailwind CSS v4, oxlint
- **Database:** MongoDB 8 sidecar, reachable at `mongodb://db:27017` inside the
  devcontainer (`MONGODB_URI` is preset) and `mongodb://localhost:27017` on the
  host (no auth in dev). mongo-express (browser CRUD UI) at
  `http://localhost:8081` on the host

### Current state

Dev scaffolding plus a minimal, verified app skeleton:

- `.devcontainer/` — devcontainer (Node 24 image + Python 3.12 feature) with
  MongoDB + mongo-express sidecars via docker-compose; the compose `command`
  auto-starts `scripts/dev.sh` (`overrideCommand: false` in devcontainer.json
  keeps the CLI from replacing it — don't remove it), and the app service runs
  as `node` so `.venv`/`node_modules` stay non-root; a `devin-data` named
  volume persists
  `~/.local/share/devin` (Devin CLI sessions) across rebuilds —
  `post-create.sh` fixes its ownership on fresh volumes and installs `uv`
- `backend/` — FastAPI app (`app/main.py`), `/api/health` and `/api/db-ping`
  routers plus `/api/notes` (GET/POST — the reference CRUD slice: pydantic
  validation, ObjectId handling, Mongo writes), pymongo client in `app/db.py`,
  pytest + ruff configured
- `frontend/` — Vite + React + TS + Tailwind v4 (vite plugin); `src/App.tsx`
  is a status page that exercises the UI → API → Mongo path and includes a
  working notes list (the pattern to copy for new features); the dev server
  proxies `/api` → `localhost:8000`
- `docs/` — `VISION.md` (the product vision, written for agents — see above),
  plus `topics/` and `ideas/` for hackathon brainstorming
- `Makefile` — devcontainer lifecycle helpers
- `.github/workflows/ci.yml` — backend (ruff + pytest against a real MongoDB
  service) and frontend (oxlint + build) on push/PR. No devcontainer build in
  CI — too slow for its value; `make rebuild` verifies locally

Keep this section and the commands below up to date as the structure grows.

## Environment

- **Everything runs inside the devcontainer — including you.** Run commands
  directly; don't reach for `docker`/`make` (host-side) or install tools —
  Node.js 24, Python 3.12, `uv`, pytest, ruff and npm are already here.
- Host-reachable URLs: UI `localhost:5173`, API `localhost:8000` (root →
  `/docs`), mongo-express `localhost:8081`, MongoDB `localhost:27017` on the
  host / `db:27017` inside.
- The Docker VM needs ~8 GB RAM / 4 CPUs — under that the OOM killer SIGKILLs
  the remote server / extension hosts and the IDE drops its connection.

## Commands

Host (container lifecycle — the only commands needed regularly):

```bash
make start    # build & start the devcontainer
make mongo    # open mongosh
make stop     # stop everything
make rebuild  # compose down + recreate; run after changing .devcontainer
```

Inside the devcontainer, dev servers start automatically (compose `command`
→ `scripts/dev.sh`, detached, logs to `/tmp/dev.log`). MongoDB and
mongo-express are always-on compose sidecars. To run servers in a foreground
terminal instead, stop them first, then:

```bash
pkill -f 'uvicorn app.main'; pkill -f 'node_modules/.bin/vite'
./scripts/dev.sh            # backend + frontend, Ctrl-C stops all
./scripts/dev.sh backend    # only FastAPI on :8000
./scripts/dev.sh frontend   # only Vite on :5173
```

Checks (run inside the devcontainer — these are not auto-started):

```bash
cd backend && uv run pytest && uv run ruff check .
cd frontend && npm run lint && npm run build
```

## Working rules

- **Verify before claiming done.** Run the relevant check (tests, lint, typecheck,
  or at minimum a smoke run) and look at the output before saying something works.
- **Don't commit secrets.** No `.env` files, API keys, or credentials. MongoDB in
  dev has no auth — don't add code that assumes any.
- **Keep diffs focused.** One logical change per commit; don't bundle unrelated
  cleanup into feature work.
- **Match existing conventions.** Look at neighboring files before introducing a
  new pattern, library, or framework. Check `package.json` / `pyproject.toml`
  before assuming a dependency exists.
- **Don't add dependencies casually.** Prefer libraries already in use. If a new
  one is needed, prefer versions published at least a week ago.
- **Documentation is always English.** Never write docs in Finnish, even when
  the conversation is in Finnish.
- **Mirror the user's language in chat.** Reply in Finnish or English,
  whichever the user is speaking.
- **Keep docs lean.** Update AGENTS.md and README.md in the same commit that
  changes behavior. Don't add new .md files when a section in an existing one
  covers it; delete stale docs rather than letting them rot — an outdated doc
  is worse than none.

## Commits

- **Conventional Commits** format: `type(scope): subject` — imperative mood,
  concise, no trailing period. Types: `feat`, `fix`, `docs`, `chore`,
  `refactor`, `test`. Scope when useful, e.g. `feat(backend): ...`,
  `fix(frontend): ...`, `chore(devcontainer): ...`.
- **No tool attribution in commits.** Never add "Generated with Devin",
  co-author trailers, or any other agent signature to commit messages.
- Commit message should explain **why**, not just what.
- Don't commit code you haven't verified at least minimally.
- **Commit directly to `main`** — hackathon speed, CI runs the checks. Before
  pushing, run both check suites (`uv run pytest` + `ruff check .`,
  `npm run lint` + `npm run build`).
- **Do not push or open PRs unless explicitly asked.**
- Do not amend history or force-push.
- If `git commit` fails with *Author identity unknown*, run
  `./scripts/git-identity.sh` (requires `gh auth login` first).
