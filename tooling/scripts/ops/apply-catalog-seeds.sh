#!/usr/bin/env bash
# tooling/scripts/ops/apply-catalog-seeds.sh
#
# Applies the idempotent catalog seeds (supabase/seed/catalog/*.sql, in file order) to a hosted
# project. Used by .github/workflows/deploy-prod.yml and deploy-dev.yml after `supabase db push`, and
# by hand for a catalog-only release. NEVER applies supabase/seed/local/* (local vault values and dev
# fixtures), which is why no hosted deploy uses `supabase db push --include-seed`.
#
# Usage:  SUPABASE_DB_URL=postgresql://... tooling/scripts/ops/apply-catalog-seeds.sh [--dry-run]
# Each file runs in its own transaction with ON_ERROR_STOP; the first failure stops the run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DIR="$ROOT/supabase/seed/catalog"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

[ -n "${SUPABASE_DB_URL:-}" ] || { echo "SUPABASE_DB_URL is not set" >&2; exit 2; }
command -v psql >/dev/null || { echo "psql not found (apt-get install postgresql-client)" >&2; exit 2; }

shopt -s nullglob
files=("$DIR"/*.sql)
[ ${#files[@]} -gt 0 ] || { echo "no catalog seeds in $DIR" >&2; exit 2; }

for f in "${files[@]}"; do
  echo "::group::$(basename "$f")"
  if [ "$DRY" = 1 ]; then
    echo "would apply $(basename "$f") ($(wc -l < "$f") lines)"
  else
    psql "$SUPABASE_DB_URL" --no-psqlrc -v ON_ERROR_STOP=1 --single-transaction -q -f "$f"
  fi
  echo "::endgroup::"
done
echo "catalog seeds applied: ${#files[@]} files"
