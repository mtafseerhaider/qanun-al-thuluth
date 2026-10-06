#!/usr/bin/env bash
# tooling/scripts/ops/smoke.sh
#
# Post-deploy smoke test without user data or AI spend (19 section 7, 20 section 14). Checks:
#   1. GET  /functions/v1/health              -> 200 and status ok|degraded (503 = down fails)
#   2. POST /functions/v1/revenuecat-webhook  -> 401 without the secret (webhook auth is on)
#   3. POST /functions/v1/analytics-rollup    -> 401 without x-internal-secret (cron auth is on)
#   4. GET  /rest/v1/feature_flags            -> 401 with the publishable key alone (anon has no grants)
#
# Usage: API_BASE_URL=https://api.thuluth.app SUPABASE_PUBLISHABLE_KEY=sb_publishable_... smoke.sh
set -euo pipefail

BASE="${API_BASE_URL:?API_BASE_URL is not set}"
KEY="${SUPABASE_PUBLISHABLE_KEY:?SUPABASE_PUBLISHABLE_KEY is not set}"
fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "ok   $1 ($3)"; else echo "FAIL $1: expected $2, got $3"; fail=1; fi
}

body=$(mktemp)
code=$(curl -sS -o "$body" -w '%{http_code}' --max-time 15 "$BASE/functions/v1/health" -H "apikey: $KEY" || true)
check "health http" 200 "$code"
status=$(sed -n 's/.*"status":"\([a-z]*\)".*/\1/p' "$body")
case "$status" in ok|degraded) echo "ok   health status ($status)";; *) echo "FAIL health status '$status'"; fail=1;; esac
if [ "$status" = degraded ]; then echo "::warning::health is degraded: $(cat "$body")"; fi

code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$BASE/functions/v1/revenuecat-webhook" \
  -H "apikey: $KEY" -H 'content-type: application/json' -d '{}' || true)
check "revenuecat-webhook rejects unsigned calls" 401 "$code"

code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST "$BASE/functions/v1/analytics-rollup" \
  -H "apikey: $KEY" -H 'content-type: application/json' -d '{}' || true)
check "analytics-rollup rejects calls without the cron secret" 401 "$code"

code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/rest/v1/feature_flags?select=key&limit=1" \
  -H "apikey: $KEY" || true)
check "feature_flags hidden from anonymous callers" 401 "$code"

rm -f "$body"
exit $fail
