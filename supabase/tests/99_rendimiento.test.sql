-- =============================================================================
-- Rendimiento de los informes con volumen sintético (docs/INFORMES.md, §5).
-- 200 personas × 60 días en A (12 000 jornadas, 48 000 fichajes), 6 000 gastos
-- y 60 000 eventos de auditoría, más ruido en B. Comprueba que las consultas
-- principales usan los índices documentados y que, con RLS aplicada (RR. HH. y
-- auditor de A), una página tarda menos del umbral. Los tiempos reales se
-- imprimen como NOTICE para documentarlos.
-- =============================================================================

\ir helpers/asserts.sql
\ir helpers/fixtures.sql

insert into public.employees (id, company_id, employee_code, first_name, last_name, work_center_id, team_id)
select ('e7000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, test.co('A'), 'V-' || lpad(n::text, 4, '0'),
  'Persona', 'Sintética ' || n, case when n % 2 = 0 then test.wc('A1') else test.wc('A2') end,
  case when n % 4 = 0 then test.team('AT1') end
from generate_series(1, 200) n;

-- La validación de zona horaria consulta pg_timezone_names fila a fila (≈20 ms);
-- en uso real hay una jornada por persona y día, pero para cargar el volumen
-- sintético se valida una sola vez: la zona es la misma en todas las filas.
select test.ok(private.is_valid_time_zone('Europe/Madrid'), 'Volumen: zona horaria válida');
alter table public.time_entries drop constraint time_entries_time_zone_check;

insert into public.time_entries (company_id, employee_id, work_date, time_zone, status, started_at, ended_at,
  worked_seconds, break_seconds)
select test.co('A'), ('e7000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, date '2026-07-01' + d,
  'Europe/Madrid', 'closed', (date '2026-07-01' + d) + time '07:00', (date '2026-07-01' + d) + time '15:30',
  28800, 1800
from generate_series(1, 200) n, generate_series(0, 59) d;
alter table public.time_entries add constraint time_entries_time_zone_check
  check (private.is_valid_time_zone(time_zone)) not valid;

insert into public.punches (company_id, employee_id, time_entry_id, kind, server_at, time_zone, source, idempotency_key)
select t.company_id, t.employee_id, t.id, k.kind::public.punch_kind, t.started_at + k.off, t.time_zone, 'web',
  gen_random_uuid()
from public.time_entries t
cross join (values ('start', interval '0'), ('break_start', interval '4 hours'), ('break_end', interval '4.5 hours'),
  ('end', interval '8.5 hours')) k(kind, off)
where t.company_id = test.co('A');

insert into public.expenses (company_id, employee_id, source, status, idempotency_key, category_id, expense_date,
  currency, total_cents, payment_method, project_code, confirmed_at)
select test.co('A'), ('e7000000-0000-4000-8000-' || lpad((1 + n % 200)::text, 12, '0'))::uuid, 'manual', 'ready',
  gen_random_uuid(), '9c000000-0000-4000-8000-000000000001', date '2026-07-01' + n % 60, 'EUR', 100 + n,
  'cash', 'P' || n % 7, now()
from generate_series(1, 6000) n;

-- Auditoría: A y ruido de B (no debe leerse para A).
insert into public.audit_events (occurred_at, actor_id, company_id, group_id, entity, entity_id, action)
select timestamptz '2026-07-01' + n * interval '90 seconds', test.u(3 + n % 5),
  case when n % 3 = 0 then test.co('B') else test.co('A') end, test.grp(1),
  (array['employees', 'absence_requests', 'expense_reports'])[1 + n % 3], n::text, 'update'
from generate_series(1, 60000) n;

analyze;

-- El plan de cada consulta principal (con los filtros de la función) usa su índice.
-- Con periodos cortos (el volumen sintético cubre solo 60 días; en producción la
-- tabla guarda años) el planificador elige el índice; si el periodo abarca casi
-- toda la tabla, una lectura secuencial es más barata y es lo que debe elegir.
create or replace function test.uses_index(p_sql text, p_index text) returns boolean language plpgsql as $$
declare
  line text;
  found boolean := false;
begin
  for line in execute 'explain ' || p_sql loop
    if position(p_index in line) > 0 then
      found := true;
    end if;
  end loop;
  return found;
end $$;

-- Mide una consulta (milisegundos, mejor de 3 ejecuciones).
create or replace function test.ms(p_sql text) returns numeric language plpgsql as $$
declare
  t0 timestamptz;
  best numeric := null;
  i int;
begin
  for i in 1..3 loop
    t0 := clock_timestamp();
    execute p_sql;
    best := least(coalesce(best, 1e9), extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
  return round(best, 1);
end $$;
grant execute on function test.uses_index(text, text), test.ms(text) to public;

select test.ok(test.uses_index($$select * from public.time_entries where company_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  and work_date between '2026-07-01' and '2026-07-03'$$, 'time_entries_company'),
  'Índice: jornadas por empresa y fecha');
select test.ok(test.uses_index($$select * from public.punches where time_entry_id = 'a9000000-0000-4000-8000-000000000001'$$, 'punches_entry_idx'),
  'Índice: fichajes por jornada (sin N+1: una búsqueda indexada por fila de la página)');
select test.ok(test.uses_index($$select * from public.expenses where company_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  and expense_date between '2026-07-01' and '2026-07-03'$$, 'expenses_company_date_idx'),
  'Índice: gastos por empresa y fecha');
select test.ok(test.uses_index($$select * from public.audit_events where company_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  and occurred_at >= '2026-07-01' order by occurred_at desc limit 50$$, 'audit_events_company_idx'),
  'Índice: auditoría por empresa y fecha');
select test.ok(test.uses_index($$select * from public.audit_events where company_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  and actor_id = '00000000-0000-0000-0000-000000000003' and occurred_at >= '2026-07-01'
  order by occurred_at desc limit 50$$, 'audit_events_actor_idx'),
  'Índice: auditoría por actor');
select test.ok(test.uses_index($$select * from public.audit_events where company_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  and entity = 'employees' and occurred_at >= '2026-07-01' order by occurred_at desc limit 50$$, 'audit_events_entity_time_idx'),
  'Índice: auditoría por objeto');

-- Tiempos con RLS aplicada. Umbral holgado (2 s) para no depender de la máquina;
-- los tiempos medidos se documentan en docs/INFORMES.md.
select set_config('test.audit_a', (select count(*) from public.audit_events where company_id = test.co('A')
  and occurred_at >= '2026-07-01' and occurred_at < '2026-09-01')::text, false);
set role authenticated;
select test.act_as(test.u(4));
do $do$
declare
  t numeric;
begin
  t := test.ms($$select * from public.report_time_daily('aaaaaaaa-0000-0000-0000-000000000001', '2026-07-01', '2026-07-31', p_limit => 100)$$);
  raise notice 'medida - report_time_daily (31 días, 6 200 jornadas, página de 100): % ms', t;
  perform test.ok(t < 2000, 'Rendimiento: jornada diaria por debajo del umbral');
  t := test.ms($$select * from public.report_time_summary('aaaaaaaa-0000-0000-0000-000000000001', '2026-07-01', '2026-08-29', p_limit => 100)$$);
  raise notice 'medida - report_time_summary (60 días, 12 000 jornadas, 200 personas): % ms', t;
  perform test.ok(t < 2000, 'Rendimiento: resumen de horas por debajo del umbral');
  t := test.ms($$select * from public.report_time_register('aaaaaaaa-0000-0000-0000-000000000001', '2026-07-01', '2026-07-31', p_limit => 100)$$);
  raise notice 'medida - report_time_register (31 días, página de 100 con fichajes): % ms', t;
  perform test.ok(t < 2000, 'Rendimiento: registro horario por debajo del umbral');
end $do$;
select test.act_as(test.u(3));
do $do$
declare
  t numeric;
begin
  t := test.ms($$select * from public.report_expenses('aaaaaaaa-0000-0000-0000-000000000001', '2026-07-01', '2026-08-29', 'project')$$);
  raise notice 'medida - report_expenses (60 días, 6 000 gastos, por proyecto): % ms', t;
  perform test.ok(t < 2000, 'Rendimiento: gastos agrupados por debajo del umbral');
end $do$;
select test.act_as(test.u(10));
do $do$
declare
  t numeric;
begin
  t := test.ms($$select * from public.report_audit('aaaaaaaa-0000-0000-0000-000000000001', '2026-07-01', '2026-08-31', p_limit => 50)$$);
  raise notice 'medida - report_audit (62 días, ~40 000 eventos de A, página de 50): % ms', t;
  perform test.ok(t < 2000, 'Rendimiento: auditoría por debajo del umbral');
  t := test.ms($$select * from public.report_audit('aaaaaaaa-0000-0000-0000-000000000001', '2026-07-01', '2026-08-31',
    p_actor => '00000000-0000-0000-0000-000000000003', p_limit => 50)$$);
  raise notice 'medida - report_audit por actor: % ms', t;
  perform test.ok(t < 2000, 'Rendimiento: auditoría por actor por debajo del umbral');
end $do$;
select test.ok((select max(total_count) from public.report_audit('aaaaaaaa-0000-0000-0000-000000000001', '2026-07-01',
  '2026-08-31', p_limit => 50)) = current_setting('test.audit_a')::bigint, 'Volumen: el auditor de A cuenta solo los eventos de A');
reset role;
