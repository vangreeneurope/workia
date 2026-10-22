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
#   4. Dos solicitudes de vacaciones a la vez que solo caben de una en una:
#      una reserva el saldo y la otra se rechaza (nunca saldo consumido dos veces).
#   5. Mismo ticket registrado dos veces a la vez (reintento): un solo gasto.
#   6. Dos sesiones reclaman a la vez el mismo trabajo de OCR: una sola ejecución.

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

  # Saldo de 6 medios días; cada solicitud pide 2 días (4 medios días).
  local monday
  monday="$(pg_sql "$db" -At <<'SQL'
insert into public.absence_types (id, company_id, code, name, allowed_units, uses_balance)
values ('7f000000-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'VACC', 'Vacaciones', '{day}', true);
insert into public.vacation_policies (id, company_id, absence_type_id, code, name)
values ('7a000000-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001',
  '7f000000-0000-4000-8000-0000000000c1', 'PVC', 'Vacaciones');
insert into public.vacation_policy_versions (company_id, policy_id, version, entitlement, proration)
values ('aaaaaaaa-0000-0000-0000-000000000001', '7a000000-0000-4000-8000-0000000000c1', 1, 6, 'none');
update public.vacation_policy_versions set status = 'published', valid_from = '2025-01-01', published_at = now()
where policy_id = '7a000000-0000-4000-8000-0000000000c1';
insert into public.policy_assignments (company_id, policy_id, absence_type_id, scope_type, valid_from)
values ('aaaaaaaa-0000-0000-0000-000000000001', '7a000000-0000-4000-8000-0000000000c1',
  '7f000000-0000-4000-8000-0000000000c1', 'company', (now() at time zone 'Europe/Madrid')::date);
select case when extract(year from m) <> extract(year from m + 4) then m + 7 else m end
from (select d + (8 - extract(isodow from d)::int) + 14 as m from (select (now() at time zone 'Europe/Madrid')::date as d) x) y;
SQL
)"
  monday="$(tail -1 <<<"$monday")"
  concurrency_session "$db" 00000000-0000-0000-0000-000000000007 \
    "select public.submit_absence_request('$company', '7f000000-0000-4000-8000-0000000000c1', 'day', date '$monday', date '$monday' + 1, '7c000000-0000-4000-8000-000000000010') ->> 'status'" 2 >"$out_a" &
  sleep 0.5
  concurrency_session "$db" 00000000-0000-0000-0000-000000000007 \
    "select public.submit_absence_request('$company', '7f000000-0000-4000-8000-0000000000c1', 'day', date '$monday' + 3, date '$monday' + 4, '7c000000-0000-4000-8000-000000000011') ->> 'status'" 0 >"$out_b"
  wait
  n="$(pg_sql "$db" -At -c "select count(*) || '/' || coalesce(sum(m.amount), 0) from public.absence_requests r join public.balance_movements m on m.request_id = r.id where r.absence_type_id = '7f000000-0000-4000-8000-0000000000c1'")"
  if [[ "$n" != "1/-4" ]] || ! grep -qx "pending" "$out_a" || ! grep -q "Saldo insuficiente: disponible 2, solicitado 4" "$out_b"; then
    echo "FALLO: dos solicitudes simultáneas sobre el mismo saldo (solicitudes/reservado=$n)" >&2; cat "$out_a" "$out_b" >&2; return 1
  fi
  echo "  ok - Dos solicitudes simultáneas: una reserva el saldo y la otra se rechaza por saldo insuficiente"

  # Gastos: el mismo registro de ticket dos veces a la vez.
  local ekey=9e000000-0000-4000-8000-000000000001 epath
  epath="$(pg_sql "$db" -At -c "select '$company/e0000000-0000-0000-0000-000000000007/' || to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY/MM') || '/$ekey.jpg'")"
  pg_sql "$db" -At -o /dev/null -c "insert into storage.objects (bucket_id, name) values ('expense-receipts', '$epath')"
  local register="select created from public.register_expense_receipt('$company', '$ekey', '$epath', repeat('e', 64), 'image/jpeg', 20000, true, 1200, 1600)"
  concurrency_session "$db" 00000000-0000-0000-0000-000000000007 "$register" 2 >"$out_a" &
  sleep 0.5
  concurrency_session "$db" 00000000-0000-0000-0000-000000000007 "$register" 0 >"$out_b"
  wait
  n="$(pg_sql "$db" -At -c "select count(*) || '/' || (select count(*) from public.jobs) from public.expenses where idempotency_key = '$ekey'")"
  if [[ "$n" != "1/1" ]] || ! grep -qx "t" "$out_a" || ! grep -qx "f" "$out_b"; then
    echo "FALLO: registro simultáneo del mismo ticket (gastos/trabajos=$n)" >&2; cat "$out_a" "$out_b" >&2; return 1
  fi
  echo "  ok - Mismo ticket registrado a la vez: un solo gasto y un solo trabajo de OCR"

  local job
  job="$(pg_sql "$db" -At -c "select id from public.jobs limit 1")"
  concurrency_session "$db" 00000000-0000-0000-0000-000000000007 \
    "select 'run:' || attempt from public.claim_ocr_job('$job', 'fake')" 2 >"$out_a" &
  sleep 0.5
  concurrency_session "$db" 00000000-0000-0000-0000-000000000007 \
    "select 'run:' || attempt from public.claim_ocr_job('$job', 'fake')" 0 >"$out_b"
  wait
  n="$(pg_sql "$db" -At -c "select count(*) from public.ocr_runs where job_id = '$job'")"
  if [[ "$n" != "1" ]] || ! grep -qx "run:1" "$out_a" || grep -q "run:" "$out_b"; then
    echo "FALLO: dos sesiones reclaman el mismo trabajo (ejecuciones=$n)" >&2; cat "$out_a" "$out_b" >&2; return 1
  fi
  echo "  ok - Dos sesiones reclaman el mismo trabajo de OCR: una sola ejecución"
  rm -f "$out_a" "$out_b"
  pg_drop_db "$db"
}
