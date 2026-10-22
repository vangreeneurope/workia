-- =============================================================================
-- Liquidación de gastos: informes mensuales con snapshot, versiones tras una
-- devolución, aprobación por líneas y pasos con reglas, delegación,
-- segregación (nadie aprueba lo suyo ni dos pasos), cierre contable idempotente
-- con exclusión autorizada, totales por moneda y dimensión, lote corrector,
-- exportaciones privadas y registro de descargas. Las carreras de cierre están
-- en scripts/test-db-concurrency.sh.
-- Escenario: helpers/fixtures.sql (E1 = u07/e07 supervisado por MGR = u06;
-- E2 = u08/e08 sin manager vigente; ACC = u09; CA = u03; HR = u04; CB = u12;
-- EXP = u14 con membresía caducada).
-- =============================================================================

\ir helpers/asserts.sql
\ir helpers/fixtures.sql

create or replace function test.today() returns date language sql stable as
  $$ select (now() at time zone 'Europe/Madrid')::date $$;
-- Mes anterior completo: el periodo de las pruebas.
create or replace function test.period() returns date language sql stable as
  $$ select (date_trunc('month', test.today()) - interval '1 month')::date $$;
create or replace function test.x(n int) returns uuid language sql immutable as
  $$ select ('ab000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function test.k(n int) returns uuid language sql immutable as
  $$ select ('ac000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function test.cat(p_code text) returns uuid language sql stable security definer as
  $$ select id from public.expense_categories where company_id = test.co('A') and code = p_code $$;
create or replace function test.report(p_key uuid) returns public.expense_reports language sql stable security definer as
  $$ select * from public.expense_reports where idempotency_key = p_key $$;
create or replace function test.item(p_key uuid, p_expense uuid) returns uuid language sql stable security definer as $$
  select i.id from public.expense_report_items i join public.expense_reports r on r.id = i.report_id
  where r.idempotency_key = p_key and i.expense_id = p_expense
$$;
create or replace function test.step(p_key uuid, p_order int) returns public.approval_steps language sql stable security definer as $$
  select s.* from public.approval_steps s join public.approval_instances ai on ai.id = s.instance_id
  join public.expense_reports r on r.id = ai.report_id where r.idempotency_key = p_key and s.step_order = p_order
$$;
create or replace function test.batch(p_key uuid) returns public.accounting_batches language sql stable security definer as
  $$ select * from public.accounting_batches where idempotency_key = p_key $$;
grant execute on function test.today(), test.period(), test.x(int), test.k(int), test.cat(text), test.report(uuid),
  test.item(uuid, uuid), test.step(uuid, int), test.batch(uuid) to public;

-- -----------------------------------------------------------------------------
-- Datos (como servicio): política, categorías, mapeo, regla y gastos listos
-- -----------------------------------------------------------------------------
insert into public.expense_policies (company_id, allowed_currencies, receipt_required)
values (test.co('A'), '{EUR,USD}', false);
insert into public.expense_categories (company_id, code, name) values
  (test.co('A'), 'VIAJE', 'Viajes'), (test.co('A'), 'COMIDA', 'Comidas');
insert into public.expense_account_mappings (company_id, category_id, account_code, tax_account_code)
values (test.co('A'), test.cat('VIAJE'), '6291', '472');
-- Paso adicional: la administración de empresa aprueba informes de 40 € o más.
insert into public.expense_approval_rules (company_id, name, step_order, currency, min_total_cents, approver_role)
values (test.co('A'), 'Importes altos', 2, 'EUR', 4000, 'company_admin');

insert into public.expenses (id, company_id, employee_id, source, status, idempotency_key, category_id, expense_date,
  merchant_name, currency, base_cents, tax_cents, total_cents, payment_method, project_code, cost_center, confirmed_at)
values
  (test.x(1), test.co('A'), test.e(7), 'manual', 'ready', test.x(1), test.cat('VIAJE'), test.period() + 2,
    'Tren Sintético', 'EUR', 1020, 214, 1234, 'personal_card', 'P1', 'CC1', now()),
  (test.x(2), test.co('A'), test.e(7), 'manual', 'ready', test.x(2), test.cat('COMIDA'), test.period() + 5,
    'Bar Sintético', 'EUR', null, null, 3333, 'cash', null, 'CC1', now()),
  (test.x(3), test.co('A'), test.e(7), 'manual', 'ready', test.x(3), test.cat('VIAJE'), test.period() + 6,
    'Taxi Sintético', 'USD', null, null, 999, 'cash', null, null, now()),
  (test.x(4), test.co('A'), test.e(7), 'manual', 'draft', test.x(4), test.cat('VIAJE'), test.period() + 7,
    'Borrador', 'EUR', null, null, 100, 'cash', null, null, null),
  (test.x(5), test.co('A'), test.e(7), 'manual', 'ready', test.x(5), test.cat('VIAJE'), test.period() - 3,
    'Mes anterior', 'EUR', null, null, 700, 'cash', null, null, now()),
  (test.x(6), test.co('A'), test.e(7), 'manual', 'ready', test.x(6), test.cat('VIAJE'), test.period() + 8,
    'Hotel Sintético', 'USD', 1652, 347, 1999, 'company_card', 'P2', null, now()),
  (test.x(7), test.co('A'), test.e(7), 'manual', 'ready', test.x(7), test.cat('COMIDA'), test.period() + 9,
    'Café', 'EUR', null, null, 10, 'cash', null, null, now()),
  (test.x(8), test.co('A'), test.e(7), 'manual', 'ready', test.x(8), test.cat('COMIDA'), test.period() + 9,
    'Agua', 'EUR', null, null, 20, 'cash', null, null, now()),
  (test.x(20), test.co('A'), test.e(8), 'manual', 'ready', test.x(20), test.cat('COMIDA'), test.period() + 3,
    'Comida Sintética', 'EUR', null, null, 5000, 'cash', null, null, now());

-- -----------------------------------------------------------------------------
-- Envío del informe mensual
-- -----------------------------------------------------------------------------
set role authenticated;
select test.act_as(test.u(7));
select public.submit_expense_report(test.co('A'), test.period(), test.k(1));
select test.ok((select count(*) from public.expense_report_items where report_id = (test.report(test.k(1))).id) = 6
  and test.item(test.k(1), test.x(4)) is null and test.item(test.k(1), test.x(5)) is null,
  'Envío: incluye solo los gastos listos del mes (ni borradores ni de otro mes)');
select test.ok(public.submit_expense_report(test.co('A'), test.period(), test.k(1)) = (test.report(test.k(1))).id
  and (select count(*) from public.expense_reports) = 1, 'Envío: reintentar con la misma clave devuelve el mismo informe');
select test.fails($$select public.submit_expense_report(test.co('A'), test.period(), test.k(2))$$,
  'Envío: no hay dos informes del mismo mes en revisión', 'en revisión');
select test.fails($$select public.submit_expense_report(test.co('A'), (date_trunc('month', test.today()) + interval '1 month')::date, test.k(3))$$,
  'Envío: no se envía un mes futuro', 'ya haya empezado');
select test.fails($$select public.submit_expense_report(test.co('A'), (test.period() - interval '2 months')::date, test.k(3))$$,
  'Envío: sin gastos listos no hay informe', 'No hay gastos listos');
select test.ok((test.step(test.k(1), 1)).assigned_user_id = test.u(6) and (test.step(test.k(1), 1)).routing = 'manager'
  and (test.step(test.k(1), 2)).assigned_role = 'company_admin' and (test.step(test.k(1), 2)).status = 'waiting',
  'Aprobación: paso del manager vigente y paso adicional por la regla de importe');
select test.fails($$select public.reopen_expense(test.x(1))$$, 'Bloqueo: un gasto enviado no se reabre', 'informe enviado');
select test.ok(test.affected($$update public.expenses set total_cents = 1 where id = test.x(1)$$) = 0,
  'Bloqueo: un gasto enviado no se edita');
reset role;
select test.fails($$update public.expense_report_items set total_cents = 1 where id = test.item(test.k(1), test.x(1))$$,
  'Snapshot: la copia del gasto en el informe es inmutable (ni como servicio)', 'inmutable');
select test.ok((select snapshot ->> 'merchant_name' = 'Tren Sintético' and snapshot_hash ~ '^[0-9a-f]{64}$'
  from public.expense_report_items where id = test.item(test.k(1), test.x(1))), 'Snapshot: guarda los datos y su huella');

-- -----------------------------------------------------------------------------
-- Quién ve y quién decide
-- -----------------------------------------------------------------------------
set role authenticated;
select test.fails($$select public.decide_report_line(test.item(test.k(1), test.x(1)), 'approved')$$,
  'Autoaprobación: nadie decide sus propios gastos', 'no encontrada');
select test.act_as(test.u(8));
select test.ok(not exists (select 1 from public.expense_reports), 'E2: no ve informes de otra persona');
select test.act_as(test.u(4));
select test.ok(not exists (select 1 from public.expense_reports), 'HR: RR. HH. no ve informes de gastos');
select test.act_as(test.u(12));
select test.ok(not exists (select 1 from public.expense_reports) and not exists (select 1 from public.expense_report_items),
  'CB: nada de otra empresa');
select test.act_as(test.u(14));
select test.ok(not exists (select 1 from public.expense_reports), 'EXP: membresía caducada, nada');
select test.act_as(test.u(9));
select test.ok(exists (select 1 from public.expense_reports), 'ACC: Contabilidad ve los informes');
select test.ok(not exists (select 1 from public.my_pending_expense_approvals(test.co('A'))),
  'Bandeja: Contabilidad no tiene informes que aprobar');
select test.fails($$select public.decide_report_line(test.item(test.k(1), test.x(1)), 'approved')$$,
  'ACC: Contabilidad no decide en el paso del manager', 'no encontrada');
select test.act_as(test.u(3));
select test.fails($$select public.decide_report_line(test.item(test.k(1), test.x(1)), 'approved')$$,
  'CA: no decide en el paso de otro manager', 'no encontrada');

-- -----------------------------------------------------------------------------
-- Decisión por líneas y devolución (versión 1)
-- -----------------------------------------------------------------------------
select test.act_as(test.u(6));
select test.ok((select count(*) from public.my_pending_expense_approvals(test.co('A'))) = 1,
  'Bandeja: el manager tiene el informe pendiente');
select public.decide_report_line(test.item(test.k(1), test.x(1)), 'approved');
select public.decide_report_line(test.item(test.k(1), test.x(6)), 'approved');
select public.decide_report_line(test.item(test.k(1), test.x(7)), 'approved');
select public.decide_report_line(test.item(test.k(1), test.x(8)), 'approved');
select test.fails($$select public.decide_report_line(test.item(test.k(1), test.x(3)), 'rejected')$$,
  'Líneas: rechazar exige motivo', 'motivo');
select public.decide_report_line(test.item(test.k(1), test.x(3)), 'rejected', 'No es un gasto de empresa');
select test.fails($$select public.complete_report_step((test.report(test.k(1))).id, 'approve')$$,
  'Revisión: no termina con líneas sin decidir', 'Decide todas');
select public.decide_report_line(test.item(test.k(1), test.x(2)), 'returned', 'Falta el ticket de la comida');
select test.ok((test.report(test.k(1))).status = 'in_review', 'Estados: submitted -> in_review al decidir');
select test.ok(public.complete_report_step((test.report(test.k(1))).id, 'approve') = 'returned',
  'Devolución: una línea devuelta devuelve el informe');
select test.ok((test.step(test.k(1), 2)).status = 'skipped' and (test.report(test.k(1))).status = 'returned',
  'Devolución: los pasos siguientes se omiten');
select test.fails($$select public.decide_report_line(test.item(test.k(1), test.x(1)), 'rejected', 'Cambio de idea')$$,
  'Versión devuelta: sus decisiones ya no cambian', 'no está en revisión');

-- La persona corrige la línea devuelta; la rechazada queda fuera para siempre.
select test.act_as(test.u(7));
select public.reopen_expense(test.x(2));
update public.expenses set total_cents = 3000 where id = test.x(2);
reset role;
update public.expenses set status = 'ready', confirmed_at = now() where id = test.x(2);
set role authenticated;
select test.fails($$select public.reopen_expense(test.x(3))$$, 'Rechazo: un gasto rechazado no se reabre', 'informe enviado');

-- Delegación: el manager tiene suplente para gastos.
reset role;
insert into public.approver_substitutions (company_id, absent_user_id, substitute_user_id, request_type, valid_from, valid_to,
  reason)
values (test.co('A'), test.u(6), test.u(4), 'expenses', now() - interval '1 hour', now() + interval '7 days', 'Vacaciones');
set role authenticated;
select test.act_as(test.u(7));
select public.submit_expense_report(test.co('A'), test.period(), test.k(2));
select test.ok((test.report(test.k(2))).version = 2 and (test.report(test.k(2))).previous_version_id = (test.report(test.k(1))).id,
  'Nueva versión: enlazada a la devuelta');
select test.ok((select count(*) from public.expense_report_items where report_id = (test.report(test.k(2))).id) = 5
  and test.item(test.k(2), test.x(3)) is null, 'Nueva versión: sin la línea rechazada');
select test.ok((select decision = 'approved' and carried_from_item_id = test.item(test.k(1), test.x(1))
  from public.expense_report_items where id = test.item(test.k(2), test.x(1)))
  and (select decision = 'pending' from public.expense_report_items where id = test.item(test.k(2), test.x(2))),
  'Nueva versión: conserva lo aprobado sin cambios y pide revisar lo corregido');
select test.ok((select count(*) from public.expense_report_items where report_id = (test.report(test.k(1))).id) = 6
  and (select total_cents from public.expense_report_items where id = test.item(test.k(1), test.x(2))) = 3333,
  'Versión anterior: queda intacta');
select test.ok((test.step(test.k(2), 1)).routing = 'substitute' and (test.step(test.k(2), 1)).assigned_user_id = test.u(4)
  and (test.step(test.k(2), 1)).delegated_from_user_id = test.u(6), 'Delegación: el paso va a la suplente y lo registra');

select test.act_as(test.u(4));
select public.decide_report_line(test.item(test.k(2), test.x(2)), 'approved');
select test.ok(public.complete_report_step((test.report(test.k(2))).id, 'approve') = 'in_review',
  'Pasos: tras el manager pasa al paso adicional');
select test.ok((test.step(test.k(2), 1)).acted_by = test.u(4) and (test.step(test.k(2), 2)).status = 'pending',
  'Delegación: actuó la suplente y queda registrado');
select test.fails($$select public.complete_report_step((test.report(test.k(2))).id, 'approve')$$,
  'Segregación: quien actuó no aprueba otro paso', 'no encontrado');
select test.act_as(test.u(3));
select test.fails($$select public.complete_report_step((test.report(test.k(2))).id, 'return')$$,
  'Paso adicional: devolver exige motivo', 'motivo');
select test.ok(public.complete_report_step((test.report(test.k(2))).id, 'approve') = 'approved',
  'Paso adicional: la administración aprueba y el informe queda aprobado');

-- E2 no tiene manager: la administración hace de respaldo; nadie aprueba dos pasos.
select test.act_as(test.u(8));
select public.submit_expense_report(test.co('A'), test.period(), test.k(20));
select test.ok((test.step(test.k(20), 1)).routing = 'admin_no_approver' and (test.step(test.k(20), 1)).assigned_role = 'company_admin',
  'Sin aprobador: el paso va a la administración con permiso de aprobación');
select test.act_as(test.u(3));
select public.decide_report_line(test.item(test.k(20), test.x(20)), 'approved');
select public.complete_report_step((test.report(test.k(20))).id, 'approve');
select test.fails($$select public.complete_report_step((test.report(test.k(20))).id, 'approve')$$,
  'Segregación: la misma persona no aprueba los dos pasos', 'no encontrado');
reset role;
select test.fails($$update public.expense_reports set status = 'submitted' where idempotency_key = test.k(2)$$,
  'Transiciones: approved -> submitted no está permitida', 'no permitida');

-- -----------------------------------------------------------------------------
-- Cierre contable
-- -----------------------------------------------------------------------------
set role authenticated;
select test.act_as(test.u(3));
select test.fails($$select public.close_accounting_period(test.co('A'), test.period(), test.k(100))$$,
  'Cierre: la administración no cierra (solo Contabilidad)', 'Contabilidad');
select test.act_as(test.u(6));
select test.fails($$select public.close_accounting_period(test.co('A'), test.period(), test.k(100))$$,
  'Cierre: el manager no cierra', 'Contabilidad');
select test.act_as(test.u(9));
select test.ok(exists (select 1 from public.accounting_close_blockers(test.co('A'), test.period())
  where kind = 'pending_report' and report_id = (test.report(test.k(20))).id), 'Consola: el informe pendiente aparece como bloqueo');
select test.fails($$select public.close_accounting_period(test.co('A'), test.period(), test.k(100))$$,
  'Cierre: no se cierra con informes pendientes', 'pendientes');
select test.fails($$select public.close_accounting_period(test.co('A'), test.period(), test.k(100),
  array[(test.report(test.k(20))).id], 'Corto')$$, 'Exclusión: exige un motivo', 'Explica por qué');
select public.close_accounting_period(test.co('A'), test.period(), test.k(100),
  array[(test.report(test.k(20))).id], 'Pendiente de un segundo aprobador; va al mes siguiente');
select test.ok((test.batch(test.k(100))).sequence = 1 and (test.batch(test.k(100))).kind = 'regular',
  'Cierre: lote 1 de la empresa');
select test.ok(public.close_accounting_period(test.co('A'), test.period(), test.k(100)) = (test.batch(test.k(100))).id,
  'Cierre: reintentar con la misma clave devuelve el mismo lote');
select test.ok((select count(*) from public.accounting_batches) = 1, 'Cierre: el reintento no crea otro lote');
select test.fails($$select public.close_accounting_period(test.co('A'), test.period(), test.k(101))$$,
  'Doble cierre: otro intento del mismo periodo se rechaza', 'ya está cerrado');
select test.ok((test.report(test.k(2))).status = 'included_in_batch' and (test.report(test.k(20))).status = 'in_review',
  'Cierre: el informe aprobado pasa al lote; el excluido sigue pendiente');
select test.ok(exists (select 1 from public.accounting_batch_exclusions where report_id = (test.report(test.k(20))).id
  and authorized_by = test.u(9)), 'Exclusión: queda registrada con su autor');

-- Totales: céntimos exactos y monedas por separado.
select test.ok((select count(*) from public.accounting_batch_lines where batch_id = (test.batch(test.k(100))).id) = 5,
  'Lote: una línea por gasto aprobado');
select test.ok((select total_cents = 4264 and base_cents = 1020 and tax_cents = 214 and lines = 4
  from public.accounting_batch_totals((test.batch(test.k(100))).id) where dimension = 'total' and currency = 'EUR')
  and (select total_cents = 1999 from public.accounting_batch_totals((test.batch(test.k(100))).id)
    where dimension = 'total' and currency = 'USD'),
  'Totales: 12,34 + 30,00 + 0,10 + 0,20 = 42,64 EUR exactos y 19,99 USD aparte');
select test.ok((select total_cents from public.accounting_batch_totals((test.batch(test.k(100))).id)
  where dimension = 'account' and key = '6291' and currency = 'EUR') = 1234
  and (select total_cents from public.accounting_batch_totals((test.batch(test.k(100))).id)
  where dimension = 'account' and key = '629' and currency = 'EUR') = 3030,
  'Totales por cuenta: mapeo por categoría y cuenta por defecto');
select test.ok((select sum(total_cents) from public.accounting_batch_totals((test.batch(test.k(100))).id)
  where dimension in ('employee', 'category', 'cost_center', 'project') and currency = 'EUR') = 4 * 4264,
  'Totales: cada dimensión suma lo mismo que el total');
select test.ok((select string_agg(employee_code || ':' || line_no, ',' order by line_no) from public.accounting_batch_lines
  where batch_id = (test.batch(test.k(100))).id) = 'A-007:1,A-007:2,A-007:3,A-007:4,A-007:5',
  'Lote: numeración de líneas determinista');

reset role;
select test.fails($$update public.accounting_batch_lines set total_cents = 1$$, 'Lote: sus líneas son inmutables', 'inmutable');
select test.fails($$update public.accounting_batches set note = 'cambio' where idempotency_key = test.k(100)$$,
  'Lote: un cierre no se sobrescribe', 'lote corrector');

-- Lote corrector.
set role authenticated;
select test.act_as(test.u(9));
select test.fails($$select public.create_corrective_batch((test.batch(test.k(100))).id, test.k(102), false,
  '[{"employee_id": "e0000000-0000-0000-0000-000000000007", "category_id": "00000000-0000-0000-0000-000000000000", "currency": "EUR", "total_cents": -500, "reason": "Error"}]',
  'Ajuste del lote 1 por error')$$, 'Corrector: la categoría debe ser de la empresa', 'no válida');
select public.create_corrective_batch((test.batch(test.k(100))).id, test.k(102), false,
  jsonb_build_array(jsonb_build_object('employee_id', test.e(7), 'category_id', test.cat('COMIDA'), 'currency', 'EUR',
    'total_cents', -500, 'reason', 'Anticipo ya pagado en efectivo')), 'Regularización del lote 1');
select test.ok((test.batch(test.k(102))).kind = 'corrective' and (test.batch(test.k(102))).sequence = 2
  and (test.batch(test.k(102))).corrects_batch_id = (test.batch(test.k(100))).id, 'Corrector: lote 2 que corrige el 1');
select test.ok(public.create_corrective_batch((test.batch(test.k(100))).id, test.k(102), false, '[]', 'Repetido 12345')
  = (test.batch(test.k(102))).id, 'Corrector: idempotente');
select test.ok((select sum(total_cents) from public.accounting_batch_lines where batch_id = (test.batch(test.k(100))).id
  and currency = 'EUR') = 4264, 'Corrector: el lote original no cambia');

-- Exportaciones: solo Contabilidad sube, registra y descarga.
insert into storage.objects (bucket_id, name, owner) values ('accounting-exports',
  test.co('A') || '/lotes/' || (test.batch(test.k(100))).id || '/liquidacion-lote-0001.csv', test.u(9));
select test.ok(public.register_accounting_export((test.batch(test.k(100))).id, 'csv', 'liquidacion-lote-0001.csv',
  test.co('A') || '/lotes/' || (test.batch(test.k(100))).id || '/liquidacion-lote-0001.csv', repeat('a', 64), 1234) is not null,
  'Exportación: se registra con su huella');
select test.ok(public.register_accounting_export((test.batch(test.k(100))).id, 'csv', 'liquidacion-lote-0001.csv',
  test.co('A') || '/lotes/' || (test.batch(test.k(100))).id || '/liquidacion-lote-0001.csv', repeat('a', 64), 1234)
  = (select id from public.accounting_exports where format = 'csv'), 'Reexportación: el mismo archivo devuelve el registro');
select test.fails($$select public.register_accounting_export((test.batch(test.k(100))).id, 'csv', 'liquidacion-lote-0001.csv',
  test.co('A') || '/lotes/' || (test.batch(test.k(100))).id || '/liquidacion-lote-0001.csv', repeat('b', 64), 1234)$$,
  'Reexportación: un archivo distinto para el mismo lote se rechaza', 'no coincide');
select test.ok(public.log_export_download((select id from public.accounting_exports where format = 'csv')) like '%/lotes/%',
  'Descarga: Contabilidad descarga');
select test.ok((select string_agg(action, ',' order by id) from public.accounting_export_events) = 'generated,downloaded',
  'Registro: generación y descarga');
select test.act_as(test.u(3));
select test.fails($$select public.log_export_download((select id from public.accounting_exports where format = 'csv'))$$,
  'Descarga: la administración no descarga el paquete', 'no encontrado');
select test.ok(not exists (select 1 from storage.objects where bucket_id = 'accounting-exports'),
  'Storage: la administración no abre el paquete');
select test.fails($$insert into storage.objects (bucket_id, name, owner) values ('accounting-exports',
  test.co('A') || '/lotes/' || (test.batch(test.k(100))).id || '/otro.pdf', test.u(3))$$,
  'Storage: solo Contabilidad sube paquetes', 'row-level security');
select test.act_as(test.u(6));
select test.ok(not exists (select 1 from public.accounting_batches) and not exists (select 1 from public.accounting_batch_lines),
  'MGR: no ve lotes contables');
select test.act_as(test.u(12));
select test.ok(not exists (select 1 from public.accounting_batches) and not exists (select 1 from storage.objects
  where bucket_id = 'accounting-exports'), 'CB: nada contable de otra empresa');
select test.act_as(test.u(9));
select test.ok(exists (select 1 from storage.objects where bucket_id = 'accounting-exports'), 'ACC: abre el paquete');

-- Contabilizado.
select public.mark_batch_accounted((test.batch(test.k(100))).id);
select public.mark_batch_accounted((test.batch(test.k(100))).id);
select test.ok((test.report(test.k(2))).status = 'accounted' and (test.batch(test.k(100))).status = 'accounted',
  'Contabilizado: el lote y sus informes (idempotente)');
select test.act_as(test.u(7));
select test.fails($$select public.reopen_expense(test.x(1))$$, 'Contabilizado: el gasto ya no se reabre', 'informe enviado');

reset role;
select test.ok(exists (select 1 from public.audit_log where table_name = 'accounting_batch_exclusions')
  and exists (select 1 from public.audit_log where table_name = 'approval_steps')
  and exists (select 1 from public.audit_log where table_name = 'accounting_batches'),
  'Auditoría: exclusiones, pasos y cierres');

\echo 'Pruebas de liquidación superadas.'
