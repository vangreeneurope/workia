-- =============================================================================
-- Vacaciones y ausencias: libro de saldos (apertura, prorrateo, devengo,
-- arrastre, caducidad), cambio de política sin efecto retroactivo, solicitudes
-- (cómputo, solapes, saldo, reserva), decisiones, cancelación y retirada,
-- escalado a RR. HH., privacidad de justificantes y calendario, RLS.
-- La concurrencia real está en scripts/test-db-concurrency.sh.
-- Escenario: helpers/fixtures.sql (E1 = u07/e07 en A1/AT1, supervisado por
-- MGR = u06; E2 = u08/e08 en A2, sin aprobador vigente; HR = u04; HRW = u05 en
-- A2; CA = u03; CB = u12 de B; EXP = u14 con membresía caducada).
-- =============================================================================

\ir helpers/asserts.sql
\ir helpers/fixtures.sql

create or replace function test.today() returns date language sql stable as
  $$ select (now() at time zone 'Europe/Madrid')::date $$;
-- Lunes de una semana futura cuya semana laboral cae en un solo año.
create or replace function test.monday(k int) returns date language sql stable as $$
  select case when extract(year from m) <> extract(year from m + 4) then m + 7 else m end
  from (select test.today() + (8 - extract(isodow from test.today())::int) + 7 * k as m) s
$$;
create or replace function test.prev_weekday() returns date language sql stable as $$
  select case extract(isodow from test.today() - 1)::int when 7 then test.today() - 3 when 6 then test.today() - 2
    else test.today() - 1 end
