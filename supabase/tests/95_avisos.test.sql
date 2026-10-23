-- =============================================================================
-- Avisos: eventos de dominio al outbox, proceso idempotente (sin duplicados),
-- contenido mínimo, preferencias solo para avisos no obligatorios, bandeja con
-- permisos actuales, envío con reintentos y dead-letter, webhook deduplicado,
-- rebotes, recordatorios por zona horaria y días laborables, límite de
-- frecuencia y aislamiento.
-- Escenario: helpers/fixtures.sql (E1 = u07/e07 supervisado por MGR = u06, que
-- también tiene ficha e06; CA = u03; AUD = u10; CB = u12; EXP = u14; PA = u01).
-- =============================================================================

\ir helpers/asserts.sql
\ir helpers/fixtures.sql

create or replace function test.today() returns date language sql stable as
  $$ select (now() at time zone 'Europe/Madrid')::date $$;
-- Lunes de una semana futura.
create or replace function test.monday(k int) returns date language sql stable as
  $$ select test.today() + (8 - extract(isodow from test.today())::int) + 7 * k $$;
create or replace function test.k(n int) returns uuid language sql immutable as
  $$ select ('ae000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function test.request(p_key uuid) returns uuid language sql stable security definer as
  $$ select id from public.absence_requests where idempotency_key = p_key $$;
create or replace function test.notif(p_user uuid, p_event text) returns public.notifications language sql stable security definer as
  $$ select * from public.notifications where recipient_user_id = p_user and event_type = p_event order by created_at desc limit 1 $$;
create or replace function test.delivery(p_user uuid, p_event text) returns public.email_deliveries language sql stable security definer as
  $$ select * from public.email_deliveries where recipient_user_id = p_user and event_type = p_event order by created_at desc limit 1 $$;
grant execute on function test.today(), test.monday(int), test.k(int), test.request(uuid), test.notif(uuid, text),
  test.delivery(uuid, text) to public;

-- -----------------------------------------------------------------------------
-- Evento de dominio -> outbox -> aviso y correo
-- -----------------------------------------------------------------------------
set role authenticated;
select test.act_as(test.u(7));
select public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-000000000001', 'day', test.monday(2),
  test.monday(2), test.k(1));
reset role;
select test.ok((select count(*) from public.notification_outbox where event_type = 'absence_submitted') = 1
  and not exists (select 1 from public.notifications), 'Outbox: la solicitud deja un evento y no envía nada en su transacción');

select test.ok((select processed from public.process_notification_outbox()) = 1, 'Proceso: el evento se procesa');
select test.ok((test.notif(test.u(6), 'absence_submitted')).link_path = '/ausencias/bandeja'
  and (test.notif(test.u(6), 'absence_submitted')).mandatory, 'Aviso: al aprobador, con enlace a su bandeja');
select test.ok((test.delivery(test.u(6), 'absence_submitted')).status = 'pending', 'Correo: queda en cola para el aprobador');
select test.ok((select array_agg(k order by k) from jsonb_object_keys((test.notif(test.u(6), 'absence_submitted')).params) k)
  <@ array['company', 'count', 'date', 'outcome', 'period', 'work_date']
  and (test.notif(test.u(6), 'absence_submitted')).params::text not like '%Tipo de pruebas%',
  'Contenido mínimo: empresa y fecha, sin el tipo de ausencia');

-- Duplicados: reprocesar o reencolar el mismo evento no crea nada nuevo.
select public.process_notification_outbox();
select test.ok(not private.enqueue_notification(test.co('A'), 'absence_submitted', 'absence_request', test.request(test.k(1)),
  test.e(7), (select source_key from public.notification_outbox where event_type = 'absence_submitted')),
  'Duplicados: el mismo evento no entra dos veces en el outbox');
select public.process_notification_outbox();
select test.ok((select count(*) from public.notifications where event_type = 'absence_submitted') = 1
  and (select count(*) from public.email_deliveries where event_type = 'absence_submitted') = 1,
  'Duplicados: un evento, un aviso y un correo por destinatario');

