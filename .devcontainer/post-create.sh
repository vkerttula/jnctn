#!/usr/bin/env bash
# Runs once when the devcontainer is (re)created.
#
# devin-data is a named volume mounted at ~/.local/share/devin so Devin CLI
# sessions survive rebuilds. A fresh named volume — and the mount-point
# parents Docker creates for it — are root-owned, so fix ownership first.
set -euo pipefail

DEVIN_DATA="$HOME/.local/share/devin"
GH_CONFIG="$HOME/.config/gh"
SEED="/workspaces/.devin-seed"

mkdir -p "$DEVIN_DATA" "$GH_CONFIG" 2>/dev/null || true
sudo chown node:node "$HOME/.local" "$HOME/.local/share" "$DEVIN_DATA" \
  "$HOME/.config" "$GH_CONFIG"

# One-shot restore: if the volume is fresh but a seed copy exists on the host
# bind mount (created before a rebuild), bring it in and remove the seed.
if [ ! -f "$DEVIN_DATA/cli/sessions.db" ] && [ -d "$SEED" ]; then
  cp -a "$SEED/." "$DEVIN_DATA/"
  rm -rf "$SEED"
  echo "devin: restored CLI data seed into the devin-data volume"
fi

# uv manages the backend (backend/pyproject.toml). It's not in the image, so
# install on every (re)create — pipx puts it on PATH at /usr/local/py-utils/bin.
command -v uv >/dev/null || pipx install uv

# If gh is authenticated (gh-data volume), wire git pushes and set a
# repo-local commit identity. || true: unauthenticated gh (e.g. CI) must not
# fail the whole post-create.
if gh auth status >/dev/null 2>&1; then
  gh auth setup-git
  bash "$(dirname "$0")/../scripts/git-identity.sh" || true
fi