$$;
create or replace function test.k(n int) returns uuid language sql immutable as
  $$ select ('8b000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- Saldo visto desde fuera (como servicio), para comparar antes y después.
create or replace function test.avail(p_employee uuid, p_policy uuid, p_day date) returns integer language sql security definer as $$
  select private.balance_available(b.id) from public.vacation_balances b
  where b.employee_id = p_employee and b.policy_id = p_policy and b.period_start = private.period_start_for(p_policy, p_day)
$$;
grant execute on function test.today(), test.monday(int), test.prev_weekday(), test.k(int),
  test.avail(uuid, uuid, date) to public;

-- -----------------------------------------------------------------------------
-- Configuración (como servicio)
-- -----------------------------------------------------------------------------
insert into public.absence_types (id, company_id, code, name, allowed_units, uses_balance, requires_attachment,
  attachment_sensitive, is_private, max_past_days, requires_approval, approval_exemption_ref) values
  ('7f000000-0000-4000-8000-0000000000a1', test.co('A'), 'VAC', 'Vacaciones', '{day,half_day}', true, false, true, false, 0, true, null),
  ('7f000000-0000-4000-8000-0000000000a2', test.co('A'), 'HRS', 'Horas propias', '{hour}', true, false, true, false, 0, true, null),
  ('7f000000-0000-4000-8000-0000000000a3', test.co('A'), 'MED', 'Ausencia médica', '{day}', false, true, true, true, 10, true, null),
  ('7f000000-0000-4000-8000-0000000000a4', test.co('A'), 'AUTO', 'Formación interna', '{day}', false, false, true, false, 0, false,
    'Acuerdo de empresa 2026/1'),
  ('7f000000-0000-4000-8000-0000000000a5', test.co('A'), 'DOC', 'Trámite con justificante', '{day}', false, true, false, false, 0, true, null);

insert into public.vacation_policies (id, company_id, absence_type_id, code, name) values
  ('7a000000-0000-4000-8000-000000000001', test.co('A'), '7f000000-0000-4000-8000-0000000000a1', 'PV', 'Vacaciones general'),
  ('7a000000-0000-4000-8000-000000000002', test.co('A'), '7f000000-0000-4000-8000-0000000000a1', 'PM', 'Vacaciones con devengo mensual'),
  ('7a000000-0000-4000-8000-000000000003', test.co('A'), '7f000000-0000-4000-8000-0000000000a2', 'PH', 'Horas propias'),
  ('7a000000-0000-4000-8000-000000000004', test.co('A'), '7f000000-0000-4000-8000-0000000000a1', 'PN', 'Vacaciones con anticipo'),
  ('7a000000-0000-4000-8000-000000000005', test.co('A'), '7f000000-0000-4000-8000-0000000000a1', 'PC', 'Vacaciones sin caducidad');

insert into public.vacation_policy_versions (id, company_id, policy_id, version, unit, entitlement, accrual_method,
  proration, rounding_mode, rounding_step, carryover_max, carryover_expiry_months, allow_negative, negative_limit,
  negative_reason) values
  ('7b000000-0000-4000-8000-000000000001', test.co('A'), '7a000000-0000-4000-8000-000000000001', 1, 'half_days', 44, 'upfront', 'by_employment', 'nearest', 1, 10, 3, false, 0, null),
  ('7b000000-0000-4000-8000-000000000002', test.co('A'), '7a000000-0000-4000-8000-000000000002', 1, 'half_days', 24, 'monthly', 'by_employment', 'nearest', 1, 0, null, false, 0, null),
  ('7b000000-0000-4000-8000-000000000003', test.co('A'), '7a000000-0000-4000-8000-000000000003', 1, 'minutes', 600, 'upfront', 'none', 'down', 15, 0, null, false, 0, null),
  ('7b000000-0000-4000-8000-000000000004', test.co('A'), '7a000000-0000-4000-8000-000000000004', 1, 'half_days', 2, 'upfront', 'none', 'nearest', 1, 0, null, true, 4,
    'Anticipo de hasta dos días aprobado por la dirección'),
  ('7b000000-0000-4000-8000-000000000005', test.co('A'), '7a000000-0000-4000-8000-000000000005', 1, 'half_days', 44, 'upfront', 'by_employment', 'nearest', 1, 6, null, false, 0, null);
update public.vacation_policy_versions set status = 'published', valid_from = '2025-01-01', published_at = now()
where company_id = test.co('A');

insert into public.policy_assignments (company_id, policy_id, absence_type_id, scope_type, employee_id, valid_from) values
  (test.co('A'), '7a000000-0000-4000-8000-000000000001', '7f000000-0000-4000-8000-0000000000a1', 'company', null, test.today()),
  (test.co('A'), '7a000000-0000-4000-8000-000000000003', '7f000000-0000-4000-8000-0000000000a2', 'company', null, test.today()),
  (test.co('A'), '7a000000-0000-4000-8000-000000000004', '7f000000-0000-4000-8000-0000000000a1', 'employee', test.e(8), test.today());

-- Festivo de empresa el miércoles de la semana de las pruebas.
insert into public.holiday_calendars (id, company_id, name, scope, applies_to_all_centers, source_reference)
values ('7c000000-0000-4000-8000-000000000001', test.co('A'), 'Calendario de pruebas', 'company', true, 'Fuente sintética');
insert into public.holidays (company_id, calendar_id, holiday_date, name)
values (test.co('A'), '7c000000-0000-4000-8000-000000000001', test.monday(2) + 2, 'Festivo sintético');

select test.fails($$insert into public.policy_assignments (company_id, policy_id, absence_type_id, scope_type, valid_from)
  values (test.co('A'), '7a000000-0000-4000-8000-000000000005', '7f000000-0000-4000-8000-0000000000a1', 'company', test.today() - 1)$$,
  'Asignación: no empieza en el pasado', 'hoy o en una fecha futura');
select test.fails($$insert into public.policy_assignments (company_id, policy_id, absence_type_id, scope_type, valid_from)
  values (test.co('A'), '7a000000-0000-4000-8000-000000000005', '7f000000-0000-4000-8000-0000000000a1', 'company', test.today() + 1)$$,
  'Asignación: una sola política de empresa por tipo en las mismas fechas', 'policy_assignments_excl');
select test.ok(private.policy_for(test.e(8), '7f000000-0000-4000-8000-0000000000a1', test.today())
  = '7a000000-0000-4000-8000-000000000004', 'Precedencia: la política de la persona gana a la de empresa');
select test.ok(private.policy_for(test.e(7), '7f000000-0000-4000-8000-0000000000a1', test.today())
  = '7a000000-0000-4000-8000-000000000001', 'Precedencia: sin política propia aplica la de empresa');
select test.fails($$insert into public.absence_types (company_id, code, name, requires_approval) values (test.co('A'), 'X1', 'Sin aprobación', false)$$,
  'Tipo: sin aprobación exige la referencia de la regla aprobada', 'absence_types_exemption_check');

-- -----------------------------------------------------------------------------
-- Libro de saldos: redondeo, prorrateo, devengo, arrastre y caducidad
-- -----------------------------------------------------------------------------
select test.ok(private.round_ratio(44 * 214, 365, 1, 'nearest') = 26 and private.round_ratio(44 * 214, 365, 1, 'down') = 25
  and private.round_ratio(44 * 214, 365, 2, 'up') = 26 and private.round_ratio(10, 4, 1, 'nearest') = 3,
  'Redondeo con enteros: abajo, arriba, al más cercano y a múltiplos');

select private.ensure_balance(test.e(8), '7a000000-0000-4000-8000-000000000005', '2025-08-01');
select test.ok(test.avail(test.e(8), '7a000000-0000-4000-8000-000000000005', '2025-08-01') = 26,
  'Prorrateo: alta el 1 de junio -> 214/365 de 44 medios días = 26');

select private.ensure_balance(test.e(7), '7a000000-0000-4000-8000-000000000001', '2025-03-01');
select private.post_movement((select id from public.vacation_balances where employee_id = test.e(7)
  and policy_id = '7a000000-0000-4000-8000-000000000001' and period_start = '2025-01-01'),
  'usage', -30, '2025-08-04', 'historico');
select test.ok(test.avail(test.e(7), '7a000000-0000-4000-8000-000000000001', '2025-03-01') = 14,
  'Saldo: 44 de apertura menos 30 usados');
select private.ensure_balance(test.e(7), '7a000000-0000-4000-8000-000000000001', '2026-06-01');
select test.ok((select status = 'closed' from public.vacation_balances where employee_id = test.e(7)
  and policy_id = '7a000000-0000-4000-8000-000000000001' and period_start = '2025-01-01'),
  'Cambio de año: el periodo anterior se cierra');
select test.ok(test.avail(test.e(7), '7a000000-0000-4000-8000-000000000001', '2025-03-01') = 0
  and (select amount = -4 from public.balance_movements m join public.vacation_balances b on b.id = m.balance_id
       where b.employee_id = test.e(7) and b.period_start = '2025-01-01' and b.policy_id = '7a000000-0000-4000-8000-000000000001'
         and m.kind = 'expiry'),
  'Arrastre: de 14 sobrantes pasan 10 (máximo) y 4 se pierden al cerrar');
select test.ok((select amount = 10 and expires_on = '2026-04-01' from public.balance_movements m
  join public.vacation_balances b on b.id = m.balance_id
  where b.employee_id = test.e(7) and b.period_start = '2026-01-01' and b.policy_id = '7a000000-0000-4000-8000-000000000001'
    and m.kind = 'carryover'), 'Arrastre: entra en el periodo nuevo con su fecha de caducidad');
select test.ok((select -amount = 10 from public.balance_movements m join public.vacation_balances b on b.id = m.balance_id
  where b.employee_id = test.e(7) and b.period_start = '2026-01-01' and b.policy_id = '7a000000-0000-4000-8000-000000000001'
    and m.kind = 'expiry'), 'Caducidad: lo arrastrado sin usar antes del 1 de abril caduca');
select test.ok(test.avail(test.e(7), '7a000000-0000-4000-8000-000000000001', '2026-06-01') = 44,
  'Saldo 2026: 44 de apertura + 10 arrastrados - 10 caducados');

select private.ensure_balance(test.e(8), '7a000000-0000-4000-8000-000000000005', '2026-06-01');
select test.ok(test.avail(test.e(8), '7a000000-0000-4000-8000-000000000005', '2026-06-01') = 50,
  'Arrastre sin caducidad: 44 + 6 arrastrados se mantienen');

select private.ensure_balance(test.e(7), '7a000000-0000-4000-8000-000000000002', '2026-06-01');
select private.ensure_balance(test.e(7), '7a000000-0000-4000-8000-000000000002', '2026-06-01');
select test.ok((select count(*) = least(extract(month from test.today())::int - 1 + 12 * (extract(year from test.today())::int - 2026), 12)
  and sum(amount) = private.round_ratio(24::bigint * (least(date_trunc('month', test.today())::date, date '2027-01-01') - date '2026-01-01'),
    365, 1, 'nearest')
  from public.balance_movements m join public.vacation_balances b on b.id = m.balance_id
  where b.employee_id = test.e(7) and b.policy_id = '7a000000-0000-4000-8000-000000000002' and m.kind = 'accrual'),
  'Devengo mensual: un asiento por mes cerrado, acumulado sin decimales e idempotente');

select test.fails($$update public.balance_movements set amount = 99$$, 'Libro: los movimientos no se modifican', 'inmutable');
select test.fails($$delete from public.balance_movements$$, 'Libro: ni se borran', 'inmutable');

-- -----------------------------------------------------------------------------
-- Solicitudes de la persona
-- -----------------------------------------------------------------------------
set role authenticated;
select test.act_as(test.u(7));
select test.ok((select amount = 8 and cardinality(errors) = 0 from public.quote_absence_request(test.co('A'),
  '7f000000-0000-4000-8000-0000000000a1', 'day', test.monday(2), test.monday(2) + 6)),
  'Cómputo: de lunes a domingo con un festivo son 4 días laborables (8 medios días)');
select test.ok((select amount = 1 from public.quote_absence_request(test.co('A'),
  '7f000000-0000-4000-8000-0000000000a1', 'half_day', test.monday(3), test.monday(3), 'morning')),
  'Cómputo: medio día');
select test.ok((select errors[1] like 'La solicitud no incluye días laborables%' from public.quote_absence_request(test.co('A'),
  '7f000000-0000-4000-8000-0000000000a1', 'day', test.monday(2) + 5, test.monday(2) + 6)),
  'Cómputo: un fin de semana no consume vacaciones');
select test.ok((select 'Este tipo no admite esa unidad' = any (errors) from public.quote_absence_request(test.co('A'),
  '7f000000-0000-4000-8000-0000000000a1', 'hour', test.monday(3), test.monday(3), null, 540, 600)),
  'Unidad: las vacaciones no se piden por horas');
select test.ok((select amount = 90 and cardinality(errors) = 0 from public.quote_absence_request(test.co('A'),
  '7f000000-0000-4000-8000-0000000000a2', 'hour', test.monday(3), test.monday(3), null, 540, 630)),
  'Unidad: horas propias en minutos enteros');
select test.ok((select 'No se admiten fechas pasadas para este tipo' = any (errors) from public.quote_absence_request(test.co('A'),
  '7f000000-0000-4000-8000-0000000000a1', 'day', test.today() - 3, test.today() - 3)),
  'Fechas pasadas: no para vacaciones');
select test.ok((select errors[1] like 'Saldo insuficiente: disponible 600, solicitado 720%' from public.quote_absence_request(test.co('A'),
  '7f000000-0000-4000-8000-0000000000a2', 'hour', test.monday(3), test.monday(3), null, 480, 1200)),
  'Saldo: no se permite quedar en negativo sin política que lo autorice');

select test.avail(test.e(7), '7a000000-0000-4000-8000-000000000001', test.monday(2)) as avail_before \gset
select public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-0000000000a1', 'day', test.monday(2),
  test.monday(2) + 4, test.k(1), null, null, null, 'Viaje familiar') ->> 'routing' as routing \gset
