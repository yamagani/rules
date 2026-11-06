#!/usr/bin/env bash
# Create the three Vercel projects for this monorepo, connect them to the GitHub repo, set
# their Root Directories, and write the project ids into the `relatedProjects` lists that let
# web → bff → api find each other (same-branch previews, production domains).
#
# No secrets live in this file: it reads VERCEL_TOKEN (and optional VERCEL_TEAM_ID) from your
# environment. Requires the Vercel GitHub app to have access to the repository.
#
#   export VERCEL_TOKEN=...            # https://vercel.com/account/tokens
#   export VERCEL_TEAM_ID=team_...     # optional, for team scopes
#   bash infra/vercel/setup.sh [owner/repo]
#
# Afterwards: commit the updated vercel.json files, and connect the Neon integration to
# `rules-api` (see infra/vercel/README.md).
set -euo pipefail
: "${VERCEL_TOKEN:?export VERCEL_TOKEN first}"
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
REPO=${1:-$(git config --get remote.origin.url | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')}
ROOT=$(git rev-parse --show-toplevel)
API=https://api.vercel.com
q=""; [ -n "${VERCEL_TEAM_ID:-}" ] && q="?teamId=$VERCEL_TEAM_ID"
api() { curl -fsS -H "Authorization: Bearer $VERCEL_TOKEN" -H 'Content-Type: application/json' "$@"; }

# name | root directory
projects=("rules-web|apps/web/shell" "rules-bff|apps/api/bff" "rules-api|apps/api/rules-service")
declare -A ids

for entry in "${projects[@]}"; do
  IFS='|' read -r name root <<<"$entry"
  echo "==> $name ($root) ← github.com/$REPO"
  if ! api "$API/v9/projects/$name$q" >/dev/null 2>&1; then
    api -X POST "$API/v11/projects$q" -d "$(jq -n --arg n "$name" --arg r "$REPO" \
      '{name: $n, framework: null, gitRepository: {type: "github", repo: $r}}')" >/dev/null
  fi
  api -X PATCH "$API/v9/projects/$name$q" \
    -d "{\"rootDirectory\":\"$root\",\"framework\":null,\"nodeVersion\":\"22.x\",\"sourceFilesOutsideRootDirectory\":true}" >/dev/null
  ids[$name]=$(api "$API/v9/projects/$name$q" | jq -r .id)
  echo "    id ${ids[$name]}"
done

set_related() { # file, project id
  tmp=$(mktemp)
  jq --arg id "$2" '.relatedProjects = [$id]' "$ROOT/$1" > "$tmp" && mv "$tmp" "$ROOT/$1"
  echo "    $1: relatedProjects = [$2]"
}
echo "==> wiring related projects"
set_related apps/web/shell/vercel.json "${ids[rules-bff]}"
set_related apps/api/bff/vercel.json "${ids[rules-api]}"

cat <<MSG

Done. Next:
  1. Commit the two vercel.json changes and push to main.
  2. Vercel dashboard → Integrations → Neon → connect it to the rules-api project only
     (enable "Create a database branch for each preview deployment").
  3. Set the env vars listed in infra/vercel/README.md (rules-api only; web and bff need none).
MSG
