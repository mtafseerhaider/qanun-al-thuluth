#!/usr/bin/env bash
# tooling/scripts/check-mobile-secrets.sh
#
# MASVS-STORAGE / MASVS-CODE (16 section 19, docs/security/masvs-l1-checklist.md): the mobile app must never
# carry a server secret. Three checks, all offline and credential-free:
#
#   1. source   Env reads in apps/mobile and packages/shared/src (process.env.X, process.env['X'],
#               import.meta.env.X) and the env keys of apps/mobile/eas.json. A name containing SERVICE_ROLE,
#               SECRET, PRIVATE_KEY, DB_URL or DB_PASSWORD is refused even with the EXPO_PUBLIC_ prefix; a name
#               ending in _KEY, _TOKEN or _PASSWORD is refused unless it starts with EXPO_PUBLIC_.
#   2. config   (--bundle) `expo config --type public --json`: the app config that ships inside the binary and
#               every update manifest.
#   3. bundle   (--bundle) the JS of `expo export --platform android --no-bytecode` (or an existing export
#               with --export-dir): service-role JWT payloads, Supabase secret keys, provider API keys, PEM
#               private keys, the names of server-only secrets and the throwaway local Vault and fixture values.
#
# Usage:
#   tooling/scripts/check-mobile-secrets.sh                       # source scan only (seconds)
#   tooling/scripts/check-mobile-secrets.sh --bundle              # + config and a fresh export (CI)
#   tooling/scripts/check-mobile-secrets.sh --export-dir DIR      # + scan an existing `expo export` output
#   tooling/scripts/check-mobile-secrets.sh --self-test           # prove each check fails on planted fixtures
# Exit 0 when clean, 1 on a finding, 2 on a usage or tooling error.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Names of server-only secrets (docs/ops/secrets.md sections 1, 2 and 4). None may appear in the shipped JS.
SERVER_SECRET_NAMES='SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|INTERNAL_CRON_SECRET|ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_AI_API_KEY|REVENUECAT_SECRET_API_KEY|REVENUECAT_WEBHOOK_SECRET|ONESIGNAL_REST_API_KEY|POSTMARK_SERVER_TOKEN|GOTENBERG_TOKEN|SENTRY_AUTH_TOKEN|SUPABASE_ACCESS_TOKEN|SUPABASE_DB_URL|SUPABASE_DB_PASSWORD|VAULT_CRON_SECRET|VAULT_AUDIT_IP_SALT|HCAPTCHA_SECRET|PLAY_SERVICE_ACCOUNT_JSON'
# Secret values by shape. The service-role JWT payload is matched at all three base64 alignments of
# "role":"service_role" (a JWT payload is base64url; these runs contain no + or /).
VALUE_PATTERNS=(
  'InJvbGUiOiJzZXJ2aWNlX3JvbGUi'
  'b2xlIjoic2VydmljZV9yb2xl'
  'cm9sZSI6InNlcnZpY2Vfcm9sZS'
  '"role" *: *"service_role"'
  'sb_secret_[A-Za-z0-9_-]{16,}'
  'sk-ant-[A-Za-z0-9_-]{16,}'
  'sk-proj-[A-Za-z0-9_-]{16,}'
  '(^|[^A-Za-z0-9_])sk_[A-Za-z0-9]{24,}'
  'os_v2_app_[a-z0-9]{20,}'
  'AIza[0-9A-Za-z_-]{35}'
  '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'
  "(^|[^A-Za-z0-9_])(${SERVER_SECRET_NAMES})([^A-Za-z0-9_]|\$)"
  'local-cron-secret-not-for-production|local-audit-ip-salt-not-for-production|thuluth-local-dev'
)

findings=0
fail() {
  echo "::error::$*"
  findings=$((findings + 1))
}

forbidden_name() {
  local n="$1"
  if [[ "$n" =~ (SERVICE_ROLE|SECRET|PRIVATE_KEY|DB_URL|DB_PASSWORD) ]]; then return 0; fi
  if [[ "$n" != EXPO_PUBLIC_* && "$n" =~ (_KEY|_TOKEN|_PASSWORD)$ ]]; then return 0; fi
  return 1
}