select test.ok(:'routing' = 'manager', 'Aprobación: la instancia se crea con el manager vigente');
select test.ok((public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-0000000000a1', 'day', test.monday(2),
  test.monday(2) + 4, test.k(1)) ->> 'duplicate')::boolean, 'Idempotencia: la misma clave no duplica la solicitud');
select test.ok(test.avail(test.e(7), '7a000000-0000-4000-8000-000000000001', test.monday(2)) = :avail_before - 8,
  'Reserva: el saldo disponible baja al enviar');
select test.ok((select a.approver_user_id = test.u(6) and a.status = 'pending' from public.absence_approvals a
  join public.absence_requests r on r.id = a.request_id where r.idempotency_key = test.k(1)), 'Aprobación: aprobador = MGR');
select test.fails($$select public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-0000000000a1', 'half_day',
  test.monday(2) + 1, test.monday(2) + 1, test.k(2), 'afternoon')$$, 'Solapes: no se piden dos ausencias a la vez', 'Se solapa');
select test.fails($$select public.decide_absence_request((select id from public.absence_requests where idempotency_key = test.k(1)), 'approve')$$,
  'Autoaprobación: nadie decide sus propias solicitudes', 'no encontrada');
select test.fails($$insert into public.absence_requests (company_id, employee_id, absence_type_id, unit, start_date, end_date,
  period, amount, amount_unit, routing, idempotency_key) values (test.co('A'), test.e(7), '7f000000-0000-4000-8000-0000000000a1',
  'day', test.monday(5), test.monday(5), tstzrange(now(), now() + interval '1 day'), 2, 'half_days', 'manager', gen_random_uuid())$$,
  'E1: no crea solicitudes sin pasar por las validaciones', 'permission denied');
