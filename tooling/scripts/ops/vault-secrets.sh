#!/usr/bin/env bash
# tooling/scripts/ops/vault-secrets.sh
#
# Creates or rotates the Supabase Vault secrets that the database itself reads (docs/ops/secrets.md):
#   project_url    https://<ref>.supabase.co (or https://api.thuluth.app in prod), used by pg_cron
#                  through private.invoke_edge_function()
#   cron_secret    equals the Edge Function secret INTERNAL_CRON_SECRET (sent as x-internal-secret)
#   audit_ip_salt  salt for audit_log.ip_hash
# Values come from the environment, never from arguments (they would land in shell history and
# `ps`). Run once per environment by the owner; re-run to rotate (19 section 8.1 for cron_secret).
#
# Usage:
#   export SUPABASE_DB_URL=... VAULT_PROJECT_URL=... VAULT_CRON_SECRET=... VAULT_AUDIT_IP_SALT=...
#   tooling/scripts/ops/vault-secrets.sh            # create or update all three
#   ONLY=cron_secret tooling/scripts/ops/vault-secrets.sh
set -euo pipefail

[ -n "${SUPABASE_DB_URL:-}" ] || { echo "SUPABASE_DB_URL is not set" >&2; exit 2; }

declare -A VALUES=(
  [project_url]="${VAULT_PROJECT_URL:-}"
  [cron_secret]="${VAULT_CRON_SECRET:-}"
  [audit_ip_salt]="${VAULT_AUDIT_IP_SALT:-}"
)

for name in project_url cron_secret audit_ip_salt; do
  if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$name" ]; then continue; fi
  value="${VALUES[$name]}"
  if [ -z "$value" ]; then echo "skip $name (no value in env)"; continue; fi
  if [ "$name" != project_url ] && [ "${#value}" -lt 32 ]; then
    echo "$name must be at least 32 characters (openssl rand -hex 32)" >&2; exit 2
  fi
  # Passed as psql variables and quoted by psql (:'v'); output is discarded so nothing is echoed.
  psql "$SUPABASE_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 -q -v name="$name" -v v="$value" >/dev/null <<'SQL'
select vault.update_secret(s.id, :'v') from vault.secrets s where s.name = :'name';
select vault.create_secret(:'v', :'name', 'set by tooling/scripts/ops/vault-secrets.sh')
 where not exists (select 1 from vault.secrets where name = :'name');
SQL
  echo "vault secret $name set"
done
