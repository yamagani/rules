#!/usr/bin/env bash
# Create/link the six Vercel projects for this monorepo and set their Root Directories.
# No secrets live in this file: it reads VERCEL_TOKEN (and optional VERCEL_TEAM_ID) from
# your environment and prints the project ids to store as GitHub secrets.
#
#   export VERCEL_TOKEN=...            # https://vercel.com/account/tokens
#   export VERCEL_TEAM_ID=team_...     # optional, for team scopes
#   bash infra/vercel/setup.sh
set -euo pipefail
: "${VERCEL_TOKEN:?export VERCEL_TOKEN first}"
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

API=https://api.vercel.com
scope=()
q=""
if [ -n "${VERCEL_TEAM_ID:-}" ]; then scope=(--scope "$VERCEL_TEAM_ID"); q="?teamId=$VERCEL_TEAM_ID"; fi
vercel() { npx --yes vercel@latest "$@" --token "$VERCEL_TOKEN" "${scope[@]}"; }
api() { curl -fsS -H "Authorization: Bearer $VERCEL_TOKEN" -H 'Content-Type: application/json' "$@"; }

# name | root directory | framework (null = build command decides / Build Output API)
projects=(
  "rules-shell|apps/web/shell|null"
  "rules-mfe-rules|apps/web/mfe-rules|\"vite\""
  "rules-mfe-releases|apps/web/mfe-releases|\"vite\""
  "rules-mfe-admin|apps/web/mfe-admin|\"vite\""
  "rules-bff|apps/api/bff|null"
  "rules-service|apps/api/rules-service|null"
)

declare -A secret_names=(
  [rules-shell]=VERCEL_PROJECT_ID_SHELL
  [rules-mfe-rules]=VERCEL_PROJECT_ID_MFE_RULES
  [rules-mfe-releases]=VERCEL_PROJECT_ID_MFE_RELEASES
  [rules-mfe-admin]=VERCEL_PROJECT_ID_MFE_ADMIN
  [rules-bff]=VERCEL_PROJECT_ID_BFF
  [rules-service]=VERCEL_PROJECT_ID_RULES_SERVICE
)

for entry in "${projects[@]}"; do
  IFS='|' read -r name root framework <<<"$entry"
  echo "==> $name ($root)"
  vercel project add "$name" >/dev/null 2>&1 || echo "    (already exists)"
  api -X PATCH "$API/v9/projects/$name$q" \
    -d "{\"rootDirectory\":\"$root\",\"framework\":$framework,\"nodeVersion\":\"22.x\",\"sourceFilesOutsideRootDirectory\":true}" >/dev/null
  id=$(api "$API/v9/projects/$name$q" | jq -r .id)
  echo "    root directory set; id $id"
  echo "gh secret set ${secret_names[$name]} --body '$id'" >> /tmp/rules-vercel-secrets.txt
done

org=$(api "$API/v2/user" | jq -r '.user.defaultTeamId // .user.id')
echo
echo "Add these GitHub secrets (or run the commands printed below):"
echo "gh secret set VERCEL_ORG_ID --body '${VERCEL_TEAM_ID:-$org}'"
cat /tmp/rules-vercel-secrets.txt && rm -f /tmp/rules-vercel-secrets.txt
echo "gh secret set VERCEL_TOKEN        # paste a token interactively"
echo
echo "Next: configure each project's environment variables (infra/vercel/README.md)."
