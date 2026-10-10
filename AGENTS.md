# AGENTS.md

Guidance for agents working on this repository. Read this first.

## Project context

**jnctn** is a hackathon project built in under 24 hours. Speed of iteration
matters, but keep the codebase coherent — another agent or human may pick up
where you left off at any point. Leave the repo in a state you could hand over
without explanation.

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
- `backend/` — FastAPI app (`app/main.py`), `/api/health` + `/api/db-ping`,
  `/api/notes` (GET/POST — the reference CRUD slice: pydantic validation,
  ObjectId handling, Mongo writes), and `/api/stats` (GET aggregates counts;
  POST `/api/stats/track` records a page view in the `page_views`
  collection), and `/api/dataset` (GET summary + downsampled fan/sensor
  readings served from the `sense_*` Mongo collections — 404s until
  `uv run python -m app.ingest` has run; `app/ingest.py` pulls the live
  VILPE Sense API plus `data/readings/sensors.csv` and upserts
  idempotently), pymongo client in `app/db.py`, pytest + ruff configured.
  `app/analysis/` is the interpretation layer: `digest.py` aggregates the
  `sense_*` collections into a compact context packet per window
  (day/week/month/year — stats + detected events, never raw series),
  `score.py` turns it into a 0-100 score + findings (deterministic — the
  LLM never picks the number), `llm.py` narrates it via Gemini
  (`GEMINI_API_KEY`/`GEMINI_MODEL` in `.env`, structured JSON out), and
  `fallback.py` renders the same shape from templates when no key/call
  works. `service.py` caches results in `analyses` per (window, period).
  `simulate.py` backs the demo leak moment: `POST /api/simulate/leak`
  injects a synthetic moisture event the whole pipeline reacts to.
  `app/routers/house.py` implements the frontend contract
  (`frontend/src/api/types.ts`): `/api/house`, `/api/sensors/{id}`,
  `/api/sensors/{id}/series`, `/api/help-requests`, `/api/report`,
  `/api/simulate/*`. `app/catalog.py` is the single source of truth for
  the 7 logical sensors. Each reads exactly **one** physical source, with
  no averaging: 4 grid sensors for the roof, `katto-3` for `roof-fan`, and
  `hallin-alapohja` split into `crawl-space` + `crawl-fan`. The digest
  reads only these sources and labels them with the UI's names, and
  `scripts/gen_mock_data.py` imports the catalog too. Mock is an all-good
  house, so its `MOCK_SOURCES` swaps the damp crawl space for a calm series.
  `app/analysis/weather.py` fills the `/api/house` `weather` pill from
  Open-Meteo (Vaasa, Mongo-cached 30 min) with the fans' outdoor
  transmitters as fallback, and supplies daily history for the sensor site
  (Vantaa, archive API, cached 3 h per date range). That history goes into
  the digest's `weather` block and the events' `outdoor_weather`, where
  scoring and the narrator use it. Tests stub the fetch
  (`tests/conftest.py`).
  `/api/house` and `/api/report` surface the narrative beyond
  headline/summary: `recommendations`, feed `message`s taken from the
  narrative's `attention_items` (matched to findings by location label),
  and `narrative_source` (`llm`/`fallback`/`demo` — "demo" while the
  staged leak copy is in charge). `app/analysis/sensor_summary.py` adds
  the same LLM-or-fallback narration per sensor: `/api/sensors/{id}/series`
  returns `summary` + `summary_source` computed from the chart's own
  hourly buckets, Mongo-cached per (sensor, range, period). Mind the
  Gemini free-tier quota (~20 req/day on gemini-3-flash-preview) — the
  caches exist so the UI doesn't burn it on every load. Bump
  `llm.NARRATION_VERSION` when prompts or narrator inputs change; cached
  text from another version regenerates on its next read.
  `/api/analysis` serves the raw analysis, `/api/analysis/digest` the
  context packet
- `frontend/` — Vite + React + TS + Tailwind v4 (vite plugin). The app is the
  "Oura for a house" consumer view (see `docs/specs/`), routed with
  `react-router-dom` in `src/App.tsx`. `components/AppShell.tsx` is the
  layout route: a navy VILPE sidebar (logo, Overview/Sensors nav, score
  ring, weather, attention feed, demo controls) around `/` (react-three-fiber
  3D detached house with status dots and pinned callout cards showing key
  readings), `/sensors` (device list), `/sensors/:id` (recharts trends) and
  `/report` (Moisture History Report, printable to PDF).
  Outside the shell: `/status` (original stats landing) and `/data`
  (`src/DataExplorer.tsx`, a dev page for the ingested Sense dataset). Data
  comes from `src/api/` — **mock-first** (`VITE_API_MODE`, default `mock`)
  serving `public/mock/*.json` fixtures generated by
  `scripts/gen_mock_data.py` (7 devices of a detached house, backed by the
  catalog's real Sense series) including a client-side leak simulation;
  `VITE_API_MODE=live` (in `frontend/.env` — gitignored, per-machine;
  documented in `.env.example`) switches to the real `/api` contract.
  Regenerate fixtures with `python scripts/gen_mock_data.py`.
  VILPE brand theme lives in `src/index.css` `@theme` tokens; the dev server
  proxies `/api` → `localhost:8000`
- `Dockerfile` (root) + `render.yaml` — single-image deploy: multi-stage
  build produces the frontend `dist/` and a Python image where uvicorn serves
  it alongside `/api/*` (backend mounts `STATIC_DIR` when it exists, so dev
  is unaffected). Render blueprint provisions a free web service; MongoDB
  Atlas M0 is the prod DB, `MONGODB_URI` is a prompted env var. Every push to
  `main` redeploys.
- `docs/` — `VISION.md` (the product vision, written for agents — see above),
  `specs/` (design specs — frontend is built contract-first against
  `specs/2026-10-03-frontend-design.md`, extended by the onboarding flow in
  `specs/2026-10-03-onboarding-design.md`), `architecture/` (living as-built
  references: `deterministic-analysis.md` — digest, events, score, normal
  band; `llm-narration.md` — Gemini prompts, fallback, caching; update them
  when you change `app/analysis/`), plus `ideas/` for hackathon
  brainstorming
- `data/` — VILPE Sense demo-site dataset (Vantaa): `site.json`,
  `devices.json` (7 MCU-2 ventilation fans), `sensors.json` (51 RHT-2
  sensors), `readings/` CSV time series; see `data/README.md`. Refresh from
  the live public API with `scripts/fetch_sense_data.py`
- `Makefile` — devcontainer lifecycle helpers
- `.github/workflows/ci.yml` — backend (ruff + pytest against a real MongoDB
  service) and frontend (oxlint + build) on push/PR. No devcontainer build in
  CI — too slow for its value; `make rebuild` verifies locally

Keep this section and the commands below up to date as the structure grows.

## Environment

- **Everything runs inside the devcontainer — including you.** Run commands
  directly; don't reach for `docker`/`make` (host-side) or install tools —
  Node.js 24, Python 3.12, `uv`, pytest, ruff and npm are already here.
- **Never run `uv`/`npm` on the host against this repo.** The bind mount
  shares `backend/.venv` and `frontend/node_modules`; a host-side `uv run`
  rewrites `.venv` with a host interpreter path, which kills the container's
  backend (uvicorn can't respawn a worker from a dangling symlink).
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
- **Don't commit third-party materials.** Sponsor decks, challenge PDFs and
  other binary/proprietary handouts stay out of version control.
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
