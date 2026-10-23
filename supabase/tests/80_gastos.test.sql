-- =============================================================================
-- Gastos: configuración, subida de tickets (rutas y Storage), duplicados exactos
-- y por similitud, cola de OCR idempotente con reintentos limitados, revisión
-- obligatoria de campos de baja confianza, reglas de confirmación, kilometraje,
-- inmutabilidad del ticket y aislamiento (otra empresa, otra persona, manager,
-- Contabilidad, membresía caducada). La concurrencia real está en
-- scripts/test-db-concurrency.sh.
-- Escenario: helpers/fixtures.sql (E1 = u07/e07 supervisado por MGR = u06;
-- E2 = u08/e08; ACC = u09 contabilidad de A; CA = u03; HR = u04; GA = u02;
-- CB = u12 de B; EXP = u14 con membresía caducada).
-- =============================================================================

\ir helpers/asserts.sql
\ir helpers/fixtures.sql

create or replace function test.today() returns date language sql stable as
  $$ select (now() at time zone 'Europe/Madrid')::date $$;
create or replace function test.k(n int) returns uuid language sql immutable as
  $$ select ('9d000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function test.sha(n int) returns text language sql immutable as
  $$ select repeat(to_hex(n % 16), 64) $$;
-- Ruta de un ticket: <empresa>/<empleado>/<año>/<mes>/<clave>.<ext>
create or replace function test.p(p_company uuid, p_employee uuid, p_key uuid, p_ext text default 'jpg')
returns text language sql stable as $$
  select p_company || '/' || p_employee || '/' || to_char(test.today(), 'YYYY/MM') || '/' || p_key || '.' || p_ext
$$;
create or replace function test.expense(p_key uuid) returns uuid language sql stable security definer as
  $$ select id from public.expenses where idempotency_key = p_key $$;
create or replace function test.job(p_key uuid) returns public.jobs language sql stable security definer as $$
  select j.* from public.jobs j join public.expense_receipts r on j.dedupe_key = r.id::text
  join public.expenses x on x.id = r.expense_id where x.idempotency_key = p_key
$$;
create or replace function test.cat(p_code text) returns uuid language sql stable security definer as
  $$ select id from public.expense_categories where company_id = test.co('A') and code = p_code $$;
grant execute on function test.cat(text), test.today(), test.k(int), test.sha(int), test.p(uuid, uuid, uuid, text),
  test.expense(uuid), test.job(uuid) to public;

-- Sube el objeto (como la persona) y registra el ticket.
create or replace function test.upload(p_employee uuid, p_key uuid, p_sha text, p_ext text default 'jpg')
returns uuid language plpgsql as $$
declare result uuid;
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('expense-receipts', test.p(test.co('A'), p_employee, p_key, p_ext), (select auth.uid()));
  select expense_id into result from public.register_expense_receipt(test.co('A'), p_key,
    test.p(test.co('A'), p_employee, p_key, p_ext), p_sha,
    case p_ext when 'pdf' then 'application/pdf' when 'png' then 'image/png' else 'image/jpeg' end,
    20000, true, case when p_ext = 'pdf' then null else 1200 end, case when p_ext = 'pdf' then null else 1600 end);
  return result;
end $$;
grant execute on function test.upload(uuid, uuid, text, text) to public;

-- -----------------------------------------------------------------------------
-- Configuración
-- -----------------------------------------------------------------------------
set role authenticated;
select test.act_as(test.u(3));
insert into public.expense_policies (company_id, max_days_past, allowed_currencies, default_currency, receipt_required)
values (test.co('A'), 60, '{EUR,USD}', 'EUR', true);
insert into public.expense_categories (company_id, code, name, max_amount_cents, requires_project) values
  (test.co('A'), 'VIAJE', 'Viajes', 10000, true);
insert into public.expense_categories (company_id, code, name, is_mileage) values
  (test.co('A'), 'KM', 'Kilometraje', true);
insert into public.expense_categories (company_id, code, name, requires_client) values
  (test.co('A'), 'COMIDA', 'Comidas con clientes', true);
select test.ok((select count(*) from public.expense_categories where company_id = test.co('A')) = 4,
  'CA: configura la política y las categorías');

select test.act_as(test.u(2));
insert into public.expense_categories (company_id, code, name) values (test.co('A'), 'GA', 'Creada por el grupo');
select test.ok(true, 'GA: la administración del grupo configura categorías');
select test.act_as(test.u(4));
select test.fails($$insert into public.expense_categories (company_id, code, name) values (test.co('A'), 'HR', 'No')$$,
  'HR: RR. HH. no configura gastos', 'row-level security');
select test.act_as(test.u(9));
select test.fails($$insert into public.expense_categories (company_id, code, name) values (test.co('A'), 'ACC', 'No')$$,
  'ACC: Contabilidad no configura gastos', 'row-level security');
select test.act_as(test.u(7));
select test.fails($$insert into public.expense_categories (company_id, code, name) values (test.co('A'), 'E1', 'No')$$,
  'E1: la persona no configura gastos', 'row-level security');
select test.ok((select count(*) from public.expense_categories) = 5, 'E1: ve las categorías de su empresa');
select test.act_as(test.u(12));
select test.ok(not exists (select 1 from public.expense_categories where company_id = test.co('A')),
  'CB: no ve las categorías de otra empresa');
select test.fails($$insert into public.expense_categories (company_id, code, name) values (test.co('A'), 'CB', 'No')$$,
  'CB: no configura otra empresa', 'row-level security');

-- -----------------------------------------------------------------------------
-- Subida: rutas, Storage e idempotencia
-- -----------------------------------------------------------------------------
select test.act_as(test.u(7));
select test.fails($$insert into storage.objects (bucket_id, name, owner)
  values ('expense-receipts', test.p(test.co('A'), test.e(8), test.k(90)), test.u(7))$$,
  'Storage: nadie sube en la carpeta de otra persona', 'row-level security');
select test.fails($$insert into storage.objects (bucket_id, name, owner)
  values ('expense-receipts', test.p(test.co('B'), test.e(7), test.k(91)), test.u(7))$$,
  'Storage: nadie sube en otra empresa', 'row-level security');
select test.fails($$insert into storage.objects (bucket_id, name, owner)
  values ('expense-receipts', test.co('A') || '/' || test.e(7) || '/' || test.k(92) || '.jpg', test.u(7))$$,
  'Storage: la ruta exige año y mes', 'row-level security');
select test.fails($$select * from public.register_expense_receipt(test.co('A'), test.k(1), test.p(test.co('A'), test.e(7), test.k(1)),
  test.sha(1), 'image/jpeg', 20000, true, 1200, 1600)$$, 'Registro: el archivo tiene que estar subido', 'no se ha subido');

select test.upload(test.e(7), test.k(1), test.sha(1));
select test.ok(test.expense(test.k(1)) is not null and (test.job(test.k(1))).status = 'pending',
  'Registro: crea el gasto en borrador y encola el OCR');
select test.ok((select created from public.register_expense_receipt(test.co('A'), test.k(1),
  test.p(test.co('A'), test.e(7), test.k(1)), test.sha(1), 'image/jpeg', 20000, true, 1200, 1600)) = false
  and (select count(*) from public.expenses) = 1 and (select count(*) from public.jobs) = 1,
  'Reintento: la misma clave no duplica el gasto ni el trabajo');

-- Duplicado exacto propio con otra clave: devuelve el mismo gasto.
insert into storage.objects (bucket_id, name, owner) values ('expense-receipts', test.p(test.co('A'), test.e(7), test.k(2)), test.u(7));
select test.ok((select expense_id from public.register_expense_receipt(test.co('A'), test.k(2),
  test.p(test.co('A'), test.e(7), test.k(2)), test.sha(1), 'image/jpeg', 20000, true, 1200, 1600)) = test.expense(test.k(1))
  and (select count(*) from public.expenses) = 1, 'Duplicado exacto propio: devuelve el gasto existente');
select test.ok((select owner from public.find_receipt_duplicate(test.co('A'), test.sha(1))) = 'own',
  'Duplicado: la comprobación previa reconoce el ticket propio');

select test.fails($$select * from public.register_expense_receipt(test.co('A'), test.k(3), test.p(test.co('A'), test.e(7), test.k(3), 'png'),
  test.sha(3), 'image/jpeg', 20000, true, 1200, 1600)$$, 'Registro: la extensión y el tipo deben coincidir', 'no válido');
insert into storage.objects (bucket_id, name, owner) values ('expense-receipts', test.p(test.co('A'), test.e(7), test.k(4)), test.u(7));
select test.fails($$select * from public.register_expense_receipt(test.co('A'), test.k(4), test.p(test.co('A'), test.e(7), test.k(4)),
  test.sha(4), 'image/jpeg', 20000, true, 120, 90)$$, 'Registro: una imagen demasiado pequeña no es legible', 'no válido');
select test.fails($$select * from public.register_expense_receipt(test.co('A'), test.k(4), test.p(test.co('A'), test.e(7), test.k(4)),
  test.sha(4), 'image/jpeg', 20000000, true, 1200, 1600)$$, 'Registro: tamaño máximo', 'no válido');
select test.fails($$select * from public.register_expense_receipt(test.co('A'), test.k(5),
  test.co('A') || '/' || test.e(7) || '/2001/01/' || test.k(5) || '.jpg', test.sha(5), 'image/jpeg', 20000, true, 1200, 1600)$$,
  'Registro: la carpeta de un mes antiguo no se acepta', 'no válido');

-- El mismo archivo subido por otra persona de la empresa.
select test.act_as(test.u(8));
select test.ok((select owner from public.find_receipt_duplicate(test.co('A'), test.sha(1))) = 'other'
  and (select expense_id from public.find_receipt_duplicate(test.co('A'), test.sha(1))) is null,
  'Duplicado de otra persona: se avisa sin revelar su gasto');
insert into storage.objects (bucket_id, name, owner) values ('expense-receipts', test.p(test.co('A'), test.e(8), test.k(6)), test.u(8));
select test.fails($$select * from public.register_expense_receipt(test.co('A'), test.k(6), test.p(test.co('A'), test.e(8), test.k(6)),
  test.sha(1), 'image/jpeg', 20000, true, 1200, 1600)$$, 'Duplicado exacto de otra persona: se bloquea', 'ya está registrado');
select test.upload(test.e(8), test.k(7), test.sha(7), 'pdf');
select test.ok(test.expense(test.k(7)) is not null, 'E2: registra su propio ticket en PDF');

-- -----------------------------------------------------------------------------
-- Cola de OCR: reclamar, fallar, reintentar con espera, agotar intentos
-- -----------------------------------------------------------------------------
select test.fails($$select * from public.claim_ocr_job((test.job(test.k(1))).id, 'fake')$$,
  'Cola: nadie reclama el trabajo de otra persona', 'no encontrado');
select test.act_as(test.u(7));
select test.ok((select attempt from public.claim_ocr_job((test.job(test.k(1))).id, 'fake')) = 1, 'Cola: primer intento');
select test.ok(not exists (select 1 from public.claim_ocr_job((test.job(test.k(1))).id, 'fake')),
  'Cola: un trabajo en curso no se reclama dos veces');
select test.ok(public.finish_ocr_run((select id from public.ocr_runs where attempt = 1 and job_id = (test.job(test.k(1))).id),
  'failed', null, 'provider_unavailable') = 'failed', 'OCR caído: la ejecución queda fallida');
select test.ok((test.job(test.k(1))).status = 'pending' and (test.job(test.k(1))).run_after > now()
  and (test.job(test.k(1))).last_error_code = 'provider_unavailable', 'OCR caído: el trabajo vuelve a la cola con espera');
select test.ok(not exists (select 1 from public.claim_ocr_job((test.job(test.k(1))).id, 'fake')),
  'Reintento: no se reclama antes de que pase la espera');
select test.ok(public.finish_ocr_run((select id from public.ocr_runs where attempt = 1 and job_id = (test.job(test.k(1))).id),
  'succeeded', '{}', null) = 'failed' and (test.job(test.k(1))).attempts = 1,
  'OCR: cerrar otra vez una ejecución terminada no la cambia ni gasta intentos (idempotente)');

reset role;
update public.jobs set run_after = now() - interval '1 second' where id = (test.job(test.k(1))).id;
set role authenticated;
select test.ok((select attempt from public.claim_ocr_job((test.job(test.k(1))).id, 'fake')) = 2, 'Reintento: segundo intento');
select public.finish_ocr_run((select id from public.ocr_runs where attempt = 2 and job_id = (test.job(test.k(1))).id),
  'failed', null, 'timeout');
reset role;
update public.jobs set run_after = now() - interval '1 second' where id = (test.job(test.k(1))).id;
set role authenticated;
select public.finish_ocr_run((select run_id from public.claim_ocr_job((test.job(test.k(1))).id, 'fake')), 'failed', null, 'timeout');
select test.ok((test.job(test.k(1))).status = 'failed' and (test.job(test.k(1))).attempts = 3,
  'Reintentos limitados: tras 3 intentos el trabajo queda fallido');
reset role;
update public.jobs set run_after = now() - interval '1 second' where id = (test.job(test.k(1))).id;
set role authenticated;
select test.ok(not exists (select 1 from public.claim_ocr_job((test.job(test.k(1))).id, 'fake')),
  'Reintentos limitados: un trabajo fallido no se vuelve a ejecutar solo');

select public.requeue_receipt_ocr(test.expense(test.k(1)));
select test.ok((test.job(test.k(1))).status = 'pending' and (test.job(test.k(1))).requeues = 1,
  'Releer: la persona puede volver a pedir la lectura');
select test.fails($$select public.finish_ocr_run((select run_id from public.claim_ocr_job((test.job(test.k(1))).id, 'fake')),
  'succeeded', '{"raw_text": {"value": "TICKET COMPLETO", "confidence": 1}}', null)$$,
  'OCR: el texto completo del ticket no se acepta en el resultado', 'no válido');
reset role;
update public.ocr_runs set status = 'failed', error_code = 'test', finished_at = now()
where job_id = (test.job(test.k(1))).id and status = 'processing';
update public.jobs set status = 'pending', locked_at = null, run_after = now() - interval '1 second'
where id = (test.job(test.k(1))).id;
set role authenticated;
select test.ok(public.finish_ocr_run((select run_id from public.claim_ocr_job((test.job(test.k(1))).id, 'fake')), 'succeeded',
  jsonb_build_object(
    'expense_date', jsonb_build_object('value', test.today()::text, 'confidence', 0.55),
    'merchant_name', jsonb_build_object('value', 'Cafetería Sintética', 'confidence', 0.97),
    'total_cents', jsonb_build_object('value', '2420', 'confidence', 0.95),
    'base_cents', jsonb_build_object('value', '2000', 'confidence', 0.9),
    'tax_cents', jsonb_build_object('value', '420', 'confidence', 0.9),
    'currency', jsonb_build_object('value', 'EUR', 'confidence', 0.99)),
  null) = 'needs_review', 'OCR: con un campo de baja confianza queda pendiente de revisión');
select test.ok((test.job(test.k(1))).status = 'succeeded'
  and (select count(*) from public.ocr_runs where job_id = (test.job(test.k(1))).id) = 4,
  'OCR: el trabajo termina y cada intento queda registrado');
select test.ok((select merchant_name from public.expenses where id = test.expense(test.k(1))) is null,
  'OCR: la propuesta no se copia sola al gasto');

-- -----------------------------------------------------------------------------
-- Revisión y confirmación
-- -----------------------------------------------------------------------------
update public.expenses set category_id = test.cat('VIAJE'), expense_date = test.today(),
  merchant_name = 'Cafetería Sintética', currency = 'EUR', base_cents = 2000, tax_cents = 420, total_cents = 2420,
  payment_method = 'personal_card'
where id = test.expense(test.k(1));
select test.fails($$select public.confirm_expense(test.expense(test.k(1)), '{}', false)$$,
  'Confirmación: la categoría exige proyecto', 'proyecto');
update public.expenses set project_code = 'P-001' where id = test.expense(test.k(1));
select test.fails($$select public.confirm_expense(test.expense(test.k(1)), '{}', false)$$,
  'Baja confianza: no se confirma sin revisar la fecha', 'fecha');
update public.expenses set expense_date = test.today() + 1 where id = test.expense(test.k(1));
select test.fails($$select public.confirm_expense(test.expense(test.k(1)), '{expense_date}', false)$$,
  'Reglas: fecha futura', 'futura');
update public.expenses set expense_date = test.today() - 61 where id = test.expense(test.k(1));
select test.fails($$select public.confirm_expense(test.expense(test.k(1)), '{expense_date}', false)$$,
  'Reglas: más antiguo de lo que admite la política', 'más de 60 días');
update public.expenses set expense_date = test.today(), tax_cents = 400 where id = test.expense(test.k(1));
select test.fails($$select public.confirm_expense(test.expense(test.k(1)), '{expense_date}', false)$$,
  'Reglas: base más impuestos debe dar el total', 'no coincide');
update public.expenses set tax_cents = 420, currency = 'GBP' where id = test.expense(test.k(1));
select test.fails($$select public.confirm_expense(test.expense(test.k(1)), '{expense_date}', false)$$,
  'Reglas: moneda no admitida', 'Moneda');
update public.expenses set currency = 'EUR', base_cents = 10000, tax_cents = 2100, total_cents = 12100
where id = test.expense(test.k(1));
select test.fails($$select public.confirm_expense(test.expense(test.k(1)), '{expense_date}', false)$$,
  'Desviación: superar el límite exige justificarlo', 'límite de la categoría');
update public.expenses set notes = 'Cena con el cliente tras la feria' where id = test.expense(test.k(1));
select test.ok(public.confirm_expense(test.expense(test.k(1)), '{expense_date}', false)
  = '{over_category_limit,total_differs_from_ocr}', 'Confirmación: queda lista con las desviaciones registradas');
select test.ok((select status = 'ready' and confirmed_by = test.u(7) from public.expenses where id = test.expense(test.k(1))),
  'Confirmación: el gasto queda listo con su autor');
select test.ok(test.affected($$update public.expenses set total_cents = 1 where id = test.expense(test.k(1))$$) = 0,
  'Listo: ya no se edita sin reabrirlo');
select public.reopen_expense(test.expense(test.k(1)));
update public.expenses set base_cents = 2000, tax_cents = 420, total_cents = 2420 where id = test.expense(test.k(1));
select test.ok(public.confirm_expense(test.expense(test.k(1)), '{expense_date}', false) = '{}',
  'Corrección: se reabre, se corrige y se vuelve a confirmar');
select test.ok((select count(*) from public.expense_receipts where expense_id = test.expense(test.k(1))) = 1,
  'Corrección: el ticket original se conserva');

-- Similitud: mismo proveedor, fecha, total y moneda con otro ticket.
select test.upload(test.e(7), test.k(10), test.sha(10));
update public.expenses set category_id = test.cat('VIAJE'), expense_date = test.today(),
  merchant_name = 'Cafetería  sintética', currency = 'EUR', total_cents = 2420, payment_method = 'cash', project_code = 'P-001'
where id = test.expense(test.k(10));
select test.fails($$select public.confirm_expense(test.expense(test.k(10)), '{}', false)$$,
  'Similitud: un posible duplicado pide confirmación expresa', 'duplicado');
select test.ok(public.confirm_expense(test.expense(test.k(10)), '{}', true) = '{possible_duplicate_acknowledged}',
  'Similitud: no bloquea si la persona confirma que no es un duplicado');

-- Sin ticket: la política lo exige.
select public.create_expense(test.co('A'), test.k(20), 'manual');
select test.ok(public.create_expense(test.co('A'), test.k(20), 'manual') = test.expense(test.k(20)),
  'Manual: la misma clave devuelve el mismo gasto');
update public.expenses set category_id = test.cat('COMIDA'), expense_date = test.today(),
  currency = 'EUR', total_cents = 1500, payment_method = 'cash', client_name = 'Cliente sintético'
where id = test.expense(test.k(20));
select test.fails($$select public.confirm_expense(test.expense(test.k(20)), '{}', false)$$,
  'Política: exige ticket', 'exige adjuntar el ticket');
select public.set_expense_discarded(test.expense(test.k(20)), true);
select test.ok((select status = 'discarded' from public.expenses where id = test.expense(test.k(20))), 'Descartar un borrador');
select public.set_expense_discarded(test.expense(test.k(20)), false);
select test.ok((select status = 'draft' from public.expenses where id = test.expense(test.k(20))), 'Recuperar un descartado');

-- Kilometraje.
select public.create_expense(test.co('A'), test.k(30), 'mileage');
update public.expenses set category_id = test.cat('KM'), expense_date = test.today(),
  currency = 'EUR', distance_km_tenths = 125
where id = test.expense(test.k(30));
select test.fails($$select public.confirm_expense(test.expense(test.k(30)), '{}', false)$$,
  'Kilometraje: sin precio por km configurado no se confirma', 'precio por kilómetro');
select test.act_as(test.u(3));
update public.expense_policies set mileage_rate_milli = 260 where company_id = test.co('A');
select test.act_as(test.u(7));
select public.confirm_expense(test.expense(test.k(30)), '{}', false);
select test.ok((select total_cents = 325 and mileage_rate_milli = 260 from public.expenses where id = test.expense(test.k(30))),
  'Kilometraje: 12,5 km a 0,26 €/km = 3,25 €, con la tarifa aplicada guardada');

-- -----------------------------------------------------------------------------
-- Aislamiento y privacidad
-- -----------------------------------------------------------------------------
select test.fails($$delete from public.expenses where id = test.expense(test.k(20))$$, 'Gastos: nadie los borra', 'permission denied');
select test.fails($$update public.expenses set status = 'ready' where id = test.expense(test.k(20))$$,
  'Gastos: el estado no se cambia directamente', 'permission denied');
select test.fails($$update public.expenses set employee_id = test.e(8) where id = test.expense(test.k(20))$$,
  'Gastos: no se cambia de dueño', 'permission denied');
select test.ok(exists (select 1 from storage.objects where bucket_id = 'expense-receipts'
  and name = test.p(test.co('A'), test.e(7), test.k(1))), 'E1: abre su ticket');

select test.act_as(test.u(8));
select test.ok(not exists (select 1 from public.expenses where employee_id = test.e(7))
  and not exists (select 1 from public.expense_receipts where employee_id = test.e(7))
  and not exists (select 1 from public.ocr_runs where employee_id = test.e(7)), 'E2: no ve gastos ni OCR de otra persona');
select test.ok(not exists (select 1 from storage.objects where bucket_id = 'expense-receipts'
  and name like test.co('A') || '/' || test.e(7) || '/%'), 'E2: no abre tickets de otra persona');
select test.ok(test.affected($$update public.expenses set notes = 'x' where id = test.expense(test.k(20))$$) = 0,
  'E2: no edita gastos de otra persona');

select test.act_as(test.u(6));
select test.ok(exists (select 1 from public.expenses where employee_id = test.e(7))
  and not exists (select 1 from public.expenses where employee_id = test.e(8)), 'MGR: ve solo los gastos de quien supervisa');
select test.ok(exists (select 1 from storage.objects where bucket_id = 'expense-receipts'
  and name = test.p(test.co('A'), test.e(7), test.k(1)))
  and not exists (select 1 from storage.objects where bucket_id = 'expense-receipts'
  and name like test.co('A') || '/' || test.e(8) || '/%'), 'MGR: abre los tickets de su equipo y no los de otros');
select test.ok(test.affected($$update public.expenses set notes = 'x' where id = test.expense(test.k(20))$$) = 0,
  'MGR: no modifica gastos de su equipo');

select test.act_as(test.u(9));
select test.ok((select count(distinct employee_id) from public.expenses) = 2
  and (select count(*) from storage.objects where bucket_id = 'expense-receipts' and name like test.co('A') || '/%') >= 3,
  'ACC: Contabilidad ve gastos y tickets de su empresa');

select test.act_as(test.u(4));
select test.ok(not exists (select 1 from public.expenses) and not exists (select 1 from storage.objects
  where bucket_id = 'expense-receipts'), 'HR: RR. HH. no ve gastos ni tickets');
select test.act_as(test.u(2));
select test.ok(not exists (select 1 from public.expenses) and not exists (select 1 from storage.objects
  where bucket_id = 'expense-receipts'), 'GA: la administración del grupo no ve tickets');
select test.act_as(test.u(12));
select test.ok(not exists (select 1 from public.expenses) and not exists (select 1 from public.jobs)
  and not exists (select 1 from storage.objects where bucket_id = 'expense-receipts'), 'CB: nada de otra empresa');
select test.fails($$select * from public.find_receipt_duplicate(test.co('A'), test.sha(1))$$,
  'CB: no consulta duplicados de otra empresa', 'ficha de empleado');

select test.act_as(test.u(14));
select test.ok(not exists (select 1 from public.expenses) and not exists (select 1 from public.expense_categories)
  and not exists (select 1 from storage.objects where bucket_id = 'expense-receipts'), 'EXP: membresía caducada, nada');
select test.fails($$insert into storage.objects (bucket_id, name, owner)
  values ('expense-receipts', test.p(test.co('A'), test.e(14), test.k(40)), test.u(14))$$,
  'EXP: con la membresía caducada no sube tickets', 'row-level security');
select test.fails($$select public.create_expense(test.co('A'), test.k(41), 'manual')$$,
  'EXP: con la membresía caducada no crea gastos', 'ficha de empleado');

-- -----------------------------------------------------------------------------
-- Inmutabilidad y auditoría
-- -----------------------------------------------------------------------------
reset role;
select test.fails($$update public.expense_receipts set sha256 = repeat('0', 64)$$,
  'Ticket: ni siquiera el servicio lo modifica', 'inmutable');
select test.fails($$delete from public.expense_events$$, 'Historial: no se borra', 'inmutable');
select test.ok(exists (select 1 from public.audit_log where table_name = 'expenses' and action = 'UPDATE'),
  'Auditoría: los cambios del gasto quedan en audit_log');
select test.ok(not exists (select 1 from public.audit_log where table_name in ('ocr_runs', 'jobs'))
  and not exists (select 1 from public.expense_events where detail ~ '[A-Z0-9]'),
  'Privacidad: el OCR no va a audit_log y el historial no lleva datos del ticket');
select test.ok((select count(*) from public.expense_events where action = 'ocr_finished') >= 4,
  'Historial: cada intento de OCR queda registrado');

\echo 'Pruebas de gastos superadas.'
