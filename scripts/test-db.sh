#!/usr/bin/env bash
# Ejecuta las migraciones y las pruebas de RLS sobre una base PostgreSQL desechable.
#
# Uso:
#   npm run test:db                       # levanta un clúster temporal (requiere PostgreSQL >= 15 local)
#   TEST_DATABASE_URL=postgres://... npm run test:db   # usa una base vacía existente (¡se modifica!)
#
# No apuntes TEST_DATABASE_URL a una base con datos reales.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
TESTS="$ROOT/supabase/tests"

run_suite() {
  local url="$1"
  local psql_cmd=(psql "$url" -v ON_ERROR_STOP=1 -q -X)
  echo "> Emulación mínima de Supabase"
  "${psql_cmd[@]}" -f "$TESTS/00_shim_supabase.sql"
  for file in "$MIGRATIONS"/*.sql; do
    echo "> Migración $(basename "$file")"
    "${psql_cmd[@]}" -f "$file"
  done
  for file in "$TESTS"/[1-9]*.test.sql; do
    echo "> Pruebas $(basename "$file")"
    "${psql_cmd[@]}" -o /dev/null -f "$file" 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  /  /' -e 's/^NOTICE:  /  /'
    test "${PIPESTATUS[0]}" -eq 0
  done
}

if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  run_suite "$TEST_DATABASE_URL"
  exit 0
fi

PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [[ -z "$PG_BIN" ]]; then
  PG_BIN="$(dirname "$(command -v initdb || true)")"
fi
if [[ ! -x "$PG_BIN/initdb" ]]; then
  echo "No se encontró PostgreSQL local. Define TEST_DATABASE_URL o instala PostgreSQL." >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
PORT="${TEST_DB_PORT:-54329}"
RUN_AS=()
if [[ "$(id -u)" -eq 0 ]]; then
  # PostgreSQL no arranca como root.
  chown postgres "$WORKDIR"
  RUN_AS=(runuser -u postgres --)
fi

cleanup() {
  "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORKDIR/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$WORKDIR/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$WORKDIR/data" -o "-p $PORT -k $WORKDIR -c listen_addresses=''" -l "$WORKDIR/log" -w start >/dev/null

run_suite "postgresql://postgres@/postgres?host=$WORKDIR&port=$PORT"
