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
4. It asks for the `MONGODB_URI` value → **paste the Atlas string**.
   `MONGODB_DB` already comes from the blueprint (`jnctn`).
5. First deploy starts — watch the **Logs** view. Build takes ~3–5 min
   (npm ci → vite build → uv sync → image launch).
6. When status is **Live**, open `https://jnctn.onrender.com` — the
   frontend should render. Then verify
   `https://jnctn.onrender.com/api/db-ping` → `{"status":"ok"}` means the
   Atlas connection works end to end.

## After setup

- Every `git push` to `main` → Render rebuilds and redeploys
  automatically (auto-deploy is on by default).
- Free tier sleeps after ~15 min idle → cold start ~30 s. Ping the URL
  before demoing, or upgrade ($7/mo) to keep it warm.
- To gate deploys on green CI: disable auto-deploy in the service
  settings and call the Render deploy hook URL from a CI step instead.

## Troubleshooting

- **`/api/db-ping` returns 503**: almost always one of — wrong
  `MONGODB_URI`, an unencoded special char in the password, or Network
  Access not set to `0.0.0.0/0`. Fix under Render → service → Environment
  → `MONGODB_URI`; saving triggers a redeploy.
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