select test.fails($$select public.adjust_vacation_balance(test.e(7), '7a000000-0000-4000-8000-000000000001', test.today(), 10, 'Me lo regalo')$$,
  'E1: no ajusta su saldo', 'no encontrado');

-- Otra empresa, compañeros y membresía caducada no ven la solicitud.
select test.act_as(test.u(8));
select test.ok(not exists (select 1 from public.absence_requests where employee_id = test.e(7)), 'E2: no ve solicitudes de E1');
select test.ok(not exists (select 1 from public.balance_movements where employee_id = test.e(7)), 'E2: ni su saldo');
select test.act_as(test.u(12));
select test.ok(not exists (select 1 from public.absence_requests), 'CB: no ve solicitudes de otra empresa');
select test.act_as(test.u(14));
select test.ok(not exists (select 1 from public.absence_requests), 'EXP: con la membresía caducada no ve nada');
select test.act_as(test.u(17));
select test.ok(not exists (select 1 from public.absence_requests), 'MOLD: un manager caducado no ve solicitudes');

-- Decisión del manager: información, respuesta y aprobación.
select test.act_as(test.u(6));
select test.ok(exists (select 1 from public.absence_requests where idempotency_key = test.k(1)), 'MGR: ve la solicitud de quien supervisa');
select test.fails($$select public.decide_absence_request((select id from public.absence_requests where idempotency_key = test.k(1)), 'reject', '')$$,
  'Rechazo: exige motivo', 'motivo');
