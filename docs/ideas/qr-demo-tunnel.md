# QR demo tunnel

One command that exposes the dev stack publicly and prints a QR code in the
terminal — scan it with a phone and the whole app (UI → API → Mongo, via the
Vite `/api` proxy) runs live on the phone. Ideal for hackathon demoing without
a real deploy.

## Sketch (`scripts/demo.sh`, not yet implemented)

- `cloudflared tunnel --url http://localhost:5173` gives a free public URL —
  no account, works on a quick tunnel
- `qrencode -t ansiutf8 <url>` renders the QR straight into the terminal
- Lazy-install both tools on first run so `post-create.sh` stays fast

## Caveats

- Only works while the laptop + devcontainer are running — it's a demo trick,
  not hosting
- For a persistent public URL, see the deploy section in the README
  (Dockerfile + `CORS_ORIGINS` + `VITE_API_URL` are already in place)
