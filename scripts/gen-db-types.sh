#!/usr/bin/env bash
# Genera (o comprueba con --check) src/types/database.ts desde las migraciones,
# usando un PostgreSQL desechable. Ver scripts/lib/pg-temp.sh para usar un
# servidor externo (TEST_DB_EXTERNAL=1).
set -euo pipefail

source "$(dirname "$0")/lib/pg-temp.sh"
pg_start
pg_recreate_db db_types >/dev/null 2>&1
pg_apply_migrations db_types 2>/dev/null
node "$PG_ROOT/scripts/gen-db-types.mjs" db_types "$@"
pg_drop_db db_types >/dev/null 2>&1
