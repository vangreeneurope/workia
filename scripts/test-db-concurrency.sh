#!/usr/bin/env bash
# Concurrencia real del fichaje (sourced desde scripts/test-db.sh, con el
# servidor ya arrancado y la base plantilla tpl_migrated creada).
#
# Dos sesiones de PostgreSQL a la vez. La primera mantiene su transacción
# abierta 2 s después de fichar; la segunda llega mientras tanto.
#   1. Misma clave (reintento simultáneo): un solo fichaje y la segunda
#      sesión recibe el mismo resultado marcado como duplicado.
#   2. Distinta clave (doble toque): se registra una entrada y la otra se
#      rechaza sin dejar dos jornadas abiertas.
#   3. Aplicación y terminal a la vez para la misma persona: uno gana.

concurrency_session() {
  # $1 = base, $2 = usuario (uuid), $3 = sentencia, $4 = segundos de espera antes de confirmar
  pg_sql "$1" -At <<SQL 2>&1
begin;
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '$2', 'role', 'authenticated')::text, true);
$3;
select pg_sleep($4);
commit;
SQL
}

run_concurrency_tests() {
  local db=t_concurrencia out_a out_b company=aaaaaaaa-0000-0000-0000-000000000001
  echo "> Pruebas de concurrencia (dos sesiones simultáneas)"
  pg_recreate_db "$db" tpl_migrated
  pg_sql "$db" -o /dev/null -f "$PG_TESTS/helpers/asserts.sql" -f "$PG_TESTS/helpers/fixtures.sql" 2>/dev/null

  local key=7c000000-0000-4000-8000-000000000001
  out_a="$(mktemp)"; out_b="$(mktemp)"
  concurrency_session "$db" 00000000-0000-0000-0000-000000000007 \
    "select public.record_punch('$company', 'start', '$key', 'mobile') ->> 'duplicate'" 2 >"$out_a" &
  sleep 0.5
  concurrency_session "$db" 00000000-0000-0000-0000-000000000007 \
    "select public.record_punch('$company', 'start', '$key', 'mobile') ->> 'duplicate'" 0 >"$out_b"
  wait
  local n
  n="$(pg_sql "$db" -At -c "select count(*) from public.punches where idempotency_key = '$key'")"
  if [[ "$n" != "1" ]] || ! grep -qx "false" "$out_a" || ! grep -qx "true" "$out_b"; then
    echo "FALLO: misma clave en paralelo (fichajes=$n)" >&2; cat "$out_a" "$out_b" >&2; return 1
  fi
  echo "  ok - Misma clave en dos sesiones simultáneas: un solo fichaje; la segunda recibe el duplicado"

  concurrency_session "$db" 00000000-0000-0000-0000-000000000008 \
    "select public.record_punch('$company', 'start', '7c000000-0000-4000-8000-000000000002', 'mobile') ->> 'status'" 2 >"$out_a" &
  sleep 0.5
  concurrency_session "$db" 00000000-0000-0000-0000-000000000008 \
    "select public.record_punch('$company', 'start', '7c000000-0000-4000-8000-000000000003', 'web') ->> 'status'" 0 >"$out_b"
  wait
  n="$(pg_sql "$db" -At -c "select count(*) || '/' || (select count(*) from public.time_entries where employee_id = 'e0000000-0000-0000-0000-000000000008') from public.punches where employee_id = 'e0000000-0000-0000-0000-000000000008'")"
  if [[ "$n" != "1/1" ]] || ! grep -qx "open" "$out_a" || ! grep -q "Ya tienes una jornada abierta" "$out_b"; then
    echo "FALLO: doble toque en paralelo (fichajes/jornadas=$n)" >&2; cat "$out_a" "$out_b" >&2; return 1
  fi
  echo "  ok - Doble toque en dos sesiones: una entrada registrada, la otra rechazada, una sola jornada"

  # Aplicación (E1 ya tiene jornada abierta) y terminal a la vez: pausa desde ambos.
  local token
  token="$(pg_sql "$db" -At <<'SQL'
set role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000004", "role": "authenticated"}', false);
select public.register_kiosk_device('a1000000-0000-0000-0000-000000000001', 'Terminal de prueba');
SQL
)"
  token="$(tail -1 <<<"$token")"
  pg_sql "$db" -At -o /dev/null <<'SQL'
set role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000007", "role": "authenticated"}', false);
select public.set_my_kiosk_pin('aaaaaaaa-0000-0000-0000-000000000001', '482913');
SQL
  concurrency_session "$db" 00000000-0000-0000-0000-000000000007 \
    "select public.record_punch('$company', 'break_start', '7c000000-0000-4000-8000-000000000004', 'mobile') ->> 'status'" 2 >"$out_a" &
  sleep 0.5
  pg_sql "$db" -At -c "set role anon; select public.kiosk_punch('$token', 'A-007', '482913', 'break_start', '7c000000-0000-4000-8000-000000000005') ->> 'status'" >"$out_b" 2>&1
  wait
  n="$(pg_sql "$db" -At -c "select count(*) from public.punches where employee_id = 'e0000000-0000-0000-0000-000000000007' and kind = 'break_start'")"
  if [[ "$n" != "1" ]] || ! grep -qx "on_break" "$out_a" || ! grep -qx "rejected" "$out_b"; then
    echo "FALLO: aplicación y terminal en paralelo (pausas=$n)" >&2; cat "$out_a" "$out_b" >&2; return 1
  fi
  echo "  ok - Aplicación y terminal a la vez: una pausa registrada y la otra rechazada"
  rm -f "$out_a" "$out_b"
  pg_drop_db "$db"
}
