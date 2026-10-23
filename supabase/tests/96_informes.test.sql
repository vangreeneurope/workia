-- =============================================================================
-- Informes: cada rol ve solo su ámbito (empleado, manager, RR. HH. por centro,
-- contabilidad, auditor), ninguna métrica revela datos de otra empresa ni con
-- membresía caducada, los totales se concilian con los registros base, el
-- registro horario no expone ubicación ni selfies, los tipos reservados no se
-- muestran, límites de periodo y paginación, auditoría consultable y
-- exportaciones con solicitante, filtros, huella, caducidad y descargas.
-- Escenario: helpers/fixtures.sql (E1 = u07/e07 en A1 y AT1, supervisado por
-- MGR = u06; E2 = u08/e08 en A2; HR = u04; HRW = u05 solo A2; ACC = u09;
-- AUD = u10; CA = u03; CB = u12; EB = e11 en B, también supervisado por MGR;
-- EXP = u14 con membresía caducada).
-- =============================================================================

\ir helpers/asserts.sql
\ir helpers/fixtures.sql

create or replace function test.d(n int) returns date language sql immutable as
  $$ select date '2026-09-01' + n $$;
create or replace function test.k(n int) returns uuid language sql immutable as
  $$ select ('a9000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function test.today() returns date language sql stable as
  $$ select (now() at time zone 'Europe/Madrid')::date $$;
create or replace function test.monday(k int) returns date language sql stable as
  $$ select test.today() + (8 - extract(isodow from test.today())::int) + 7 * k $$;
grant execute on function test.d(int), test.k(int), test.today(), test.monday(int) to public;

-- Jornadas (registros base) en A y B, con ubicación y selfie en un fichaje.
insert into public.time_entries (id, company_id, employee_id, work_date, time_zone, status, started_at, ended_at,
  worked_seconds, break_seconds)
values
  (test.k(1), test.co('A'), test.e(7), test.d(0), 'Europe/Madrid', 'closed', '2026-09-01 07:00Z', '2026-09-01 15:30Z', 28800, 1800),
  (test.k(2), test.co('A'), test.e(7), test.d(1), 'Europe/Madrid', 'incomplete', '2026-09-02 07:00Z', null, 14400, 0),
  (test.k(3), test.co('A'), test.e(8), test.d(0), 'Europe/Madrid', 'closed', '2026-09-01 08:00Z', '2026-09-01 12:00Z', 14400, 0),
  (test.k(4), test.co('B'), test.e(11), test.d(0), 'Europe/Madrid', 'closed', '2026-09-01 08:00Z', '2026-09-01 16:00Z', 27000, 1800);
insert into public.punches (company_id, employee_id, time_entry_id, kind, server_at, time_zone, source, idempotency_key,
  location_status, latitude, longitude, accuracy_m, selfie_path)
values
  (test.co('A'), test.e(7), test.k(1), 'start', '2026-09-01 07:00Z', 'Europe/Madrid', 'mobile', test.k(11), 'granted',
    40.4168, -3.7038, 15, 'aaaaaaaa-0000-0000-0000-000000000001/selfie.jpg'),
  (test.co('A'), test.e(7), test.k(1), 'break_start', '2026-09-01 11:00Z', 'Europe/Madrid', 'web', test.k(12),
    'not_requested', null, null, null, null),
  (test.co('A'), test.e(7), test.k(1), 'break_end', '2026-09-01 11:30Z', 'Europe/Madrid', 'web', test.k(13),
    'not_requested', null, null, null, null),
  (test.co('A'), test.e(7), test.k(1), 'end', '2026-09-01 15:30Z', 'Europe/Madrid', 'web', test.k(14),
    'not_requested', null, null, null, null);

-- Gastos confirmados en A (E1 y E2) y en B, más un borrador que no cuenta.
insert into public.expense_categories (id, company_id, code, name) values
  (test.k(20), test.co('B'), 'FX', 'Categoría B');
insert into public.expenses (company_id, employee_id, source, status, idempotency_key, category_id, expense_date,
  merchant_name, currency, base_cents, tax_cents, total_cents, payment_method, client_name, project_code, confirmed_at)
values
  (test.co('A'), test.e(7), 'manual', 'ready', test.k(21), '9c000000-0000-4000-8000-000000000001', test.d(2),
    'Proveedor Sintético', 'EUR', 1000, 210, 1210, 'cash', 'Cliente Uno', 'P1', now()),
  (test.co('A'), test.e(7), 'manual', 'ready', test.k(22), '9c000000-0000-4000-8000-000000000001', test.d(3),
    'Proveedor Sintético', 'EUR', null, null, 2500, 'cash', 'Cliente Dos', 'P2', now()),
  (test.co('A'), test.e(8), 'manual', 'ready', test.k(23), '9c000000-0000-4000-8000-000000000001', test.d(3),
    'Proveedor Sintético', 'USD', null, null, 999, 'cash', null, 'P1', now()),
  (test.co('A'), test.e(8), 'manual', 'draft', test.k(24), '9c000000-0000-4000-8000-000000000001', test.d(4),
    'Borrador', 'EUR', null, null, 5000, 'cash', null, null, null),
  (test.co('B'), test.e(11), 'manual', 'ready', test.k(25), test.k(20), test.d(2),
    'Proveedor B', 'EUR', null, null, 777777, 'cash', null, 'P1', now());

-- Tipo reservado (p. ej., de salud) para comprobar que no aparece su nombre.
insert into public.absence_types (id, company_id, code, name, is_private) values
  (test.k(30), test.co('A'), 'RESERV', 'Tipo reservado sintético', true);

set role authenticated;
select test.act_as(test.u(7));
select public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-000000000001', 'day', test.monday(2),
  test.monday(2), test.k(31));
