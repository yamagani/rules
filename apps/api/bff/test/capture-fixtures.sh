#!/usr/bin/env bash
# Regenerate BFF test fixtures from a freshly seeded local rules-service:
#   pnpm db:seed && pnpm --filter @rules/rules-service dev &   # then:
#   bash apps/api/bff/test/capture-fixtures.sh
set -euo pipefail
RS=${RULES_SERVICE_URL:-http://localhost:8000}
OUT=$(dirname "$0")/fixtures
APP=loan-origination
mkdir -p "$OUT"
token() { curl -sf -XPOST "$RS/v1/dev/token" -H 'content-type: application/json' -d "{\"username\":\"$1\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])'; }
get() { curl -sf "$RS$2" -H "authorization: Bearer $1"; }
for u in alice bob carol dave svc-loan; do get "$(token $u)" /v1/me > "$OUT/me.$u.json"; done
A=$(token alice)
get "$A" /v1/apps/$APP/decisions > "$OUT/decisions.json"
for d in eligibility pricing approval-limit; do
  get "$A" /v1/apps/$APP/decisions/$d > "$OUT/decision.$d.json"
  get "$A" "/v1/apps/$APP/decisions/$d/usage?days=30" > "$OUT/usage.$d.json"
  get "$A" /v1/apps/$APP/decisions/$d/tests > "$OUT/tests.$d.json"
done
get "$A" /v1/apps/$APP/audit > "$OUT/audit.json"
get "$A" /v1/apps/$APP/grants > "$OUT/grants.json"
get "$A" /v1/ai/providers > "$OUT/providers.json"
get "$A" /v1/apps/$APP/ai/settings > "$OUT/ai-settings.json"
get "$A" /v1/apps/$APP/ai/providers > "$OUT/ai-app-providers.json"
get "$A" "/v1/apps/$APP/ai/usage?days=30" > "$OUT/ai-usage.json"
get "$A" /v1/dev/users > "$OUT/dev-users.json"
curl -sf "$RS/health" > "$OUT/health.json"
echo "fixtures written to $OUT"
