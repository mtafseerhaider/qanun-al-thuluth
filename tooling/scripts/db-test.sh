#!/usr/bin/env bash
# tooling/scripts/db-test.sh
#
# Apply every migration + seed and run the pgTAP suite in supabase/tests/database.
#
# Modes (DB_TEST_MODE):
#   auto      (default) "supabase" when the Supabase CLI is on PATH (or node_modules/.bin) and
#             Docker answers; otherwise "plain".
#   supabase  supabase start (if needed) -> supabase db reset -> supabase test db
#   plain     throwaway vanilla PostgreSQL cluster in a temp dir:
#             initdb -> tooling/scripts/pg-stubs/supabase-stubs.sql (auth schema, roles, JWT
#             helpers) -> supabase/migrations/*.sql in order -> seeds in config.toml order ->
#             pg_prove. Needs PostgreSQL server binaries (16+), pg_cron, pgvector, pgTAP and pg_prove
#             (Debian/Ubuntu: postgresql-16 postgresql-16-cron postgresql-16-pgvector postgresql-16-pgtap
#             libtap-parser-sourcehandler-pgtap-perl).
#
# Other env:
#   PG_BIN        directory with initdb/pg_ctl/postgres (plain mode; auto-detected)
#   PGTEST_PORT   port for the throwaway cluster (plain mode; default 54339)
#   KEEP_DB=1     leave the plain-mode cluster running and print its connection string
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUPABASE_DIR="$ROOT/supabase"
TESTS_DIR="$SUPABASE_DIR/tests/database"
STUBS="$ROOT/tooling/scripts/pg-stubs/supabase-stubs.sql"
MODE="${DB_TEST_MODE:-auto}"

log() { printf '\033[1;34m[db-test]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[db-test]\033[0m %s\n' "$*" >&2; exit 1; }

find_supabase_cli() {
  if command -v supabase >/dev/null 2>&1; then
    command -v supabase
  elif [ -x "$ROOT/node_modules/.bin/supabase" ]; then
    echo "$ROOT/node_modules/.bin/supabase"
  fi
}

if [ "$MODE" = "auto" ]; then
  if [ -n "$(find_supabase_cli)" ] && docker info >/dev/null 2>&1; then
    MODE=supabase
  else
    MODE=plain
  fi
fi

# --------------------------------------------------------------------------------------------
run_supabase() {
  local sb
  sb="$(find_supabase_cli)"
  [ -n "$sb" ] || die "Supabase CLI not found (install it or use DB_TEST_MODE=plain)"
  cd "$ROOT"
  if ! "$sb" status >/dev/null 2>&1; then
    log "starting local Supabase stack"
    "$sb" start || die "supabase start failed (images unreachable?). Retry with DB_TEST_MODE=plain"
  fi
  log "supabase db reset (migrations + seeds)"
  "$sb" db reset
  log "supabase test db"
  "$sb" test db
}

# --------------------------------------------------------------------------------------------
detect_pg_bin() {
  if [ -n "${PG_BIN:-}" ]; then echo "$PG_BIN"; return; fi
  if command -v pg_config >/dev/null 2>&1 && [ -x "$(pg_config --bindir)/initdb" ]; then
    pg_config --bindir; return
  fi
  local d
  for d in $(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V -r); do
    if [ -x "$d/initdb" ]; then echo "$d"; return; fi
  done
}

# Seed files in the order of [db.seed] sql_paths in supabase/config.toml.
seed_files() {
  local pattern f
  sed -n '/^\[db\.seed\]/,/^\[/p' "$SUPABASE_DIR/config.toml" \
    | grep -E '^\s*sql_paths' \
    | grep -oE '"[^"]+"' | tr -d '"' \
    | while read -r pattern; do
        # shellcheck disable=SC2086
        for f in $(cd "$SUPABASE_DIR" && ls -1 $pattern 2>/dev/null | sort); do
          echo "$SUPABASE_DIR/${f#./}"
        done
      done
}

# Globals so the EXIT trap can see them after run_plain returns.
PLAIN_BIN="" PLAIN_TMP="" PLAIN_DATA="" PLAIN_PORT=""
cleanup_plain() {
  [ -n "$PLAIN_TMP" ] || return 0
  if [ "${KEEP_DB:-0}" = "1" ]; then
    log "KEEP_DB=1: cluster left running: postgresql://postgres@/postgres?host=$PLAIN_TMP&port=$PLAIN_PORT"
    return 0
  fi
  "$PLAIN_BIN/pg_ctl" -D "$PLAIN_DATA" -m immediate stop >/dev/null 2>&1 \
    || runuser -u postgres -- "$PLAIN_BIN/pg_ctl" -D "$PLAIN_DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$PLAIN_TMP"
}

run_plain() {
  local bin port tmp data psql_cmd f
  bin="$(detect_pg_bin)"
  [ -n "$bin" ] || die "PostgreSQL server binaries not found (set PG_BIN)"
  command -v pg_prove >/dev/null 2>&1 || die "pg_prove not found (apt-get install libtap-parser-sourcehandler-pgtap-perl)"
  port="${PGTEST_PORT:-54339}"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/thuluth-pgtest.XXXXXX")"
  data="$tmp/data"

  PLAIN_BIN="$bin" PLAIN_TMP="$tmp" PLAIN_DATA="$data" PLAIN_PORT="$port"
  trap cleanup_plain EXIT

  log "initdb in $tmp (PostgreSQL $("$bin/postgres" --version | awk '{print $3}'))"
  # initdb refuses to run as root; use the postgres OS user when we are root.
  local as=()
  if [ "$(id -u)" = "0" ]; then
    id postgres >/dev/null 2>&1 || die "running as root needs an OS user 'postgres'"
    chown -R postgres "$tmp"
    as=(runuser -u postgres --)
  fi
  "${as[@]}" "$bin/initdb" -D "$data" -U postgres -A trust --no-sync -E UTF8 --locale=C.UTF-8 >/dev/null
  cat >> "$data/postgresql.conf" <<CONF
listen_addresses = ''
port = $port
unix_socket_directories = '$tmp'
shared_preload_libraries = 'pg_cron'
cron.database_name = 'postgres'
search_path = '"\$user", public, extensions'
fsync = off
synchronous_commit = off
full_page_writes = off
timezone = 'UTC'
CONF
  "${as[@]}" "$bin/pg_ctl" -D "$data" -l "$tmp/postgres.log" -w start >/dev/null \
    || { cat "$tmp/postgres.log" >&2; die "postgres failed to start"; }

  export PGHOST="$tmp" PGPORT="$port" PGUSER=postgres PGDATABASE=postgres
  psql_cmd=(psql -X -q -v ON_ERROR_STOP=1 --set=SHOW_CONTEXT=errors)

  log "applying Supabase stubs"
  "${psql_cmd[@]}" -f "$STUBS" >/dev/null

  log "applying migrations"
  for f in "$SUPABASE_DIR"/migrations/*.sql; do
    log "  $(basename "$f")"
    "${psql_cmd[@]}" -1 -f "$f" >/dev/null
  done

  log "applying seeds"
  while read -r f; do
    [ -n "$f" ] || continue
    log "  ${f#"$SUPABASE_DIR"/}"
    "${psql_cmd[@]}" -1 -f "$f" >/dev/null
  done < <(seed_files)

  log "running pgTAP suite"
  pg_prove --ext .sql -r "$TESTS_DIR"
}

case "$MODE" in
  supabase) run_supabase ;;
  plain)    run_plain ;;
  *)        die "unknown DB_TEST_MODE '$MODE' (auto|supabase|plain)" ;;
esac
