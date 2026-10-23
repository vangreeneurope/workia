# Utilidades para trabajar con un PostgreSQL desechable (sourced, no ejecutable).
#
# Por defecto levanta un clúster temporal con el PostgreSQL instalado en local.
# Con TEST_DB_EXTERNAL=1 usa un servidor existente descrito por las variables
# estándar de libpq (PGHOST, PGPORT, PGUSER, PGPASSWORD), por ejemplo un
# servicio postgres en CI. El usuario debe poder crear bases de datos y roles.
# Nunca apuntes a un servidor con datos reales: se crean y borran bases.

PG_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_MIGRATIONS="$PG_ROOT/supabase/migrations"
PG_TESTS="$PG_ROOT/supabase/tests"
PG_ROLLBACKS="$PG_ROOT/supabase/rollbacks"
PG_WORKDIR=""
PG_RUN_AS=()

pg_start() {
  if [[ "${TEST_DB_EXTERNAL:-}" == "1" ]]; then
    : "${PGHOST:?Define PGHOST}" "${PGUSER:?Define PGUSER}"
    export PGDATABASE="${PGDATABASE:-postgres}"
    return
  fi

  local pg_bin
  pg_bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  if [[ -z "$pg_bin" ]]; then
    pg_bin="$(dirname "$(command -v initdb || echo /nonexistent/initdb)")"
  fi
  if [[ ! -x "$pg_bin/initdb" ]]; then
    echo "No se encontró PostgreSQL local. Instálalo o usa TEST_DB_EXTERNAL=1 con PGHOST/PGUSER." >&2
    exit 1
  fi

  PG_WORKDIR="$(mktemp -d)"
  local port="${TEST_DB_PORT:-54329}"
  if [[ "$(id -u)" -eq 0 ]]; then
    # PostgreSQL no arranca como root.
    chown postgres "$PG_WORKDIR"
    PG_RUN_AS=(runuser -u postgres --)
  fi
  PG_BIN="$pg_bin"
  trap pg_stop EXIT

  "${PG_RUN_AS[@]}" "$pg_bin/initdb" -D "$PG_WORKDIR/data" -U postgres -A trust >/dev/null
  "${PG_RUN_AS[@]}" "$pg_bin/pg_ctl" -D "$PG_WORKDIR/data" \
    -o "-p $port -k $PG_WORKDIR -c listen_addresses=''" -l "$PG_WORKDIR/log" -w start >/dev/null

  export PGHOST="$PG_WORKDIR" PGPORT="$port" PGUSER=postgres PGDATABASE=postgres
}

pg_stop() {
  if [[ -n "$PG_WORKDIR" ]]; then
    "${PG_RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$PG_WORKDIR/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$PG_WORKDIR"
  fi
}

# psql silencioso que se detiene ante el primer error. Uso: pg_sql <base> [args...]
pg_sql() {
  local db="$1"
  shift
  psql -d "$db" -v ON_ERROR_STOP=1 -q -X "$@"
}

pg_recreate_db() {
  local db="$1" template="${2:-template0}"
  PGOPTIONS="-c client_min_messages=warning" pg_sql postgres -c "drop database if exists \"$db\"" -c "create database \"$db\" template \"$template\""
}

pg_drop_db() {
  PGOPTIONS="-c client_min_messages=warning" pg_sql postgres -c "drop database if exists \"$1\""
}

# Aplica la emulación de Supabase y todas las migraciones (o las N primeras).
pg_apply_migrations() {
  local db="$1" limit="${2:-}" count=0
  pg_sql "$db" -f "$PG_TESTS/00_shim_supabase.sql"
  for file in "$PG_MIGRATIONS"/*.sql; do
    if [[ -n "$limit" && "$count" -ge "$limit" ]]; then break; fi
    pg_sql "$db" -f "$file"
    count=$((count + 1))
  done
}

pg_snapshot() {
  pg_sql "$1" -At -f "$PG_TESTS/helpers/schema_snapshot.sql"
}
