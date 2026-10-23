#!/usr/bin/env bash
# Pruebas adversarias de aislamiento sobre una base POBLADA (auditoría QA,
# docs/qa/QA_REPORT.md). Aplica las migraciones, carga el escenario de pruebas
# y ejecuta los escenarios de todas las pruebas de dominio en una misma base
# (datos de las empresas A, B y C en casi todas las tablas), y después:
#   1. barrido de lectura entre empresas en todas las tablas y Storage;
#   2. ataque a todas las funciones SECURITY DEFINER con ids de otra empresa;
#   3. escrituras directas (UPDATE/INSERT) contra filas de otra empresa;
#   4. Storage: crear, sobrescribir y borrar objetos ajenos.
# Cada arnés falla si detecta una fuga o si su control positivo no funciona.
#
# Uso: npm run test:aislamiento   (PostgreSQL local o TEST_DB_EXTERNAL=1)
set -euo pipefail

export TEST_DB_PORT="${ISOLATION_DB_PORT:-54359}"
source "$(dirname "$0")/lib/pg-temp.sh"
pg_start
work="$(mktemp -d)"
trap 'rm -rf "$work"; pg_stop' EXIT
if [[ ${#PG_RUN_AS[@]} -gt 0 ]]; then chown postgres "$work"; fi

echo "> Base poblada: migraciones, escenario y escenarios de dominio"
pg_recreate_db iso
pg_apply_migrations iso
pg_sql iso -o /dev/null -f "$PG_TESTS/helpers/asserts.sql" -f "$PG_TESTS/helpers/fixtures.sql" 2>/dev/null
for name in 40_administracion 50_horarios 60_control_horario 70_ausencias 80_gastos 90_liquidacion \
  95_avisos 96_informes 98_privacidad; do
  # Sin \ir (escenario ya cargado) y sin detenerse: solo interesan los datos que dejan.
  { echo '\set ON_ERROR_STOP off'; grep -v '^\\ir ' "$PG_TESTS/$name.test.sql"; } >"$work/$name.sql"
  pg_sql iso -o /dev/null -v ON_ERROR_STOP=0 -f "$work/$name.sql" >/dev/null 2>&1 || true
done
pg_sql iso -At -c "select '  tablas de public con datos: ' || count(*) filter (where n > 0) || ' de ' || count(*) from (
  select (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text::int n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r') x"

for harness in barrido_aislamiento fuzz_funciones fuzz_escrituras fuzz_storage conciliacion; do
  echo "> $harness"
  pg_recreate_db iso_run iso
  pg_sql iso_run -f "$PG_TESTS/qa/$harness.sql" 2>&1 | grep -vE '^(NOTICE|psql:.*NOTICE)' | sed 's/^/  /'
  pg_drop_db iso_run
done
echo "Pruebas adversarias de aislamiento superadas."