select public.submit_absence_request(test.co('A'), test.k(30), 'day', test.monday(3), test.monday(3), test.k(32));
reset role;

-- -----------------------------------------------------------------------------
-- Ámbito por rol: detalle
-- -----------------------------------------------------------------------------
set role authenticated;

select test.act_as(test.u(7));
select test.ok((select count(*) from public.report_time_daily(test.co('A'), test.d(0), test.d(30))) = 2
  and (select bool_and(employee_id = test.e(7)) from public.report_time_daily(test.co('A'), test.d(0), test.d(30))),
  'Empleado: solo ve sus jornadas');
select test.ok((select max(total_count) from public.report_time_daily(test.co('A'), test.d(0), test.d(30))) = 2,
  'Empleado: el total de filas no revela más jornadas');

select test.act_as(test.u(6));
select test.ok((select array_agg(distinct employee_id) from public.report_time_daily(test.co('A'), test.d(0), test.d(30)))
  = array[test.e(7)], 'Manager: solo las personas que supervisa hoy');
select test.ok((select count(*) from public.report_time_daily(test.co('B'), test.d(0), test.d(30))) = 1,
  'Manager: en la otra empresa solo a quien supervisa allí');

select test.act_as(test.u(4));
select test.ok((select count(*) from public.report_time_daily(test.co('A'), test.d(0), test.d(30))) = 3,
  'RR. HH. de empresa: toda la empresa');
select test.ok((select count(*) from public.report_expenses(test.co('A'), test.d(0), test.d(30), 'employee')) = 0,
  'RR. HH.: no ve gastos');

select test.act_as(test.u(5));
select test.ok((select array_agg(distinct employee_id) from public.report_time_daily(test.co('A'), test.d(0), test.d(30)))
  = array[test.e(8)], 'RR. HH. de centro: solo su centro');

select test.act_as(test.u(10));
select test.ok((select count(*) from public.report_time_register(test.co('A'), test.d(0), test.d(30))) = 3,
  'Auditor: lee el registro horario de la empresa');