select public.decide_absence_request((select id from public.absence_requests where idempotency_key = test.k(1)), 'request_info',
  '¿Puedes confirmar las fechas con tu equipo?');
select test.act_as(test.u(7));
select test.ok((select status = 'info_requested' from public.absence_requests where idempotency_key = test.k(1)),
  'Información: la solicitud queda a la espera de respuesta (y conserva la reserva)');
select public.respond_absence_info((select id from public.absence_requests where idempotency_key = test.k(1)), 'Confirmado con el equipo');
select test.act_as(test.u(6));
select public.decide_absence_request((select id from public.absence_requests where idempotency_key = test.k(1)), 'approve');
select test.ok((select status = 'approved' and decided_by = test.u(6) from public.absence_requests where idempotency_key = test.k(1)),
  'Aprobación: queda registrada con su autor');
select test.ok((select string_agg(m.kind::text || ':' || m.amount, ',' order by m.created_at) from public.balance_movements m
  join public.absence_requests r on r.id = m.request_id where r.idempotency_key = test.k(1))
  = 'reservation:-8,reservation_release:8,usage:-8', 'Aprobar confirma la reserva como uso');
select test.fails($$select public.decide_absence_request((select id from public.absence_requests where idempotency_key = test.k(1)), 'reject', 'Tarde')$$,
  'Decisión: una solicitud decidida no se vuelve a decidir', 'no está pendiente');
reset role;
select test.ok((select status from private.planned_shift(test.e(7), test.monday(2))) = 'absence',
  'Integración: la ausencia aprobada llega al horario planificado');
set role authenticated;

-- Rechazar libera la reserva; cancelar también.
select test.act_as(test.u(7));
select test.avail(test.e(7), '7a000000-0000-4000-8000-000000000001', test.monday(3)) as avail_before \gset
select public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-0000000000a1', 'half_day', test.monday(3),
  test.monday(3), test.k(3), 'morning');
select public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-0000000000a1', 'day', test.monday(3) + 1,
  test.monday(3) + 1, test.k(4));
select test.act_as(test.u(6));
select public.decide_absence_request((select id from public.absence_requests where idempotency_key = test.k(3)), 'reject', 'Cierre trimestral');
select test.act_as(test.u(7));
select test.ok(public.cancel_absence_request((select id from public.absence_requests where idempotency_key = test.k(4))) = 'cancelled',
  'Cancelar: una solicitud pendiente se cancela');