-- -----------------------------------------------------------------------------
-- Bandeja, permisos y aislamiento
-- -----------------------------------------------------------------------------
set role authenticated;
select test.act_as(test.u(6));
select test.ok((select count(*) from public.notifications where read_at is null) = 1, 'Bandeja: contador de no leídos');
select test.fails($$select * from public.notification_outbox$$, 'Outbox: no es visible para los usuarios', 'permission denied');
select test.fails($$update public.notifications set link_path = '/otra'$$, 'Aviso: no se modifica', 'permission denied');
select test.fails($$select public.process_notification_outbox()$$, 'Proceso: solo con la clave de servicio', 'permission denied');
select test.ok((select allowed and link_path = '/ausencias/bandeja' from public.open_notification(
  (test.notif(test.u(6), 'absence_submitted')).id)), 'Abrir: con permiso vigente lleva al objeto');
select test.ok((select count(*) from public.notifications where read_at is null) = 0, 'Abrir: marca el aviso como leído');
select test.act_as(test.u(7));
select test.ok(not exists (select 1 from public.notifications where recipient_user_id = test.u(6)),
  'Aislamiento: nadie ve avisos de otra persona');
select test.fails($$select * from public.open_notification((test.notif(test.u(6), 'absence_submitted')).id)$$,
  'Aislamiento: nadie abre el aviso de otra persona', 'no encontrado');
select test.act_as(test.u(12));
select test.ok(not exists (select 1 from public.notifications) and not exists (select 1 from public.email_deliveries),
  'CB: nada de otra empresa');
select test.act_as(test.u(6));
select test.ok(not exists (select 1 from public.email_deliveries), 'MGR: no ve la consola de entregas');
select test.act_as(test.u(10));
select test.ok(exists (select 1 from public.email_deliveries), 'AUD: la auditoría ve el estado de las entregas');
select test.act_as(test.u(3));
select test.ok(exists (select 1 from public.notification_support_summary(test.co('A')) where kind = 'email'),
  'Soporte: resumen por estado para la administración');
select test.act_as(test.u(7));
select test.fails($$select * from public.notification_support_summary(test.co('A'))$$, 'Soporte: no para empleados', 'permiso');

-- Preferencias: solo avisos no obligatorios.
select test.fails($$insert into public.notification_preferences (company_id, user_id, event_type, enabled)
  values (test.co('A'), test.u(7), 'absence_info_requested', false)$$, 'Preferencias: un aviso obligatorio no se desactiva',
  'notification_preferences_optional');
select test.fails($$insert into public.notification_preferences (company_id, user_id, event_type, enabled)
  values (test.co('A'), test.u(8), 'absence_cancelled', false)$$, 'Preferencias: nadie cambia las de otra persona',
  'row-level security');

-- Decisión: E1 desactivó el correo de decisiones; el aviso interno llega igual.
select test.act_as(test.u(6));
select public.decide_absence_request(test.request(test.k(1)), 'approve');
reset role;
select public.process_notification_outbox();
select test.ok((test.notif(test.u(7), 'absence_decided')).params ->> 'outcome' = 'approved'
  and (test.delivery(test.u(7), 'absence_decided')).id is null,
  'Preferencias: aviso en la bandeja y sin correo, como eligió la persona');

-- Enlace a un objeto ya no autorizado: termina la supervisión del manager.
update public.manager_assignments set valid_to = now() - interval '1 second'
where employee_id = test.e(7) and manager_user_id = test.u(6);
set role authenticated;
select test.act_as(test.u(6));
select test.ok((select not allowed from public.open_notification((test.notif(test.u(6), 'absence_submitted')).id)),
  'Abrir: si ya no tiene permiso sobre el objeto, no se le lleva a él');
reset role;
update public.manager_assignments set valid_to = null where employee_id = test.e(7) and manager_user_id = test.u(6);

-- -----------------------------------------------------------------------------
-- Envío: fallo temporal, reintento con espera, dead-letter y webhook
-- -----------------------------------------------------------------------------
select test.ok((select to_email from public.claim_email_deliveries() where event_type = 'absence_submitted') is not null,
  'Envío: se toma la entrega con la dirección del destinatario');