select test.act_as(test.u(9));
select test.ok((select count(*) from public.report_time_daily(test.co('A'), test.d(0), test.d(30))) = 0
  and (select count(*) from public.report_absence_requests(test.co('A'), test.d(0), test.d(90))) = 0,
  'Contabilidad: no ve jornadas ni ausencias');
select test.ok((select sum(expenses) from public.report_expenses(test.co('A'), test.d(0), test.d(30), 'employee')) = 3,
  'Contabilidad: ve los gastos confirmados de la empresa');

-- -----------------------------------------------------------------------------
-- Equivalencia con RLS: los informes devuelven exactamente lo que las políticas
-- de las tablas base dejan ver a cada usuario (ADR-050).
-- -----------------------------------------------------------------------------
reset role;
create or replace function test.same_as_rls(p_company uuid) returns boolean language plpgsql as $$
begin
  return
    (select coalesce(array_agg(t.id order by t.id), '{}') from public.time_entries t
      where t.company_id = p_company and t.work_date between test.d(0) and test.d(30))
    = (select coalesce(array_agg(t.id order by t.id), '{}') from public.time_entries t
      join public.report_time_daily(p_company, test.d(0), test.d(30), p_limit => 500) r
        on r.employee_id = t.employee_id and r.work_date = t.work_date)
    and (select count(*) from public.expenses x where x.company_id = p_company and x.status = 'ready'
      and x.expense_date between test.d(0) and test.d(30))
    = (select coalesce(sum(expenses), 0) from public.report_expenses(p_company, test.d(0), test.d(30), 'month'))
    and (select coalesce(array_agg(r.id order by r.id), '{}') from public.absence_requests r
      where r.company_id = p_company and r.start_date <= test.today() + 90 and r.end_date >= test.today())
    = (select coalesce(array_agg(request_id order by request_id), '{}')
      from public.report_absence_requests(p_company, test.today(), test.today() + 90, p_limit => 500))
    and (select count(*) from public.audit_events a where a.company_id = p_company
      and a.occurred_at >= test.today() - 1)
    = (select coalesce(max(total_count), 0) from public.report_audit(p_company, test.today() - 1, test.today() + 1));
end $$;
grant execute on function test.same_as_rls(uuid) to public;
set role authenticated;
select test.act_as(test.u(3));
select test.ok(test.same_as_rls(test.co('A')) and test.same_as_rls(test.co('B')), 'Equivalencia con RLS: usuario 3');
select test.act_as(test.u(4));
select test.ok(test.same_as_rls(test.co('A')) and test.same_as_rls(test.co('B')), 'Equivalencia con RLS: usuario 4');
select test.act_as(test.u(5));
select test.ok(test.same_as_rls(test.co('A')) and test.same_as_rls(test.co('B')), 'Equivalencia con RLS: usuario 5');
select test.act_as(test.u(6));
select test.ok(test.same_as_rls(test.co('A')) and test.same_as_rls(test.co('B')), 'Equivalencia con RLS: usuario 6');
select test.act_as(test.u(7));
select test.ok(test.same_as_rls(test.co('A')) and test.same_as_rls(test.co('B')), 'Equivalencia con RLS: usuario 7');
select test.act_as(test.u(8));
select test.ok(test.same_as_rls(test.co('A')) and test.same_as_rls(test.co('B')), 'Equivalencia con RLS: usuario 8');
select test.act_as(test.u(9));
select test.ok(test.same_as_rls(test.co('A')) and test.same_as_rls(test.co('B')), 'Equivalencia con RLS: usuario 9');
select test.act_as(test.u(10));
select test.ok(test.same_as_rls(test.co('A')) and test.same_as_rls(test.co('B')), 'Equivalencia con RLS: usuario 10');
select test.act_as(test.u(12));
select test.ok(test.same_as_rls(test.co('A')) and test.same_as_rls(test.co('B')), 'Equivalencia con RLS: usuario 12');
select test.act_as(test.u(14));
select test.ok(test.same_as_rls(test.co('A')) and test.same_as_rls(test.co('B')), 'Equivalencia con RLS: usuario 14');
select test.act_as(test.u(17));
select test.ok(test.same_as_rls(test.co('A')) and test.same_as_rls(test.co('B')), 'Equivalencia con RLS: usuario 17');
select test.act_as(test.u(2));
select test.ok(test.same_as_rls(test.co('A')) and test.same_as_rls(test.co('B')), 'Equivalencia con RLS: usuario 2');