select test.ok(test.avail(test.e(7), '7a000000-0000-4000-8000-000000000001', test.monday(3)) = :avail_before,
  'Rechazar y cancelar liberan todo lo reservado');

-- Retirar una aprobada futura devuelve el saldo y la quita del horario.
select test.ok(public.cancel_absence_request((select id from public.absence_requests where idempotency_key = test.k(1))) = 'withdrawn',
  'Retirar: una aprobada que no ha empezado se retira');
select test.ok(test.avail(test.e(7), '7a000000-0000-4000-8000-000000000001', test.monday(2)) = :avail_before + 8,
  'Retirar: el uso se revierte (vuelven los 8 medios días)');
reset role;
select test.ok((select status from private.planned_shift(test.e(7), test.monday(2))) <> 'absence',
  'Retirar: deja de aparecer como ausencia en el horario');

-- Ausencia imprevista ya iniciada: no se retira.
set role authenticated;
select test.act_as(test.u(7));
select public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-0000000000a3', 'day', test.prev_weekday(),
  test.prev_weekday(), test.k(5), null, null, null, 'Sin detalles');
select test.act_as(test.u(6));
select public.decide_absence_request((select id from public.absence_requests where idempotency_key = test.k(5)), 'approve');
select test.act_as(test.u(7));
select test.fails($$select public.cancel_absence_request((select id from public.absence_requests where idempotency_key = test.k(5)))$$,
  'Retirar: una ausencia ya iniciada no se retira', 'ya iniciada');

-- Regla expresa de aprobación automática.
select test.ok((public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-0000000000a4', 'day', test.monday(6),
  test.monday(6), test.k(6)) ->> 'status') = 'approved', 'Regla expresa: el tipo exento se aprueba solo');
select test.ok(exists (select 1 from public.absence_request_events ev join public.absence_requests r on r.id = ev.request_id
  where r.idempotency_key = test.k(6) and ev.action = 'auto_approved' and ev.message like '%Acuerdo de empresa 2026/1%'),
  'Regla expresa: queda constancia de la regla aplicada');

-- Sin aprobador vigente: escala a RR. HH. (E2 solo tiene una asignación caducada).
select test.act_as(test.u(8));
select test.ok((public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-0000000000a5', 'day', test.monday(2),
  test.monday(2), test.k(7)) ->> 'routing') = 'hr_no_approver', 'Sin aprobador: la solicitud va a RR. HH.');
select test.ok((public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-0000000000a1', 'day', test.monday(4),
  test.monday(4) + 1, test.k(8)) -> 'warnings' ->> 0) like 'El saldo quedará en negativo%',
  'Saldo negativo: solo con política explícita y avisándolo');
select test.ok(test.avail(test.e(8), '7a000000-0000-4000-8000-000000000004', test.monday(4)) = -2,
  'Saldo negativo: dentro del límite autorizado');
select test.fails($$select public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-0000000000a1', 'day', test.monday(4) + 3,
  test.monday(4) + 4, test.k(9))$$, 'Saldo negativo: nunca más allá del límite (-6 con límite -4)', 'Saldo insuficiente');
select test.act_as(test.u(6));
select test.fails($$select public.decide_absence_request((select id from public.absence_requests where idempotency_key = test.k(7)), 'approve')$$,
  'MGR: no decide solicitudes de quien no supervisa', 'no encontrada');
select test.act_as(test.u(5));
select public.decide_absence_request((select id from public.absence_requests where idempotency_key = test.k(7)), 'approve');
select test.ok((select status = 'approved' and decided_by = test.u(5) from public.absence_requests where idempotency_key = test.k(7)),
  'HRW: RR. HH. de su centro resuelve las escaladas');

-- -----------------------------------------------------------------------------
-- Justificantes: el manager solo ve que existen si son sensibles
-- -----------------------------------------------------------------------------
select test.act_as(test.u(7));
insert into storage.objects (bucket_id, name, owner) values ('absence-attachments',
  test.co('A') || '/' || test.e(7) || '/' || (select id from public.absence_requests where idempotency_key = test.k(5)) || '/'
  || test.k(100) || '.pdf', test.u(7));
