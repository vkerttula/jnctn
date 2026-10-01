#!/usr/bin/env bash
# Start dev servers inside the devcontainer. MongoDB is a compose sidecar
# and is already running — nothing to start for it.
#
#   scripts/dev.sh            # backend + frontend
#   scripts/dev.sh backend    # only FastAPI on :8000
#   scripts/dev.sh frontend   # only Vite on :5173 (needs backend for /api)
#
# Also runs automatically via devcontainer's postStartCommand (detached,
# logs to /tmp/dev.log). Services already running are skipped, so re-running
# manually is safe. To take over in a foreground terminal:
#   pkill -f 'uvicorn app.main'; pkill -f 'node_modules/.bin/vite'
#   ./scripts/dev.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# pipx-installed tools (uv) live here; PATH may be minimal when invoked by
# postStartCommand instead of an interactive shell.
export PATH="$PATH:/usr/local/py-utils/bin:$HOME/.local/bin"

pids=()
cleanup() {
  # Each server runs in its own process group (setsid), so kill the whole
  # group to also get grandchildren (uvicorn --reload worker, node, ...).
  for pid in "${pids[@]}"; do
    kill -- -"$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

# Port check, not pgrep — the container's PID 1 is `sleep infinity`, which
# never reaps children, so zombie processes linger and fool pgrep.
listening() {
  ss -tlnH "sport = :$1" | grep -q .
}

start_backend() {
  if listening 8000; then
    echo "backend already running — skipping"
    return
  fi
  # On first container create this runs before postCreateCommand installs uv.
  if ! command -v uv >/dev/null; then
    echo "waiting for uv (postCreate installs it)..."
    for _ in $(seq 1 90); do
      command -v uv >/dev/null && break
      sleep 1
    done
  fi
  setsid bash -c 'cd backend && exec uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000' &
  pids+=($!)
}

start_frontend() {
  if listening 5173; then
    echo "frontend already running — skipping"
    return
  fi
  setsid bash -c 'cd frontend && exec npm run dev' &
  pids+=($!)
}

case "${1:-all}" in
  all)
    start_backend
    start_frontend
    ;;
  backend) start_backend ;;
  frontend) start_frontend ;;
  *)
    echo "usage: $0 [all|backend|frontend]" >&2
    exit 1
    ;;
esac

if ((${#pids[@]})); then
  echo "dev servers started — Ctrl-C stops them"
  wait
fi