-- -----------------------------------------------------------------------------
-- Ninguna métrica de otra empresa ni con membresía caducada
-- -----------------------------------------------------------------------------
select test.act_as(test.u(12));
select test.ok(
  (select count(*) from public.report_time_daily(test.co('A'), test.d(0), test.d(30))) = 0
  and (select count(*) from public.report_time_summary(test.co('A'), test.d(0), test.d(30))) = 0
  and (select count(*) from public.report_time_register(test.co('A'), test.d(0), test.d(30))) = 0
  and (select count(*) from public.report_absence_balances(test.co('A'), test.today())) = 0
  and (select count(*) from public.report_absence_requests(test.co('A'), test.d(0), test.d(90))) = 0
  and (select count(*) from public.report_expenses(test.co('A'), test.d(0), test.d(30), 'month')) = 0
  and (select count(*) from public.report_closures(test.co('A'), test.d(0), test.d(30))) = 0
  and (select count(*) from public.report_audit(test.co('A'), test.d(0), test.today())) = 0,
  'Otra empresa: cero filas en detalle y agregados');
select test.ok((select coalesce(sum(pending + decided), 0) from public.report_approvals(test.co('A'), test.d(0), test.today())) = 0,
  'Otra empresa: los recuentos de aprobaciones son cero');
select test.ok((select sum(total_cents) from public.report_expenses(test.co('B'), test.d(0), test.d(30), 'month')) = 777777,
  'Administración de B: solo sus importes');

select test.act_as(test.u(14));
select test.ok((select count(*) from public.report_time_daily(test.co('A'), test.d(0), test.d(30))) = 0
  and (select coalesce(sum(pending + decided), 0) from public.report_approvals(test.co('A'), test.d(0), test.today())) = 0,
  'Membresía caducada: cero filas');
select test.fails($$select public.request_report_export(test.co('A'), 'time_daily', 'csv', '{}', test.k(40))$$,
  'Membresía caducada: no exporta', 'No perteneces');

-- -----------------------------------------------------------------------------
-- Conciliación con los registros base
-- -----------------------------------------------------------------------------
select test.act_as(test.u(4));
create temporary table summary_a as select * from public.report_time_summary(test.co('A'), test.d(0), test.d(30));
reset role;
select test.ok((select sum(worked_seconds) from summary_a)
  = (select sum(worked_seconds) from public.time_entries where company_id = test.co('A'))
  and (select sum(break_seconds) from summary_a)
  = (select sum(break_seconds) from public.time_entries where company_id = test.co('A'))
  and (select sum(days) from summary_a) = 3 and (select sum(incomplete_days) from summary_a) = 1,
  'Conciliación: horas, descansos y días del resumen = jornadas base');

set role authenticated;
select test.act_as(test.u(3));
create temporary table exp_a as select * from public.report_expenses(test.co('A'), test.d(0), test.d(30), 'project');
reset role;
select test.ok((select sum(total_cents) from exp_a where currency = 'EUR')
  = (select sum(total_cents) from public.expenses where company_id = test.co('A') and status = 'ready' and currency = 'EUR')
  and (select sum(total_cents) from exp_a where currency = 'USD') = 999
  and (select count(*) from exp_a where group_key = 'P1') = 2,
  'Conciliación: gastos por proyecto y moneda = gastos confirmados, sin mezclar monedas ni borradores');

