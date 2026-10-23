-- =============================================================================
-- Seguridad y privacidad: MFA por rol (y su degradación documentada), acceso de
-- soporte temporal y auditado, evidencias de fichaje restringidas, límites de
-- frecuencia, retención simulada, reversible y con retenciones legales, y
-- derechos de las personas con revisión humana y bloqueos legales.
-- Escenario: helpers/fixtures.sql (PA = u01, GA = u02, CA = u03, HR = u04,
-- HRW = u05 (centro A2), MGR = u06, E1 = u07/e07, E2 = u08/e08, ACC = u09,
-- AUD = u10, CB = u12, X = u13, EXP = u14 (membresía caducada)).
-- =============================================================================

\ir helpers/asserts.sql
\ir helpers/fixtures.sql

create or replace function test.k(n int) returns uuid language sql immutable as
  $$ select ('ab000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function test.count_employees() returns bigint language sql stable as
  $$ select count(*) from public.employees $$;
grant execute on function test.k(int), test.count_employees() to public;

-- -----------------------------------------------------------------------------
-- MFA por rol
-- -----------------------------------------------------------------------------
set role authenticated;
select test.act_as(test.u(4), 'aal1');
select test.ok((select required and not satisfied from public.my_mfa_status()),
  'MFA: RR. HH. sin segundo factor queda pendiente');
select test.ok(test.count_employees() = 1, 'MFA: sin segundo factor, RR. HH. solo ve su propia ficha');
select test.ok((select count(*) from public.my_company_permissions(test.co('A'))) = 0,
  'MFA: sin segundo factor no tiene permisos de gestión');
select test.ok((select count(*) from public.report_time_daily(test.co('A'), current_date - 30, current_date)) = 0,
  'MFA: sin segundo factor los informes no muestran datos de otras personas');
select test.act_as(test.u(4));
select test.ok((select required and satisfied from public.my_mfa_status()) and test.count_employees() > 1,
  'MFA: con segundo factor recupera su ámbito');

select test.act_as(test.u(3), 'aal1');
select test.fails($$insert into public.work_centers (company_id, name, code) values (test.co('A'), 'Sin MFA', 'SM')$$,
  'MFA: la administración sin segundo factor no modifica la organización', 'row-level security');
select test.act_as(test.u(9), 'aal1');
select test.ok((select count(*) from public.report_expenses(test.co('A'), current_date - 30, current_date, 'month')) = 0
  and not private.has_expense_permission(test.co('A'), 'close'), 'MFA: contabilidad sin segundo factor no ve ni cierra');
select test.act_as(test.u(10), 'aal1');
select test.ok((select count(*) from public.report_audit(test.co('A'), current_date - 1, current_date)) = 0,
  'MFA: auditoría sin segundo factor no ve eventos');
select test.act_as(test.u(2), 'aal1');
select test.ok(not private.is_group_admin(test.grp(1)), 'MFA: la administración de grupo exige segundo factor');
select test.act_as(test.u(1), 'aal1');
select test.ok(not private.is_global_admin(), 'MFA: la administración de plataforma exige segundo factor');

select test.act_as(test.u(7), 'aal1');
select test.ok((select not required from public.my_mfa_status()) and test.count_employees() = 1,
  'MFA: una persona empleada no lo necesita para lo suyo');
select test.act_as(test.u(6), 'aal1');
select test.ok(private.manages_employee(test.e(7)), 'MFA: la supervisión directa (manager) no depende del rol');

-- Degradación documentada: solo el propietario de la base de datos la activa.
reset role;
update private.security_settings set mfa_enforced = false where id = 1;
set role authenticated;
select test.act_as(test.u(4), 'aal1');
select test.ok(test.count_employees() > 1, 'MFA: degradación de plataforma (sin MFA disponible) restablece el acceso');
select test.fails($$update private.security_settings set mfa_enforced = true$$,
  'MFA: nadie lo cambia desde la API', 'permission denied');
reset role;
update private.security_settings set mfa_enforced = true where id = 1;

-- -----------------------------------------------------------------------------
-- Acceso de soporte temporal
-- -----------------------------------------------------------------------------
set role authenticated;
select test.act_as(test.u(1));
select test.ok(test.count_employees() = 0, 'Soporte: sin acceso concedido, la plataforma no ve personas');
select test.ok((select count(*) from public.profiles) = 2,
  'Soporte: la plataforma solo ve perfiles de administración (plataforma y grupos), no toda la base');

select test.act_as(test.u(7));
select test.ok(not exists (select 1 from public.support_staff()), 'Soporte: una persona empleada no ve quién es soporte');
select test.act_as(test.u(3));
select test.ok((select array_agg(user_id) from public.support_staff()) = array[test.u(1)],
  'Soporte: la administración ve a quién puede conceder acceso (solo nombre)');
select test.act_as(test.u(4));
select test.fails($$select public.grant_support_access(test.co('A'), test.u(1), 'Incidencia con importación de personas', 4)$$,
  'Soporte: RR. HH. no concede accesos (solo la administración)', 'Solo la administración');
select test.act_as(test.u(3), 'aal1');
select test.fails($$select public.grant_support_access(test.co('A'), test.u(1), 'Incidencia con importación de personas', 4)$$,
  'Soporte: conceder exige segundo factor', 'Solo la administración');
select test.act_as(test.u(3));
select test.fails($$select public.grant_support_access(test.co('A'), test.u(6), 'Incidencia con importación de personas', 4)$$,
  'Soporte: solo a personas de la plataforma', 'plataforma');
select test.fails($$select public.grant_support_access(test.co('A'), test.u(1), 'Incidencia con importación', 48)$$,
  'Soporte: como mucho 24 horas', '1 a 24');
select test.fails($$select public.grant_support_access(test.co('A'), test.u(1), 'corto', 4)$$,
  'Soporte: exige un motivo', 'check');
select set_config('test.grant', public.grant_support_access(test.co('A'), test.u(1),
  'Incidencia 123: revisar importación de personas', 4)::text, false);

select test.act_as(test.u(1));
select test.ok(test.count_employees() > 0 and not exists (select 1 from public.employees where company_id <> test.co('A')),
  'Soporte: con acceso vigente ve personas de esa empresa y de ninguna otra');
select test.ok((select count(*) from public.audit_events where company_id = test.co('A')) > 0,
  'Soporte: puede consultar la auditoría de la empresa');
select test.ok(test.affected($$update public.employees set first_name = 'Cambiado' where company_id = test.co('A')$$) = 0,
  'Soporte: solo lectura (no modifica personas)');
select test.ok((select count(*) from public.time_entries) = 0 and (select count(*) from public.expenses) = 0,
  'Soporte: no ve jornadas ni gastos');
select test.act_as(test.u(1), 'aal1');
select test.ok(test.count_employees() = 0, 'Soporte: sin segundo factor no usa el acceso');

select test.act_as(test.u(12));
select test.ok(not exists (select 1 from public.support_access_grants), 'Soporte: otra empresa no ve los accesos de A');
select test.act_as(test.u(10));
select test.ok((select count(*) from public.support_access_grants) = 1, 'Soporte: auditoría ve los accesos concedidos');
select test.ok((select after ->> 'reason' = '[dato personal]' from public.audit_events
  where entity = 'support_access_grants' and action = 'create'), 'Soporte: la concesión queda auditada, sin el motivo literal');

select test.act_as(test.u(1));
select public.revoke_support_access(current_setting('test.grant')::uuid);
select test.ok(test.count_employees() = 0, 'Soporte: revocado, deja de ver');
select public.revoke_support_access(current_setting('test.grant')::uuid);
select test.act_as(test.u(10));
select test.ok((select count(*) from public.audit_events where entity = 'support_access_grants') = 2,
  'Soporte: la revocación queda auditada (y revocar dos veces no hace nada)');
select test.act_as(test.u(1));
select test.fails($$update public.support_access_grants set expires_at = now() + interval '1 day'$$,
  'Soporte: un acceso no se amplía', 'permission denied');
reset role;
insert into public.support_access_grants (company_id, support_user_id, granted_by, reason, starts_at, expires_at)
values (test.co('A'), test.u(1), test.u(3), 'Acceso antiguo ya caducado', now() - interval '2 days', now() - interval '1 day');
set role authenticated;
select test.act_as(test.u(1));
select test.ok(test.count_employees() = 0, 'Soporte: un acceso caducado no da acceso');
reset role;

-- -----------------------------------------------------------------------------
-- Evidencias de fichaje
-- -----------------------------------------------------------------------------
insert into public.time_entries (id, company_id, employee_id, work_date, time_zone, status, started_at)
values (test.k(1), test.co('A'), test.e(7), current_date - 1, 'Europe/Madrid', 'open', now() - interval '1 day');
insert into public.punches (id, company_id, employee_id, time_entry_id, kind, server_at, time_zone, source,
  idempotency_key, location_status, latitude, longitude, accuracy_m, selfie_path)
values (test.k(2), test.co('A'), test.e(7), test.k(1), 'start', now() - interval '1 day', 'Europe/Madrid', 'mobile',
  test.k(3), 'granted', 40.4168, -3.7038, 12, test.co('A') || '/' || test.e(7) || '/' || test.k(3) || '.jpg');
insert into storage.objects (bucket_id, name) values ('punch-selfies', test.co('A') || '/' || test.e(7) || '/' || test.k(3) || '.jpg');

set role authenticated;
select test.act_as(test.u(10));
select test.ok(exists (select id from public.punches where id = test.k(2)), 'Evidencias: auditoría ve el fichaje');
select test.fails($$select latitude from public.punches$$, 'Evidencias: nadie lee coordenadas por la API general', 'permission denied');
select test.fails($$select * from public.punch_evidence(test.k(2))$$, 'Evidencias: auditoría no ve ubicación ni selfie', 'no encontrado');
select test.ok(not exists (select 1 from storage.objects where bucket_id = 'punch-selfies'), 'Evidencias: auditoría no abre la selfie');
select test.act_as(test.u(8));
select test.fails($$select * from public.punch_evidence(test.k(2))$$, 'Evidencias: otra persona no las ve', 'no encontrado');
select test.act_as(test.u(12));
select test.fails($$select * from public.punch_evidence(test.k(2))$$, 'Evidencias: otra empresa no las ve', 'no encontrado');
select test.act_as(test.u(6));
select test.ok((select latitude = 40.4168 and selfie_path is not null from public.punch_evidence(test.k(2))),
  'Evidencias: el manager las ve');
select test.ok((select count(*) from storage.objects where bucket_id = 'punch-selfies') = 1, 'Evidencias: el manager abre la selfie');
select test.act_as(test.u(7));
select test.ok((select latitude = 40.4168 from public.punch_evidence(test.k(2))), 'Evidencias: la persona ve las suyas');
select test.act_as(test.u(4));
select test.ok((select accuracy_m = 12 from public.punch_evidence(test.k(2))), 'Evidencias: RR. HH. con gestión las ve');
select test.act_as(test.u(10));
select test.ok((select count(*) from public.audit_events where entity = 'punches' and action = 'sensitive_read'
  and entity_id = test.k(2)::text) = 3, 'Evidencias: cada consulta queda auditada (quién y cuándo)');

-- -----------------------------------------------------------------------------
-- Límites de frecuencia
-- -----------------------------------------------------------------------------
select test.act_as(test.u(7));
select public.check_rate_limit('mfa') from generate_series(1, 10);
select test.fails($$select public.check_rate_limit('mfa')$$, 'Frecuencia: se corta al superar el límite', 'Demasiadas solicitudes');
select test.act_as(test.u(8));
select test.ok((select count(*) from (select public.check_rate_limit('mfa')) x) = 1, 'Frecuencia: el límite es por persona');
select test.fails($$select public.check_rate_limit('borrar_todo')$$, 'Frecuencia: acción desconocida', 'no válida');
select test.fails($$select * from private.rate_limit_hits$$, 'Frecuencia: los contadores no son visibles', 'permission denied');
reset role;

-- -----------------------------------------------------------------------------
-- Retención: simulación, ejecución reversible y retenciones legales
-- -----------------------------------------------------------------------------
-- Datos antiguos sintéticos (se omiten los guardas solo para fechar en el pasado).
set session_replication_role = replica;
insert into public.notification_outbox (id, company_id, event_type, entity_type, source_key, payload, occurred_at, status)
overriding system value
values (900001, test.co('A'), 'absence_decided', 'absence_request', 'prueba:retencion:1', '{}', now() - interval '13 months', 'processed'),
       (900002, test.co('B'), 'absence_decided', 'absence_request', 'prueba:retencion:2', '{}', now() - interval '13 months', 'processed');
insert into public.notifications (id, company_id, recipient_user_id, outbox_id, event_type, template_version, params,
  link_path, entity_type, mandatory, idempotency_key, read_at, created_at)
values (test.k(10), test.co('A'), test.u(7), 900001, 'absence_decided', 1, '{}', '/ausencias', 'absence_request', false,
        'prueba:10', now() - interval '13 months', now() - interval '13 months'),
       (test.k(11), test.co('A'), test.u(7), 900001, 'absence_decided', 1, '{}', '/ausencias', 'absence_request', false,
        'prueba:11', null, now() - interval '13 months'),
       (test.k(12), test.co('B'), test.u(11), 900002, 'absence_decided', 1, '{}', '/ausencias', 'absence_request', false,
        'prueba:12', now() - interval '13 months', now() - interval '13 months'),
       (test.k(13), test.co('A'), test.u(7), 900001, 'absence_decided', 1, '{}', '/ausencias', 'absence_request', false,
        'prueba:13', now() - interval '1 month', now() - interval '2 months');
insert into public.email_deliveries (id, company_id, notification_id, recipient_user_id, event_type, template_version,
  idempotency_key, status, created_at)
values (test.k(14), test.co('A'), test.k(10), test.u(7), 'absence_decided', 1, 'prueba:14', 'delivered', now() - interval '13 months');
insert into public.email_delivery_events (company_id, delivery_id, provider, external_event_id, event_type, occurred_at)
values (test.co('A'), test.k(14), 'fake', 'ev-1', 'delivered', now() - interval '13 months');
insert into public.kiosk_devices (id, company_id, work_center_id, name, token_hash)
values (test.k(20), test.co('A'), test.wc('A1'), 'Terminal de pruebas', repeat('a', 64));
insert into public.kiosk_attempts (company_id, device_id, employee_id, success, created_at)
values (test.co('A'), test.k(20), test.e(7), false, now() - interval '100 days'),
       (test.co('A'), test.k(20), test.e(7), true, now() - interval '10 days');
insert into public.expenses (id, company_id, employee_id, source, status, idempotency_key, updated_at)
values (test.k(30), test.co('A'), test.e(7), 'receipt', 'discarded', test.k(30), now() - interval '100 days');
insert into public.expense_receipts (id, company_id, employee_id, expense_id, storage_path, mime_type, size_bytes, sha256)
values (test.k(31), test.co('A'), test.e(7), test.k(30), test.co('A') || '/' || test.e(7) || '/x.jpg', 'image/jpeg', 1000, repeat('c', 64));
insert into public.jobs (id, company_id, employee_id, kind, dedupe_key, status)
values (test.k(32), test.co('A'), test.e(7), 'ocr_receipt', 'prueba', 'succeeded');
insert into public.ocr_runs (company_id, employee_id, receipt_id, job_id, attempt, provider, status, result, finished_at)
values (test.co('A'), test.e(7), test.k(31), test.k(32), 1, 'fake', 'succeeded',
  '{"merchant_name": {"value": "Proveedor Sintético", "confidence": 0.9}, "total_cents": {"value": "1234", "confidence": 0.95}}',
  now() - interval '100 days');
set session_replication_role = origin;

set role service_role;
select test.ok((select affected from public.run_retention('simulate') where category = 'notifications') = 2
  and (select affected from public.run_retention('simulate') where category = 'ocr_raw') = 1
  and (select affected from public.run_retention('simulate') where category = 'kiosk_attempts') = 1,
  'Retención (simulación): avisos leídos de más de 12 meses, OCR de más de 90 días e intentos de más de 90 días');
reset role;
select test.ok((select count(*) from public.notifications) = 4 and (select count(*) from public.kiosk_attempts) = 2
  and (select result -> 'merchant_name' ? 'value' from public.ocr_runs where receipt_id = test.k(31)),
  'Retención (simulación): no cambia nada');

-- Ejecución dentro de una transacción que se deshace: comprobable y reversible.
begin;
set local role service_role;
select public.run_retention('execute');
reset role;
select test.ok((select count(*) from public.notifications) = 2 and not exists (select 1 from public.email_deliveries)
  and (select count(*) from public.kiosk_attempts) = 1
  and (select result = '{"merchant_name": {"confidence": 0.9}, "total_cents": {"confidence": 0.95}}'
       from public.ocr_runs where receipt_id = test.k(31)),
  'Retención (ejecución): borra avisos leídos antiguos con sus entregas, intentos antiguos y deja del OCR solo las confianzas');
select test.ok(exists (select 1 from public.notifications where id = test.k(11))
  and exists (select 1 from public.notifications where id = test.k(13)),
  'Retención (ejecución): conserva los avisos no leídos y los recientes');
rollback;
select test.ok((select count(*) from public.notifications) = 4 and (select count(*) from public.email_deliveries) = 1,
  'Retención: deshecha la transacción, todo vuelve (simulación reversible)');

-- Retención legal: bloquea la retención automática.
set role authenticated;
select test.act_as(test.u(7));
select test.fails($$select public.place_legal_hold(test.co('A'), 'notifications', 'Requerimiento de la Inspección 2026/1')$$,
  'Retención legal: una persona empleada no la crea', 'No tienes permiso');
select test.act_as(test.u(5));
select test.fails($$select public.place_legal_hold(test.co('A'), 'notifications', 'Requerimiento de la Inspección 2026/1')$$,
  'Retención legal: RR. HH. de centro no la crea (ámbito de empresa)', 'No tienes permiso');
select test.act_as(test.u(14));
select test.fails($$select public.place_legal_hold(test.co('A'), 'notifications', 'Requerimiento de la Inspección 2026/1')$$,
  'Retención legal: con membresía caducada, no', 'No tienes permiso');
select test.act_as(test.u(4));
select set_config('test.hold', public.place_legal_hold(test.co('A'), 'notifications',
  'Requerimiento de la Inspección 2026/1')::text, false);
select test.act_as(test.u(12));
select test.ok(not exists (select 1 from public.legal_holds), 'Retención legal: otra empresa no la ve');
reset role;
set role service_role;
select test.ok((select affected = 1 and held = 1 from public.run_retention('execute') where category = 'notifications'),
  'Retención legal: los avisos de A quedan retenidos; los de B se borran');
reset role;
select test.ok(exists (select 1 from public.notifications where id = test.k(10))
  and not exists (select 1 from public.notifications where id = test.k(12)), 'Retención legal: respetada en la ejecución');
set role authenticated;
select test.act_as(test.u(4));
select public.release_legal_hold(current_setting('test.hold')::uuid);
select public.release_legal_hold(current_setting('test.hold')::uuid);
select test.fails($$update public.legal_holds set reason = 'Otro motivo cualquiera'$$,
  'Retención legal: no se modifica', 'permission denied');
reset role;
select test.fails($$update public.legal_holds set reason = 'Otro motivo cualquiera'$$,
  'Retención legal: ni siquiera desde el servidor, una vez levantada', 'solo se levanta');
select test.fails($$delete from public.notifications$$, 'Retención: fuera de una ejecución, los avisos no se borran', 'inmutable');
set app.retention_run = 'on';
select test.fails($$delete from public.audit_events$$, 'Retención: la auditoría nunca se borra', 'inmutable');
reset app.retention_run;

set role authenticated;
select test.act_as(test.u(7));
select test.fails($$select public.run_retention('execute')$$, 'Retención: solo la tarea programada la ejecuta', 'permission denied');
select test.act_as(test.u(3));
select test.ok(not exists (select 1 from public.recent_retention_runs()), 'Retención: la administración de empresa no ve recuentos globales');
select test.act_as(test.u(1));
select test.ok((select count(*) from public.recent_retention_runs()) >= 4, 'Retención: la plataforma ve las ejecuciones (simulación y ejecución)');
select test.ok((select count(*) from public.retention_catalog() where automatic) = 7
  and exists (select 1 from public.retention_catalog() where category = 'time_records' and not automatic),
  'Retención: el registro de jornada nunca se borra automáticamente');
reset role;

-- -----------------------------------------------------------------------------
-- Derechos de las personas
-- -----------------------------------------------------------------------------
set role authenticated;
select test.act_as(test.u(13));
select test.fails($$select public.submit_data_request(test.co('A'), 'access', null, test.k(40))$$,
  'Derechos: sin ficha en la empresa no se presenta', 'tus propios datos');
select test.act_as(test.u(7));
select set_config('test.req', public.submit_data_request(test.co('A'), 'access', 'Quiero una copia de mis datos',
  test.k(41))::text, false);
select test.ok(public.submit_data_request(test.co('A'), 'access', null, test.k(41)) = current_setting('test.req')::uuid,
  'Derechos: presentar es idempotente');
select set_config('test.erase', public.submit_data_request(test.co('A'), 'erasure', 'Borrad mis fichajes', test.k(42))::text, false);
select test.fails($$select public.review_data_request(current_setting('test.req')::uuid, 'approved', 'Aprobado por mí')$$,
  'Derechos: nadie resuelve sus propias solicitudes', 'no encontrada');

select test.act_as(test.u(8));
select test.ok(not exists (select 1 from public.data_subject_requests), 'Derechos: otra persona no ve las solicitudes');
select test.act_as(test.u(6));
select test.ok(not exists (select 1 from public.data_subject_requests), 'Derechos: el manager no las ve');
select test.act_as(test.u(5));
select test.ok(not exists (select 1 from public.data_subject_requests), 'Derechos: RR. HH. de centro no las ve');
select test.act_as(test.u(12));
select test.ok(not exists (select 1 from public.data_subject_requests), 'Derechos: otra empresa no las ve');
select test.act_as(test.u(4), 'aal1');
select test.ok(not exists (select 1 from public.data_subject_requests), 'Derechos: RR. HH. sin segundo factor no las ve');

select test.act_as(test.u(4));
select test.ok((select count(*) from public.data_subject_requests) = 3, 'Derechos: RR. HH. de empresa ve todas');
select test.fails($$select public.subject_access_package(current_setting('test.req')::uuid)$$,
  'Derechos: la copia exige una decisión previa', 'aprobada');
select public.review_data_request(current_setting('test.req')::uuid, 'in_review', null);
select test.fails($$select public.review_data_request(current_setting('test.req')::uuid, 'approved', '')$$,
  'Derechos: la decisión se motiva', 'Explica');
select public.review_data_request(current_setting('test.req')::uuid, 'approved', 'Identidad verificada; se entrega copia');
select test.ok((select (p -> 'employee' ->> 'code') = 'A-007' and p::text not like '%A-008%' and p::text not like '%B-011%'
  and jsonb_array_length(p -> 'time_entries') = 1 and p::text not like '%.jpg%'
  from public.subject_access_package(current_setting('test.req')::uuid) p),
  'Derechos: la copia contiene los datos de la persona, sin datos de terceros ni archivos');
select test.act_as(test.u(10));
select test.ok(exists (select 1 from public.audit_events where entity = 'data_subject_requests' and action = 'export'),
  'Derechos: la entrega de la copia queda auditada');
select test.act_as(test.u(4));

select test.fails($$select public.review_data_request(current_setting('test.erase')::uuid, 'approved', 'Suprimir todo')$$,
  'Derechos: no se aprueba una supresión con obligaciones de conservación', 'aprobación parcial');
select public.review_data_request(current_setting('test.erase')::uuid, 'partially_approved',
  'Se conservan fichajes (4 años) mientras dure la obligación');
select test.ok((select blockers @> '[{"category": "time_records"}]' and blockers @> '[{"category": "employment"}]'
  from public.data_subject_requests where id = current_setting('test.erase')::uuid),
  'Derechos: quedan registradas las obligaciones que impiden suprimir');
select test.ok((select count(*) from public.time_entries where employee_id = test.e(7)) = 1,
  'Derechos: aprobar no borra nada automáticamente');
select public.complete_data_request(current_setting('test.erase')::uuid, null);
select test.fails($$select public.review_data_request(current_setting('test.erase')::uuid, 'rejected', 'Cambio de opinión')$$,
  'Derechos: una solicitud completada no se reabre', 'ya está resuelta');

select test.act_as(test.u(7));
select test.ok((select status = 'completed' from public.data_subject_requests where id = current_setting('test.erase')::uuid),
  'Derechos: la persona ve el estado de su solicitud');
select test.fails($$select public.subject_access_package(current_setting('test.req')::uuid)$$,
  'Derechos: la persona no genera la copia por su cuenta (revisión humana)', 'no encontrada');
select test.act_as(test.u(10));
select test.ok((select bool_and(after ? 'status' and not after ? 'details') from public.audit_events
  where entity = 'data_subject_requests' and action in ('create', 'status_change')),
  'Derechos: la auditoría guarda el estado, no lo que escribió la persona');
select public.check_rate_limit('upload');
select test.act_as(test.u(7));
select public.submit_data_request(test.co('A'), 'objection', null, test.k(43 + n)) from generate_series(0, 2) n;
select test.fails($$select public.submit_data_request(test.co('A'), 'objection', null, test.k(50))$$,
  'Derechos: límite de solicitudes por día', 'Demasiadas solicitudes');
reset role;
select test.fails($$update public.data_subject_requests set details = 'Otro texto' where id = current_setting('test.erase')::uuid$$,
  'Derechos: una solicitud resuelta no se modifica', 'no se modifica');
select test.fails($$delete from public.data_subject_requests$$, 'Derechos: las solicitudes no se borran', 'inmutable');

\echo 'Pruebas de seguridad y privacidad superadas.'
