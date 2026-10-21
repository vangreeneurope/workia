#!/usr/bin/env bash
# Pruebas de base de datos:
#   1. Aplica la emulación mínima de Supabase y todas las migraciones.
#   2. Ejecuta cada supabase/tests/NN_*.test.sql en una base nueva clonada de
#      esa plantilla (las pruebas no se contaminan entre sí).
#   3. Comprueba la reversibilidad: cada script de supabase/rollbacks/ debe
#      dejar el esquema idéntico al anterior a su migración, y volver a aplicar
#      las migraciones debe reproducir el esquema completo.
#
# Uso:
#   npm run test:db                         # clúster temporal local (PostgreSQL >= 15)
#   TEST_DB_EXTERNAL=1 PGHOST=... PGUSER=... npm run test:db   # servidor desechable (CI)
set -euo pipefail

source "$(dirname "$0")/lib/pg-temp.sh"
pg_start

echo "> Plantilla: emulación de Supabase + migraciones"
pg_recreate_db tpl_migrated
pg_apply_migrations tpl_migrated

failures=0
for file in "$PG_TESTS"/[1-9]*.test.sql; do
  name="$(basename "$file" .test.sql)"
  echo "> Pruebas $name"
  pg_recreate_db "t_$name" tpl_migrated
  if ! pg_sql "t_$name" -o /dev/null -f "$file" 2>&1 \
    | sed -e 's/^psql:[^ ]* NOTICE:  /  /' -e 's/^NOTICE:  /  /'; then
    failures=$((failures + 1))
  fi
  pg_drop_db "t_$name"
done
if [[ "$failures" -ne 0 ]]; then
  echo "Han fallado pruebas de base de datos." >&2
  exit 1
fi

echo "> Reversibilidad de migraciones"
mapfile -t migrations < <(ls "$PG_MIGRATIONS"/*.sql)
total=${#migrations[@]}
snapdir="$(mktemp -d)"

# Foto del esquema tras aplicar 0..total migraciones.
pg_recreate_db rev_steps
pg_sql rev_steps -f "$PG_TESTS/00_shim_supabase.sql"
pg_snapshot rev_steps >"$snapdir/0.txt"
for i in $(seq 1 "$total"); do
  pg_sql rev_steps -f "${migrations[$((i - 1))]}"
  pg_snapshot rev_steps >"$snapdir/$i.txt"
done
pg_drop_db rev_steps

# Reversión hacia atrás mientras haya scripts de rollback.
pg_recreate_db rev_down tpl_migrated
first_reverted=$total
for ((i = total; i >= 1; i--)); do
  migration="${migrations[$((i - 1))]}"
  rollback="$PG_ROLLBACKS/$(basename "$migration" .sql).down.sql"
  [[ -f "$rollback" ]] || break
  pg_sql rev_down -f "$rollback"
  if ! diff -u "$snapdir/$((i - 1)).txt" <(pg_snapshot rev_down) >"$snapdir/diff.txt"; then
    echo "La reversión de $(basename "$migration") no restaura el esquema anterior:" >&2
    cat "$snapdir/diff.txt" >&2
    exit 1
  fi
  echo "  ok - $(basename "$rollback") restaura el esquema anterior"
  first_reverted=$((i - 1))
done

# Volver a aplicar las migraciones revertidas reproduce el esquema completo.
for ((i = first_reverted + 1; i <= total; i++)); do
  pg_sql rev_down -f "${migrations[$((i - 1))]}"
done
if ! diff -u "$snapdir/$total.txt" <(pg_snapshot rev_down) >"$snapdir/diff.txt"; then
  echo "Reaplicar las migraciones tras revertirlas no reproduce el esquema:" >&2
  cat "$snapdir/diff.txt" >&2
  exit 1
fi
echo "  ok - reaplicar tras revertir reproduce el esquema completo"
pg_drop_db rev_down
rm -rf "$snapdir"

# Con datos, las reversiones se niegan a perderlos salvo autorización explícita.
pg_recreate_db rev_guard tpl_migrated
pg_sql rev_guard -o /dev/null -f "$PG_TESTS/helpers/asserts.sql" -f "$PG_TESTS/helpers/fixtures.sql" 2>/dev/null
for ((i = total; i >= 1; i--)); do
  rollback="$PG_ROLLBACKS/$(basename "${migrations[$((i - 1))]}" .sql).down.sql"
  [[ -f "$rollback" ]] || break
  if pg_sql rev_guard -f "$rollback" >/dev/null 2>&1; then
    echo "$(basename "$rollback") ha borrado datos sin app.allow_lossy_rollback" >&2
    exit 1
  fi
  PGOPTIONS="-c app.allow_lossy_rollback=on" pg_sql rev_guard -f "$rollback" >/dev/null
  echo "  ok - $(basename "$rollback") exige autorización para perder datos"
done
pg_drop_db rev_guard

echo "Todas las pruebas de base de datos han pasado."