set role authenticated;
select test.act_as(test.u(3));
select test.ok((select count(*) from public.report_expenses(test.co('A'), test.d(0), test.d(30), 'employee',
  p_client => 'uno')) = 1, 'Filtro de cliente');
select test.ok((select sum(expenses) from public.report_expenses(test.co('A'), test.d(0), test.d(30), 'month',
  p_team => test.team('AT1'))) = 2, 'Filtro de equipo');
select test.ok((select count(*) from public.report_time_daily(test.co('A'), test.d(0), test.d(30),
  p_center => test.wc('A2'))) = 1, 'Filtro de centro');

select test.act_as(test.u(4));
select test.ok((select pending from public.report_approvals(test.co('A'), test.today() - 1, test.today())
  where kind = 'absences') = 2, 'Aprobaciones: RR. HH. ve las solicitudes pendientes');
select test.act_as(test.u(7));
select test.ok((select pending from public.report_approvals(test.co('A'), test.today() - 1, test.today())
  where kind = 'absences') = 2 and (select pending from public.report_approvals(test.co('A'), test.today() - 1,
  test.today()) where kind = 'expense_reports') = 0, 'Aprobaciones: el empleado solo cuenta lo suyo');

-- -----------------------------------------------------------------------------
-- Registro horario sin ubicación, selfies ni motivos; tipos reservados
-- -----------------------------------------------------------------------------
select test.act_as(test.u(10));
select test.ok((select jsonb_array_length(punches) from public.report_time_register(test.co('A'), test.d(0), test.d(0),
  p_employee => test.e(7))) = 4, 'Registro: inicio, pausas y fin');
select test.ok(not exists (select 1 from public.report_time_register(test.co('A'), test.d(0), test.d(30)) r
  where r.punches::text ~ '(latitude|longitude|selfie|40\.41)'),
  'Registro: sin coordenadas ni selfies');
select test.act_as(test.u(4));
select test.ok((select array_agg(type_label order by start_date) from public.report_absence_requests(test.co('A'),
  test.today(), test.today() + 60)) = array['Tipo de pruebas', 'Ausencia (reservada)'],
  'Ausencias: el tipo reservado no aparece en informes generales');

-- -----------------------------------------------------------------------------
-- Límites
-- -----------------------------------------------------------------------------
select test.fails($$select * from public.report_time_daily(test.co('A'), test.d(0), test.d(120))$$,
  'Límite: periodo máximo', 'periodo máximo');
select test.fails($$select * from public.report_time_daily(test.co('A'), test.d(0), test.d(1), p_limit => 501)$$,
  'Límite: 500 filas por página', 'Paginación');
select test.fails($$select * from public.report_expenses(test.co('A'), test.d(0), test.d(1), 'merchant')$$,
  'Agrupación no permitida (proveedor)', 'Agrupación');
select test.ok((select count(*) from public.report_time_daily(test.co('A'), test.d(0), test.d(30), p_limit => 2)) = 2
  and (select count(*) from public.report_time_daily(test.co('A'), test.d(0), test.d(30), p_limit => 2, p_offset => 2)) = 1,
  'Paginación estable');
reset role;
select test.fails($$set role anon; select * from public.report_time_daily(test.co('A'), test.d(0), test.d(1))$$,
  'Anónimo: sin acceso a informes', 'permission denied');
reset role;

-- -----------------------------------------------------------------------------
-- Auditoría consultable
-- -----------------------------------------------------------------------------
set role authenticated;
select test.act_as(test.u(10));
select test.ok((select count(*) from public.report_audit(test.co('A'), test.today() - 1, test.today(),
  p_entity => 'absence_requests', p_action => 'create')) = 2, 'Auditoría: alta de solicitudes por objeto y acción');
select test.ok((select bool_and(after = jsonb_build_object('status', 'pending') and before is null)
  from public.report_audit(test.co('A'), test.today() - 1, test.today(), p_entity => 'absence_requests')),
  'Auditoría: cambios mínimos (solo el estado, sin notas)');
