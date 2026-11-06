#!/usr/bin/env bash
# Fail if anything secret-shaped ends up in the static assets served to browsers.
# CI builds the web apps with canary values in the secret env vars (see ci.yml), so a leak
# of an env var into a bundle is caught by value, not just by shape.
set -euo pipefail
dirs=()
for d in apps/web/*/dist apps/web/shell/.vercel/output/static; do [ -d "$d" ] && dirs+=("$d"); done
[ ${#dirs[@]} -gt 0 ] || { echo "no built web assets found; run pnpm build first" >&2; exit 2; }

patterns=(
  'sk-ant-[A-Za-z0-9_-]{10,}'                 # Anthropic keys
  'sk-(proj-)?[A-Za-z0-9]{32,}'               # OpenAI keys
  'postgres(ql)?(\+[a-z0-9]+)?://[^:/@ ]+:[^@ ]+@'  # DB URLs with credentials
  'BEGIN [A-Z ]*PRIVATE KEY'
  'npg_[A-Za-z0-9]{10,}'                      # Neon passwords
)
for v in ANTHROPIC_API_KEY OPENAI_API_KEY DATABASE_URL DATABASE_URL_UNPOOLED DEV_JWT_SECRET NEON_API_KEY VERCEL_TOKEN; do
  value="${!v:-}"
  # Escape regex metacharacters in canary values.
  [ ${#value} -ge 12 ] && patterns+=("$(printf '%s' "$value" | sed 's/[][\.*^$+?(){}|/]/\\&/g')")
done

status=0
for p in "${patterns[@]}"; do
  if grep -rEIl -- "$p" "${dirs[@]}" >/tmp/bundle-hits 2>/dev/null; then
    echo "::error::secret-like value matching /$p/ found in client bundles:" >&2
    sed 's/^/  /' /tmp/bundle-hits >&2
    status=1
  fi
done
[ $status -eq 0 ] && echo "client bundles clean (${#patterns[@]} patterns, ${#dirs[@]} directories)"
exit $status