select public.add_absence_attachment((select id from public.absence_requests where idempotency_key = test.k(5)),
  test.co('A') || '/' || test.e(7) || '/' || (select id from public.absence_requests where idempotency_key = test.k(5)) || '/'
  || test.k(100) || '.pdf', 'application/pdf', 20480);
select test.fails($$insert into storage.objects (bucket_id, name, owner) values ('absence-attachments',
  test.co('A') || '/' || test.e(8) || '/' || (select id from public.absence_requests where idempotency_key = test.k(5)) || '/'
  || test.k(101) || '.pdf', test.u(7))$$, 'Justificante: nadie sube en la ruta de otra persona', 'row-level security');
select test.ok(exists (select 1 from storage.objects where bucket_id = 'absence-attachments'), 'Justificante: la persona lo ve');
select test.act_as(test.u(6));
select test.ok(exists (select 1 from public.absence_attachments), 'MGR: sabe que hay justificante');
select test.ok(not exists (select 1 from storage.objects where bucket_id = 'absence-attachments'),
  'MGR: no abre un justificante sensible');
select test.act_as(test.u(3));
select test.ok(not exists (select 1 from storage.objects where bucket_id = 'absence-attachments'),
  'CA: la administración de empresa no abre justificantes sensibles');
select test.fails($$select public.open_absence_attachment((select id from public.absence_attachments limit 1))$$,
  'CA: tampoco obtiene la ruta para firmarla', 'no encontrado');
select test.act_as(test.u(4));
select test.ok(exists (select 1 from storage.objects where bucket_id = 'absence-attachments'),
  'HR: RR. HH. con permiso de justificantes lo abre');
select test.ok(public.open_absence_attachment((select id from public.absence_attachments limit 1)) like '%.pdf',
  'HR: obtiene la ruta del justificante para firmarla');
select test.act_as(test.u(3));
select test.ok((select count(*) from public.audit_events where entity = 'absence_attachments' and action = 'sensitive_read'
  and actor_id = test.u(4)) = 1, 'Justificante: cada apertura queda auditada (quién y cuándo)');
select test.act_as(test.u(4));
select test.act_as(test.u(12));
select test.ok(not exists (select 1 from storage.objects where bucket_id = 'absence-attachments')
  and not exists (select 1 from public.absence_attachments), 'CB: ni metadatos ni archivo de otra empresa');

select test.act_as(test.u(7));
select public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-0000000000a5', 'day', test.monday(7),
  test.monday(7), test.k(10));
insert into storage.objects (bucket_id, name, owner) values ('absence-attachments',
  test.co('A') || '/' || test.e(7) || '/' || (select id from public.absence_requests where idempotency_key = test.k(10)) || '/'
  || test.k(102) || '.pdf', test.u(7));
select public.add_absence_attachment((select id from public.absence_requests where idempotency_key = test.k(10)),
  test.co('A') || '/' || test.e(7) || '/' || (select id from public.absence_requests where idempotency_key = test.k(10)) || '/'
  || test.k(102) || '.pdf', 'application/pdf', 1024);
select test.act_as(test.u(6));
select test.ok((select count(*) from storage.objects where bucket_id = 'absence-attachments') = 1,
  'MGR: abre solo el justificante no sensible, necesario para decidir');

-- -----------------------------------------------------------------------------
-- Calendario: compañeros solo ven "Ausente"
-- -----------------------------------------------------------------------------
reset role;
update public.employees set team_id = test.team('AT1') where id = test.e(8);
set role authenticated;
select test.act_as(test.u(8));
select test.ok((select bool_and(label = 'Ausente' and relation = 'peer') from public.absence_calendar(test.co('A'),
  test.today() - 7, test.today() + 55) where employee_id = test.e(7)), 'Calendario: un compañero solo ve "Ausente"');
select test.ok(not exists (select 1 from public.absence_calendar(test.co('A'), test.today() - 7, test.today() + 55)
  where employee_id = test.e(7) and status <> 'approved'), 'Calendario: los compañeros no ven solicitudes pendientes');
select test.act_as(test.u(6));
select test.ok((select label from public.absence_calendar(test.co('A'), test.today() - 7, test.today() + 55)
  where employee_id = test.e(7) and start_date = test.prev_weekday()) = 'Ausencia',
  'Calendario: al manager, un tipo reservado se le muestra como "Ausencia"');
