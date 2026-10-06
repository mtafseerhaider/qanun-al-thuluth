#!/usr/bin/env bash
# tooling/scripts/gen-db-types.sh
#
# Regenerate packages/shared/src/db/database.types.ts without Docker: runs the postgres-meta type
# generator (the same generator `supabase gen types typescript` runs in its container) against a
# migrated database, drops the analytics_events partition tables (their names change every month,
# so they would make the committed file drift; clients never touch them) and formats with the repo
# Prettier config.
#
# Usage:
#   KEEP_DB=1 DB_TEST_MODE=plain bash tooling/scripts/db-test.sh      # prints the connection string
#   PG_META_DB_URL='postgresql://postgres@%2Ftmp%2Fthuluth-pgtest.XXXX:54339/postgres' \
#     bash tooling/scripts/gen-db-types.sh
#
# Env:
#   PG_META_DB_URL   connection string of the migrated database (required)
#   PG_META_DIR      directory with node_modules/@supabase/postgres-meta (default: a temp dir,
#                    installed with npm on first use)
#   PG_META_VERSION  postgres-meta version to install (default 0.99.0)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/packages/shared/src/db/database.types.ts"
: "${PG_META_DB_URL:?set PG_META_DB_URL to the migrated database}"
VERSION="${PG_META_VERSION:-0.99.0}"
DIR="${PG_META_DIR:-${TMPDIR:-/tmp}/thuluth-pg-meta-$VERSION}"

if [ ! -f "$DIR/node_modules/@supabase/postgres-meta/dist/server/server.js" ]; then
  mkdir -p "$DIR"
  (cd "$DIR" && npm init -y >/dev/null && npm install --ignore-scripts --no-audit --no-fund "@supabase/postgres-meta@$VERSION" >/dev/null)
fi

RAW="$(mktemp)"
trap 'rm -f "$RAW"' EXIT
PG_META_GENERATE_TYPES=typescript \
PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public \
PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true \
PG_META_POSTGREST_VERSION="${PG_META_POSTGREST_VERSION:-16.4}" \
  node "$DIR/node_modules/@supabase/postgres-meta/dist/server/server.js" > "$RAW" 2>/dev/null

# Drop the partition tables: a 6-space-indented key "analytics_events_default" or
# "analytics_events_yYYYYmMM" through its closing "      }".
python3 -I - "$RAW" "$OUT" <<'PY'
import re, sys
src, out = sys.argv[1], sys.argv[2]
lines = open(src, encoding='utf-8').read().split('\n')
keep, skipping = [], False
pat = re.compile(r'^      analytics_events_(default|y\d{4}m\d{2}): \{$')
for line in lines:
    if not skipping and pat.match(line):
        skipping = True
        continue
    if skipping:
        if line == '      }':
            skipping = False
        continue
    keep.append(line)
open(out, 'w', encoding='utf-8').write('\n'.join(keep))
PY

# the file is in .prettierignore (generated); format it explicitly with the repo config
"$ROOT/node_modules/.bin/prettier" --ignore-path=/dev/null --write "$OUT" >/dev/null
echo "wrote $OUT"
