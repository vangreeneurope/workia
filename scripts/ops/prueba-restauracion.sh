#!/usr/bin/env bash
# Prueba de copia y restauración de PostgreSQL (docs/COPIAS_Y_RESTAURACION.md).
#
# Ensayo LOCAL y con datos SINTÉTICOS del procedimiento lógico: crea una base con
# todas las migraciones y las semillas, la copia con pg_dump (formato custom),
# la restaura en una base nueva con pg_restore y comprueba que:
#   1. el esquema restaurado es idéntico (instantánea del catálogo),
#   2. los recuentos de control por tabla coinciden,
#   3. el escáner de seguridad del catálogo (97) pasa en la base restaurada.
# Mide los tiempos. NO prueba la restauración en Supabase (PITR o copia diaria
# desde el panel) ni Storage: eso es el procedimiento de docs/COPIAS_Y_RESTAURACION.md.
#
# Uso: npm run ops:prueba-restauracion   (PostgreSQL local, como npm run test:db)
set -euo pipefail

export TEST_DB_PORT="${RESTORE_DB_PORT:-54349}"
source "$(dirname "$0")/../lib/pg-temp.sh"
pg_start
work="$(mktemp -d)"
trap 'rm -rf "$work"; pg_stop' EXIT
# pg_dump y pg_restore corren como el usuario del clúster temporal.
if [[ ${#PG_RUN_AS[@]} -gt 0 ]]; then chown postgres "$work"; fi
bin="${PG_BIN:-$(dirname "$(command -v pg_dump)")}"

# pg_dump no emite una ACL igual a la del propietario por defecto; al restaurar
# queda NULL (mismos permisos efectivos: el propietario todos, nadie más ninguno).
# Solo se normaliza ese caso exacto; cualquier otra diferencia hace fallar la prueba.
OWNER_ACL='acl=postgres:INSERT,postgres:SELECT,postgres:UPDATE,postgres:DELETE,postgres:TRUNCATE,postgres:REFERENCES,postgres:TRIGGER$'
snapshot() { pg_snapshot "$1" | sed -E "s/ ${OWNER_ACL}/ acl=/"; }

control_counts() {
  pg_sql "$1" -At -c "
    select format('%s.%s=%s', n.nspname, c.relname,
      (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('public', 'private', 'auth', 'storage')
    order by 1"
}

echo "> Origen: migraciones y semillas sintéticas"
pg_recreate_db origen
pg_apply_migrations origen
pg_sql origen -o /dev/null -f "$PG_ROOT/supabase/seeds/01_demo_sintetico.sql"
control_counts origen >"$work/origen.counts"
snapshot origen >"$work/origen.schema"

echo "> Copia lógica (pg_dump, formato custom)"
t0=$(date +%s%N)
"${PG_RUN_AS[@]}" "$bin/pg_dump" -h "$PGHOST" -p "$PGPORT" -U postgres -Fc -d origen -f "$work/copia.dump"
t1=$(date +%s%N)
bytes=$(stat -c %s "$work/copia.dump")

echo "> Restauración en una base nueva (pg_restore)"
pg_recreate_db restaurada
"${PG_RUN_AS[@]}" "$bin/pg_restore" -h "$PGHOST" -p "$PGPORT" -U postgres -d restaurada --exit-on-error "$work/copia.dump"
t2=$(date +%s%N)

echo "> Comprobaciones"
diff -u "$work/origen.schema" <(snapshot restaurada) >"$work/schema.diff" || {
  echo "El esquema restaurado no coincide:" >&2
  cat "$work/schema.diff" >&2
  exit 1
}
echo "  ok - esquema idéntico (ACL por defecto del propietario normalizada)"
diff -u "$work/origen.counts" <(control_counts restaurada) >"$work/counts.diff" || {
  echo "Los recuentos de control no coinciden:" >&2
  cat "$work/counts.diff" >&2
  exit 1
}
echo "  ok - recuentos de control idénticos ($(wc -l <"$work/origen.counts") tablas, $(awk -F= '{s+=$2} END {print s}' "$work/origen.counts") filas)"
pg_sql restaurada -o /dev/null -f "$PG_TESTS/97_seguridad_catalogo.test.sql" 2>&1 \
  | sed -e 's/^psql:[^ ]* NOTICE:  /  /' -e 's/^NOTICE:  /  /' | grep -c "ok - " \
  | xargs -I{} echo "  ok - escáner de catálogo en la base restaurada ({} comprobaciones)"

printf '> Tiempos: copia %d ms (%d KB), restauración %d ms\n' \
  $(((t1 - t0) / 1000000)) $((bytes / 1024)) $(((t2 - t1) / 1000000))
echo "Prueba de restauración local superada ($(date -u +%Y-%m-%dT%H:%M:%SZ))."
