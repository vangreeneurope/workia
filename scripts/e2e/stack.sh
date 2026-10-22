#!/usr/bin/env bash
# Entorno E2E con sesión (SOLO PRUEBAS): PostgreSQL desechable con todas las
# migraciones y las semillas sintéticas, PostgREST real (RLS real) y la pasarela
# de pruebas que simula Auth y Storage (scripts/e2e/gateway.mjs). Lo arranca
# Playwright (playwright.config.ts) y se detiene con él.
#
# PostgREST se descarga una vez (versión fija y huella SHA-256 comprobada) en
# ${E2E_CACHE:-$HOME/.cache/portal-e2e}.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export TEST_DB_PORT="${E2E_DB_PORT:-54339}"
source "$ROOT/scripts/lib/pg-temp.sh"

POSTGREST_VERSION="12.2.3"
POSTGREST_SHA256="870a77f49508479bc87c5504b6b0c3715c7220926932d916b0d73952b297c617"
CACHE="${E2E_CACHE:-$HOME/.cache/portal-e2e}"
POSTGREST_BIN="$CACHE/postgrest-$POSTGREST_VERSION"

if [[ ! -x "$POSTGREST_BIN" ]]; then
  mkdir -p "$CACHE"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/postgrest.tar.xz" \
    "https://github.com/PostgREST/postgrest/releases/download/v$POSTGREST_VERSION/postgrest-v$POSTGREST_VERSION-linux-static-x64.tar.xz"
  tar -xJf "$tmp/postgrest.tar.xz" -C "$tmp"
  echo "$POSTGREST_SHA256  $tmp/postgrest" | sha256sum -c --quiet
  mv "$tmp/postgrest" "$POSTGREST_BIN"
  rm -rf "$tmp"
fi

pg_start
pg_recreate_db e2e
pg_apply_migrations e2e
pg_sql e2e -o /dev/null -f "$ROOT/supabase/seeds/01_demo_sintetico.sql"
pg_sql e2e -o /dev/null -f "$ROOT/tests/e2e/fixtures/stack.sql"

export E2E_JWT_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '/+=' | head -c 48)"
PGRST_DB_URI="postgres://authenticator@/e2e?host=$PGHOST&port=$PGPORT" \
  PGRST_DB_ANON_ROLE=anon PGRST_DB_SCHEMAS="public,storage" PGRST_JWT_SECRET="$E2E_JWT_SECRET" \
  PGRST_SERVER_PORT="${E2E_POSTGREST_PORT:-54322}" PGRST_SERVER_HOST=127.0.0.1 PGRST_LOG_LEVEL=crit \
  "$POSTGREST_BIN" &
POSTGREST_PID=$!

cleanup() {
  kill "$POSTGREST_PID" 2>/dev/null || true
  pg_stop
}
trap cleanup EXIT
trap 'exit 0' TERM INT

E2E_POSTGREST_URL="http://127.0.0.1:${E2E_POSTGREST_PORT:-54322}" node "$ROOT/scripts/e2e/gateway.mjs" &
wait $!