select test.ok((select count(*) from public.report_audit(test.co('A'), test.today() - 1, test.today(),
  p_actor => test.u(7))) >= 2, 'Auditoría: búsqueda por actor');
select test.act_as(test.u(7));
select test.ok((select count(*) from public.report_audit(test.co('A'), test.today() - 1, test.today())) = 0,
  'Auditoría: el empleado no la ve');
select test.act_as(test.u(4));
select test.ok((select count(*) from public.report_audit(test.co('A'), test.today() - 1, test.today())) = 0,
  'Auditoría: RR. HH. no la ve');
reset role;
select test.ok(private.minimize_audit_data('{"employee_note": "x", "merchant_name": "y", "latitude": 1, "status": "a"}')
  = '{"employee_note": "[dato personal]", "merchant_name": "[dato personal]", "latitude": "[dato personal]", "status": "a"}',
  'Auditoría: textos libres, proveedores y ubicación se enmascaran');
select test.fails($$update public.audit_events set action = 'update'$$, 'Auditoría: append-only', 'no se');

-- -----------------------------------------------------------------------------
-- Exportaciones
-- -----------------------------------------------------------------------------
set role authenticated;
select set_config('request.headers', '{"x-request-id": "req-0000-informes"}', false);
select test.act_as(test.u(7));
select test.fails($$select public.request_report_export(test.co('A'), 'audit', 'csv', '{}', test.k(41))$$,
  'Exportar auditoría exige permiso', 'permiso');
select set_config('test.export', public.request_report_export(test.co('A'), 'time_daily', 'xlsx',
  '{"from": "2026-09-01", "to": "2026-09-30"}', test.k(42))::text, false);
select test.ok(public.request_report_export(test.co('A'), 'time_daily', 'xlsx', '{}', test.k(42))
  = current_setting('test.export')::uuid, 'Exportar: idempotente por clave');
select test.fails($$select public.request_report_export(test.co('A'), 'time_daily', 'csv',
  jsonb_build_object('q', repeat('x', 2000)), test.k(45))$$, 'Exportar: filtros acotados', 'check');
select public.request_report_export(test.co('A'), 'time_summary', 'csv', '{}', test.k(43));
select test.fails($$select public.request_report_export(test.co('A'), 'time_register', 'pdf', '{}', test.k(44))$$,
  'Exportar: como mucho 3 en curso por persona', 'en curso');
select test.fails($$update public.report_exports set status = 'ready'$$, 'Exportar: nadie cambia el registro', 'permission denied');
select test.ok((select request_id = 'req-0000-informes' and requested_by = test.u(7)
  from public.report_exports where id = current_setting('test.export')::uuid), 'Exportar: solicitante y request_id');

select test.ok(public.start_report_export(current_setting('test.export')::uuid), 'Exportar: empieza la generación');
select test.ok(not public.start_report_export(current_setting('test.export')::uuid), 'Exportar: no se genera dos veces');
select test.fails(format($$select public.complete_report_export(%L, 'x.xlsx', 'otra/ruta/x.xlsx', repeat('a', 64), 10, 3)$$,
  current_setting('test.export')), 'Exportar: ruta fuera de su carpeta', 'Archivo no válido');
select set_config('test.path', test.co('A') || '/' || test.u(7) || '/' || current_setting('test.export') || '/jornada.xlsx', false);
insert into storage.objects (bucket_id, name) values ('report-exports', current_setting('test.path'));
select test.fails($$insert into storage.objects (bucket_id, name) values ('report-exports',
  test.co('A') || '/' || test.u(6) || '/' || current_setting('test.export') || '/x.xlsx')$$,
  'Storage: nadie escribe en la carpeta de otra persona', 'row-level security');
select public.complete_report_export(current_setting('test.export')::uuid, 'jornada.xlsx', current_setting('test.path'),
  repeat('ab', 32), 2048, 3);