select test.ok(public.complete_email_delivery((test.delivery(test.u(6), 'absence_submitted')).id, 'failed', 'fake', null,
  'provider_unavailable', true) = 'pending', 'Fallo temporal: vuelve a la cola');
select test.ok((test.delivery(test.u(6), 'absence_submitted')).next_attempt_at > now()
  and (test.delivery(test.u(6), 'absence_submitted')).attempts = 1, 'Fallo temporal: con espera antes del reintento');
select test.ok(not exists (select 1 from public.claim_email_deliveries() where event_type = 'absence_submitted'),
  'Reintento: no antes de que pase la espera');
update public.email_deliveries set next_attempt_at = now() - interval '1 second'
where id = (test.delivery(test.u(6), 'absence_submitted')).id;
select test.ok((select attempt from public.claim_email_deliveries() where event_type = 'absence_submitted') = 2,
  'Reintento: segundo intento');
select test.ok(public.complete_email_delivery((test.delivery(test.u(6), 'absence_submitted')).id, 'sent', 'fake', 'ext-1')
  = 'sent', 'Envío: enviado con su id externo');
select test.ok(public.complete_email_delivery((test.delivery(test.u(6), 'absence_submitted')).id, 'failed', 'fake', null,
  'timeout', true) = 'sent', 'Envío: un resultado repetido no cambia una entrega enviada');
select test.ok(public.record_email_event('fake', 'evt-1', 'ext-1', 'delivered', now()), 'Webhook: entrega confirmada');
select test.ok(not public.record_email_event('fake', 'evt-1', 'ext-1', 'delivered', now()),
  'Webhook: el mismo evento externo no se aplica dos veces');
select test.ok((test.delivery(test.u(6), 'absence_submitted')).status = 'delivered', 'Webhook: estado entregado');
select test.ok(not public.record_email_event('fake', 'evt-x', 'desconocido', 'delivered', now()),
  'Webhook: un id externo desconocido se ignora');

-- Dead-letter: sin intentos restantes queda fallida; soporte puede reintentarla.
select private.enqueue_notification(test.co('A'), 'shift_changed', 'schedule', null, test.e(7), 'test:shift:1');
select public.process_notification_outbox();
update public.email_deliveries set max_attempts = 1 where id = (test.delivery(test.u(7), 'shift_changed')).id;
select public.claim_email_deliveries();
select test.ok(public.complete_email_delivery((test.delivery(test.u(7), 'shift_changed')).id, 'failed', 'fake', null,
  'provider_unavailable', true) = 'failed', 'Dead-letter: sin intentos restantes queda fallida');
set role authenticated;
select test.act_as(test.u(6));
select test.fails($$select public.retry_email_delivery((test.delivery(test.u(7), 'shift_changed')).id)$$,
  'Soporte: un manager no reintenta entregas', 'no encontrada');
select test.act_as(test.u(3));
select public.retry_email_delivery((test.delivery(test.u(7), 'shift_changed')).id);
select test.ok((test.delivery(test.u(7), 'shift_changed')).status = 'pending', 'Soporte: la administración la reintenta');

-- Rebote: las siguientes entregas a esa persona se suprimen.
reset role;
select public.claim_email_deliveries();
select public.complete_email_delivery((test.delivery(test.u(7), 'shift_changed')).id, 'sent', 'fake', 'ext-2');
select public.record_email_event('fake', 'evt-2', 'ext-2', 'bounced', now());
select test.ok((test.delivery(test.u(7), 'shift_changed')).status = 'bounced', 'Rebote: queda registrado');
select private.enqueue_notification(test.co('A'), 'time_missing_start', 'work_day', null, test.e(7), 'test:start:1');
select public.process_notification_outbox();
select public.claim_email_deliveries();
select test.ok((test.delivery(test.u(7), 'time_missing_start')).status = 'suppressed',
  'Rebote: no se insiste en una dirección que rebota');
select test.ok(exists (select 1 from public.notifications where recipient_user_id = test.u(7) and event_type = 'time_missing_start'),
  'Rebote: el aviso interno llega igual');

