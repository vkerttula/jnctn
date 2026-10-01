#!/usr/bin/env bash
# Set repo-local git identity from your gh auth. Run `gh auth login` first.
# Repo-local config lives in .git/ (workspace bind mount) so it survives
# container rebuilds and doesn't touch your global git config.
set -euo pipefail

if ! gh auth status >/dev/null 2>&1; then
  echo "not logged in — run: gh auth login" >&2
  exit 1
fi

name=$(gh api user --jq '.name // .login')
login=$(gh api user --jq '.login')
id=$(gh api user --jq '.id')

git config user.name "$name"
git config user.email "${id}+${login}@users.noreply.github.com"
gh auth setup-git

echo "git identity: $name <${id}+${login}@users.noreply.github.com>"
