# Manual deploy steps — Render + MongoDB Atlas

Step-by-step runbook for the one-time manual setup that gets the app a
persistent public URL. The code side is already in the repo: root
`Dockerfile` (one image: Vite build + FastAPI serving `dist/` + `/api/*`)
and `render.yaml` (Render blueprint). Total ~20 min of clicking + ~5 min
first build. Both tiers are free.

## Part 1 — MongoDB Atlas (~10 min)

1. Go to https://cloud.mongodb.com → sign in (GitHub login works).
2. **Create a cluster** → **M0 Free** → provider AWS, region
   **Frankfurt (eu-central-1)** (the Render service runs in Frankfurt —
   shortest latency) → name it e.g. `jnctn` → Create.
3. **Database user**: Security → Database Access → Add New Database User →
   Password auth. **Generate a password without special characters** (@, /,
   # require URL-encoding in the connection string — easiest to avoid).
   Role: "Read and write to any database". Save the username + password.
4. **Network Access**: Security → Network Access → Add IP Address →
   **Allow Access from Anywhere** (`0.0.0.0/0`). Required — Render's
   outbound IPs are dynamic.
5. **Connection string**: Database → Connect → Drivers → Python → copy
   `mongodb+srv://<username>:<password>@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority`
   and fill in the username + password.

## Part 2 — Render (~10 min + ~5 min build)

1. **Push the code to GitHub first** — Render builds from the repo, not
   from local files.
2. https://render.com → sign in (GitHub login, grant repo access).
3. Dashboard → **New + → Blueprint** → pick `vkerttula/jnctn` → Render
   reads `render.yaml` and previews one web service → **Apply**.
4. It asks for `MONGODB_URI` → **paste the Atlas string**, and `DEMO_KEY`
   → set it to the value of `ACCESS_CODE` in `frontend/src/auth.ts`
   (`sense-demo` at the time of writing) — the login page and the
   backend gate must agree. `MONGODB_DB` comes from the blueprint.
5. First deploy starts — watch the **Logs** view. Build takes ~3–5 min
   (npm ci → vite build → uv sync → image launch).
6. When status is **Live**, open `https://jnctn.onrender.com` — you
   should land on the login page. Then verify the Atlas connection:
   `/api/db-ping` is behind the gate, so send the header —
   `curl -H 'x-demo-key: sense-demo' https://jnctn.onrender.com/api/db-ping`
   → `{"status":"ok"}`. A bare `/api/db-ping` returning 401 is the gate
   working, not an error.

Note: `/api/db-ping` only proves connectivity — the Atlas DB is still
empty, so `/api/house` and friends return no data until Part 3.

## Part 3 — Seed the dataset (~5 min)

The free tier has no shell or one-off jobs, and the CSVs under `data/`
aren't in the Docker image — run ingest from the devcontainer against
Atlas instead:

```bash
cd backend
MONGODB_URI="mongodb+srv://<user>:<pass>@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority" \
  uv run python -m app.ingest
```

Then verify (with the header, as above) that `/api/house` returns real
sensor data. Re-run any time to refresh; ingest is idempotent.

## After setup

- Every `git push` to `main` → Render rebuilds and redeploys
  automatically (auto-deploy is on by default).
- **Sharing**: send friends the URL + the access code. The login page
  asks for the code, then they pick a preset user — **Demo Family**
  serves the mock fixtures (no backend needed) and **Matti Virtanen**
  serves the live Atlas data. Every `/api/*` call without the code's
  `x-demo-key` header gets a 401, so bots can't reach Mongo or burn the
  Gemini quota. To rotate the gate, change `ACCESS_CODE` in
  `frontend/src/auth.ts` and `DEMO_KEY` in Render together.
- Free tier sleeps after ~15 min idle → cold start ~30 s. Ping the URL
  before demoing, or upgrade ($7/mo) to keep it warm.
- To gate deploys on green CI: disable auto-deploy in the service
  settings and call the Render deploy hook URL from a CI step instead.

## Troubleshooting

- **`/api/db-ping` returns 503**: almost always one of — wrong
  `MONGODB_URI`, an unencoded special char in the password, or Network
  Access not set to `0.0.0.0/0`. Fix under Render → service → Environment
  → `MONGODB_URI`; saving triggers a redeploy.
- **UI renders but shows the demo house, not live data**: the frontend
  was built in mock mode. The Dockerfile sets `VITE_API_MODE=live`
  itself — if you built the image another way, pass that env at build
  time.
- **`/api/house` is empty / sensors missing**: Atlas has no data — run
  Part 3's ingest.
- **Build fails on `npm ci`**: `frontend/package-lock.json` must be
  committed.
- **Blank page but `/docs` works**: check build logs — the frontend stage
  may have failed; the image falls back to serving API only.

## What did NOT change

- `make start/stop/rebuild/mongo`, the devcontainer, Mongo sidecar and
  `scripts/dev.sh` are untouched — the deploy path is fully separate.
- Only dev-visible difference: once `frontend/dist` exists (after
  `npm run build`), `localhost:8000/` serves the app instead of
  redirecting to `/docs` (`/docs` still works).