-- Límite de frecuencia: como mucho 3 correos de recordatorio en 24 horas.
update public.email_deliveries set status = 'sent', created_at = now() where recipient_user_id = test.u(8);
select private.enqueue_notification(test.co('A'), 'time_open_entry', 'work_day', null, test.e(8), 'test:open:' || g)
from generate_series(1, 4) g;
select public.process_notification_outbox();
select test.ok((select count(*) filter (where status = 'pending') = 3 and count(*) filter (where status = 'skipped'
  and last_error_code = 'frequency_limit') = 1 from public.email_deliveries where recipient_user_id = test.u(8)),
  'Frecuencia: el cuarto recordatorio del día no se envía por correo');

-- -----------------------------------------------------------------------------
-- Recordatorios: zona horaria, horario y días laborables
-- -----------------------------------------------------------------------------
set role authenticated;
select test.act_as(test.u(7));
select public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-000000000001', 'day', test.monday(3),
  test.monday(3), test.k(2));
reset role;
-- Miércoles a las 08:30 UTC = 09:30 o 10:30 en Madrid (dentro del horario).
select test.ok(public.run_scheduled_reminders(((test.monday(1) + 2)::timestamp + time '08:30') at time zone 'UTC') >= 1,
  'Zona horaria: a las 08:30 UTC ya es horario laboral en Madrid');
select test.ok((select count(*) from public.notification_outbox where event_type = 'approval_overdue') = 1,
  'Recordatorio: aprobación vencida para el aprobador');
select public.run_scheduled_reminders(((test.monday(1) + 2)::timestamp + time '13:00') at time zone 'UTC');
select test.ok((select count(*) from public.notification_outbox where event_type = 'approval_overdue') = 1,
  'Frecuencia: un recordatorio por aprobador y día');
select public.run_scheduled_reminders(((test.monday(1) + 3)::timestamp + time '06:30') at time zone 'UTC');
select test.ok((select count(*) from public.notification_outbox where event_type = 'approval_overdue') = 1,
  'Zona horaria: a las 06:30 UTC aún no es horario laboral en Madrid');
select public.run_scheduled_reminders(((test.monday(1) + 5)::timestamp + time '09:00') at time zone 'UTC');
select test.ok((select count(*) from public.notification_outbox where event_type = 'approval_overdue') = 1,
  'Días laborables: el sábado no hay recordatorios');
select public.run_scheduled_reminders(((test.monday(1) + 3)::timestamp + time '09:00') at time zone 'UTC');
select test.ok((select count(*) from public.notification_outbox where event_type = 'approval_overdue') = 2,
  'Recordatorio: al día laborable siguiente, otro');
select public.process_notification_outbox();
select test.ok((test.notif(test.u(6), 'approval_overdue')).params ->> 'count' = '1'
  and (test.notif(test.u(6), 'approval_overdue')).link_path = '/ausencias/bandeja',
  'Recordatorio: con el recuento pendiente y enlace a la bandeja');

-- Turnos: un cambio publicado avisa a la persona.
insert into public.schedule_events (company_id, employee_id, event_type) values (test.co('A'), test.e(8), 'shift_assignment_changed');
select public.process_notification_outbox();
select test.ok((test.notif(test.u(8), 'shift_changed')).link_path = '/horario', 'Turnos: aviso con enlace al horario');

-- Membresía caducada: no recibe avisos.
select private.enqueue_notification(test.co('A'), 'shift_changed', 'schedule', null, test.e(14), 'test:shift:exp');
select public.process_notification_outbox();
select test.ok(not exists (select 1 from public.notifications where recipient_user_id = test.u(14)),
  'EXP: con la membresía caducada no recibe avisos');

-- Tareas: registro de ejecuciones solo para la administración de plataforma.
select public.record_job_run('avisos', now() - interval '1 second', true, '{"procesados": 3}');
set role authenticated;
select test.act_as(test.u(1));
select test.ok((select count(*) from public.recent_job_runs()) = 1, 'Tareas: la plataforma ve las ejecuciones');
select test.act_as(test.u(3));
select test.fails($$select * from public.recent_job_runs()$$, 'Tareas: la administración de empresa no', 'permiso');
reset role;

\echo 'Pruebas de avisos superadas.'