select test.act_as(test.u(4));
select test.ok((select label from public.absence_calendar(test.co('A'), test.today() - 7, test.today() + 55)
  where employee_id = test.e(7) and start_date = test.prev_weekday()) = 'Ausencia médica',
  'Calendario: RR. HH. ve el tipo');
select test.fails($$select * from public.absence_calendar(test.co('A'), test.today(), test.today() + 90)$$,
  'Calendario: rango máximo de 62 días', 'máximo');
select test.act_as(test.u(7));
select test.ok(exists (select 1 from public.work_events where event_type = 'absence_decided' and payload ->> 'type' is null),
  'Avisos: el tipo reservado no aparece en el aviso');

-- -----------------------------------------------------------------------------
-- Cambio de política: nunca hacia atrás
-- -----------------------------------------------------------------------------
select test.act_as(test.u(4));
insert into public.vacation_policy_versions (company_id, policy_id, version, unit, entitlement)
values (test.co('A'), '7a000000-0000-4000-8000-000000000001', 2, 'half_days', 60);
select test.fails($$select public.publish_vacation_policy_version((select id from public.vacation_policy_versions
  where policy_id = '7a000000-0000-4000-8000-000000000001' and version = 2), test.today() - 1)$$,
  'Política: no se publica con efecto en el pasado', 'hoy o una fecha futura');
select public.publish_vacation_policy_version((select id from public.vacation_policy_versions
  where policy_id = '7a000000-0000-4000-8000-000000000001' and version = 2), test.today() + 1);
select test.ok(test.affected($$update public.vacation_policy_versions set entitlement = 99 where version = 1
  and policy_id = '7a000000-0000-4000-8000-000000000001'$$) = 0, 'Política: RR. HH. no modifica una versión publicada');
reset role;
select test.fails($$update public.vacation_policy_versions set entitlement = 99 where version = 1
  and policy_id = '7a000000-0000-4000-8000-000000000001'$$, 'Política: ni siquiera como servicio', 'versión nueva');
select test.ok((select amount = 44 from public.balance_movements m join public.vacation_balances b on b.id = m.balance_id
  where b.employee_id = test.e(7) and b.period_start = '2026-01-01' and b.policy_id = '7a000000-0000-4000-8000-000000000001'
    and m.kind = 'opening'), 'Cambio de política: el periodo ya abierto no se recalcula');
select private.ensure_balance(test.e(7), '7a000000-0000-4000-8000-000000000001',
  (date_trunc('year', test.today()) + interval '1 year')::date);
select test.ok((select amount = 60 from public.balance_movements m join public.vacation_balances b on b.id = m.balance_id
  where b.employee_id = test.e(7) and b.period_start = (date_trunc('year', test.today()) + interval '1 year')::date
    and b.policy_id = '7a000000-0000-4000-8000-000000000001' and m.kind = 'opening'),
  'Cambio de política: el periodo siguiente usa la versión vigente en su inicio');
select test.ok((select status = 'open' from public.vacation_balances where employee_id = test.e(7)
  and period_start = date_trunc('year', test.today())::date and policy_id = '7a000000-0000-4000-8000-000000000001'),
  'Cambio de año: un periodo que no ha terminado no se cierra');

-- Ajuste manual auditado por RR. HH.
set role authenticated;
select test.act_as(test.u(4));
select public.adjust_vacation_balance(test.e(7), '7a000000-0000-4000-8000-000000000001', test.today(), 2,
  'Regularización por error de cálculo');
reset role;
select test.ok(exists (select 1 from public.audit_log where table_name = 'balance_movements' and new_data ->> 'kind' = 'adjustment'),
  'Auditoría: los ajustes manuales quedan en audit_log');
select test.ok(not exists (select 1 from public.audit_log where table_name in ('absence_requests', 'absence_request_events')
  or new_data::text like '%Sin detalles%' or new_data::text like '%Viaje familiar%'),
  'Privacidad: ni solicitudes ni sus comentarios van a audit_log');
select test.ok(exists (select 1 from public.audit_log where table_name = 'vacation_policy_versions'),
  'Auditoría: la configuración de políticas queda en audit_log');

\echo 'Pruebas de ausencias superadas.'