# 1. source: env reads in the files the app bundles or is configured from.
scan_source() {
  local mobile="$1" shared="$2"
  local hits
  hits="$(grep -rnoE "(process\.env\.|process\.env\[['\"]|import\.meta\.env\.)[A-Z][A-Z0-9_]*" \
            --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.mjs' --include='*.cjs' \
            --exclude-dir=node_modules --exclude-dir=.expo --exclude-dir=dist --exclude-dir=ios --exclude-dir=android \
            --exclude-dir=__tests__ --exclude='*.test.*' --exclude='*.spec.*' \
            "$mobile" "$shared" 2>/dev/null || true)"
  local line name
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    name="$(sed -E 's/.*(process\.env\.|process\.env\[['"'"'"]|import\.meta\.env\.)//' <<<"$line")"
    if forbidden_name "$name"; then fail "source reads a server secret env var: ${line%%:*}: $name"; fi
  done <<<"$hits"
  if [ -f "$mobile/eas.json" ]; then
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      if forbidden_name "$name"; then fail "eas.json sets a server secret env var: $name"; fi
    done < <(grep -oE '"[A-Z][A-Z0-9_]*"[[:space:]]*:' "$mobile/eas.json" | sed -E 's/^"([A-Z0-9_]+)".*/\1/' || true)
  fi
}

# 2 and 3. values in shipped text (bundle JS, the public app config).
scan_values() {
  local label="$1"
  shift
  local p f
  for f in "$@"; do
    for p in "${VALUE_PATTERNS[@]}"; do
      if grep -qE -- "$p" "$f"; then
        fail "$label contains a server secret (pattern '$p'): $f"
      fi
    done
  done
}

scan_export_dir() {
  local dir="$1"
  local files=()
  while IFS= read -r -d '' f; do files+=("$f"); done \
    < <(find "$dir" -type f \( -name '*.js' -o -name '*.json' -o -name '*.hbc' \) -not -name '*.map' -print0)
  [ ${#files[@]} -gt 0 ] || { echo "no bundle files under $dir" >&2; exit 2; }
  scan_values bundle "${files[@]}"
  echo "bundle: scanned ${#files[@]} files under $dir"
}

run_bundle() {
  local tmp
  tmp="$(mktemp -d)"
  trap "rm -rf '$tmp'" EXIT
  (cd "$ROOT/apps/mobile" && CI=1 npx expo config --type public --json > "$tmp/public-config.json")
  scan_values config "$tmp/public-config.json"
  echo "config: scanned the public app config"
  (cd "$ROOT/apps/mobile" && CI=1 npx expo export --platform android --no-bytecode --output-dir "$tmp/export" > "$tmp/export.log" 2>&1) \
    || { cat "$tmp/export.log" >&2; echo "expo export failed" >&2; exit 2; }
  scan_export_dir "$tmp/export"
}

self_test() {
  local tmp ok=1 jwt_payload
  tmp="$(mktemp -d)"
  trap "rm -rf '$tmp'" EXIT
  mkdir -p "$tmp/mobile/src" "$tmp/shared" "$tmp/bundle"
  printf 'export const url = process.env.EXPO_PUBLIC_SUPABASE_URL;\nexport const k = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;\nexport const e = process.env.APP_ENV;\n' > "$tmp/mobile/src/ok.ts"
  printf '{ "build": { "base": { "env": { "SENTRY_ORG": "thuluth", "APP_ENV": "production" } } } }\n' > "$tmp/mobile/eas.json"
  printf 'console.log("clean bundle", "sb_secret_");\n' > "$tmp/bundle/index.js"

  findings=0
  scan_source "$tmp/mobile" "$tmp/shared"
  scan_export_dir "$tmp/bundle" > /dev/null
  [ "$findings" -eq 0 ] || { echo "self-test: clean fixtures were flagged" >&2; ok=0; }

  local cases=(
    "src|process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"
    "src|process.env['OPENAI_API_KEY']"
    "src|process.env.REVENUECAT_WEBHOOK_SECRET"
    "eas|\"SUPABASE_SERVICE_ROLE_KEY\": \"x\""
  )
  local c kind body
  for c in "${cases[@]}"; do
    kind="${c%%|*}"
    body="${c#*|}"
    rm -rf "$tmp/case" && mkdir -p "$tmp/case/src"
    if [ "$kind" = eas ]; then
      printf '{ "build": { "x": { "env": { %s } } } }\n' "$body" > "$tmp/case/eas.json"
    else
      printf 'export const v = %s;\n' "$body" > "$tmp/case/src/leak.ts"
    fi
    findings=0
    scan_source "$tmp/case" "$tmp/shared" > /dev/null
    [ "$findings" -gt 0 ] || { echo "self-test: missed $kind: $body" >&2; ok=0; }
  done

  jwt_payload="$(printf '{"iss":"supabase","ref":"abcdefghijklmnopqrst","role":"service_role","iat":1700000000}' | base64 -w0 | tr '+/' '-_' | tr -d '=')"
  local leaks=(
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${jwt_payload}.signature"
    "const k = 'sb_secret_$(printf 'A%.0s' {1..32})';"
    "fetch(u, { headers: { 'x-api-key': 'sk-ant-api03-$(printf 'b%.0s' {1..40})' } });"
    "const name = 'SUPABASE_SERVICE_ROLE_KEY';"
    "const s = 'local-cron-secret-not-for-production';"
  )
  local l
  for l in "${leaks[@]}"; do
    rm -rf "$tmp/leak" && mkdir -p "$tmp/leak"
    printf '%s\n' "$l" > "$tmp/leak/index.js"
    findings=0
    scan_export_dir "$tmp/leak" > /dev/null
    [ "$findings" -gt 0 ] || { echo "self-test: missed bundle leak: ${l:0:40}..." >&2; ok=0; }
  done
  findings=0
  [ "$ok" = 1 ] && { echo "self-test: ok"; exit 0; }
  exit 1
}

mode=source
export_dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bundle) mode=bundle ;;
    --export-dir) export_dir="${2:?--export-dir needs a directory}"; mode=dir; shift ;;
    --self-test) self_test ;;
    -h | --help) sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

scan_source "$ROOT/apps/mobile" "$ROOT/packages/shared/src"
echo "source: scanned apps/mobile and packages/shared/src env reads"
case "$mode" in
  bundle) run_bundle ;;
  dir) scan_export_dir "$export_dir" ;;
esac

if [ "$findings" -gt 0 ]; then
  echo "check-mobile-secrets: $findings finding(s)" >&2
  exit 1
fi
echo "check-mobile-secrets: no server secrets in the mobile app"