select test.ok((select status = 'ready' and sha256 = repeat('ab', 32) and expires_at between now() + interval '6 days'
  and now() + interval '8 days' from public.report_exports where id = current_setting('test.export')::uuid),
  'Exportar: lista con huella y caducidad de 7 días');

select test.ok(public.log_report_download(current_setting('test.export')::uuid) = current_setting('test.path'),
  'Descarga: devuelve la ruta para firmar');
select test.ok((select count(*) from storage.objects where bucket_id = 'report-exports') = 1, 'Storage: el solicitante lee su archivo');
select test.act_as(test.u(6));
select test.fails(format($$select public.log_report_download(%L)$$, current_setting('test.export')),
  'Descarga: nadie descarga la exportación de otra persona', 'no disponible');
select test.ok((select count(*) from storage.objects where bucket_id = 'report-exports') = 0, 'Storage: otra persona no lee el archivo');
select test.act_as(test.u(10));
select test.ok((select count(*) from public.report_export_downloads) = 1
  and (select count(*) from public.report_exports where company_id = test.co('A')) = 3,
  'Auditor: ve el registro de exportaciones y descargas');
select test.ok((select count(*) from storage.objects where bucket_id = 'report-exports') = 0, 'Auditor: no lee los archivos');
select test.ok((select count(*) from public.report_audit(test.co('A'), test.today() - 1, test.today(),
  p_entity => 'report_exports', p_entity_id => current_setting('test.export'))) = 2
  and (select bool_and(request_id = 'req-0000-informes') from public.report_audit(test.co('A'), test.today() - 1, test.today(),
  p_entity => 'report_exports', p_entity_id => current_setting('test.export'))),
  'Auditoría: solicitud y descarga con request_id');
select test.ok(not exists (select 1 from public.report_audit(test.co('A'), test.today() - 1, test.today(),
  p_entity => 'report_exports') a where a.after::text like '%2026-09%'),
  'Auditoría: guarda qué filtros se usaron, no sus valores');
select test.act_as(test.u(12));
select test.ok((select count(*) from public.report_exports) = 0 and (select count(*) from public.report_export_downloads) = 0,
  'Otra empresa: no ve exportaciones');
reset role;

-- Caducidad: sin enlace permanente.
set session_replication_role = replica;
update public.report_exports set expires_at = now() - interval '1 minute' where id = current_setting('test.export')::uuid;
set session_replication_role = origin;
select test.ok((select count(*) from public.expire_report_exports() where storage_path = current_setting('test.path')) = 1,
  'Caducidad: la tarea devuelve el archivo para borrarlo');
-- Huérfano: una generación fallida que llegó a subir su archivo.
select set_config('test.failed', (select id::text from public.report_exports where idempotency_key = test.k(43)), false);
insert into storage.objects (bucket_id, name) values ('report-exports',
  test.co('A') || '/' || test.u(7) || '/' || current_setting('test.failed') || '/resumen.csv');
set role authenticated;
select test.act_as(test.u(7));
select public.fail_report_export(current_setting('test.failed')::uuid, 'upload_failed');
reset role;
select test.ok((select count(*) from public.expire_report_exports() where export_id = current_setting('test.failed')::uuid) = 1,
  'Caducidad: también devuelve los archivos huérfanos de una generación fallida');
set role authenticated;
select test.act_as(test.u(7));
select test.fails(format($$select public.log_report_download(%L)$$, current_setting('test.export')),
  'Caducidad: ya no se descarga', 'no disponible');
select test.fails($$select public.expire_report_exports()$$, 'Caducidad: solo con la clave de servicio', 'permission denied');
reset role;
select test.fails(format($$update public.report_exports set status = 'ready' where id = %L$$, current_setting('test.export')),
  'Exportar: una caducada no vuelve a estar lista', 'no se modifica');
select test.fails($$delete from public.report_export_downloads$$, 'Descargas: no se borran', 'no se');
