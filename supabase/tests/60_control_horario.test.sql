-- =============================================================================
-- Control horario: idempotencia, máquina de estados, medianoche y zona horaria,
-- ubicación y selfie según política, terminal con PIN, correcciones con ajuste,
-- incidencias, recordatorios, permisos y RLS. La concurrencia real (dos
-- sesiones a la vez) se prueba en scripts/test-db-concurrency.sh.
-- Escenario en helpers/fixtures.sql (E1 = u07/e07 en A1; E2 = u08/e08 en A2;
-- MGR = u06 supervisa a E1; HRW = RR. HH. solo del centro A2).
-- =============================================================================

\ir helpers/asserts.sql
\ir helpers/fixtures.sql

-- Fichaje con una hora concreta (solo como servicio, para simular el pasado).
create or replace function test.punch_at(p_employee uuid, p_kind public.punch_kind, p_at timestamptz,
  p_key uuid default gen_random_uuid(), p_device_at timestamptz default null)
returns jsonb language sql as $$
  select private.insert_punch(p_employee, p_kind, p_key, 'web', p_device_at, null, null, 'not_requested',
    null, null, null, null, p_at)
$$;
create or replace function test.k(n int) returns uuid language sql immutable as
  $$ select ('4b000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
grant execute on function test.k(int) to public;

-- -----------------------------------------------------------------------------
-- Conversión horaria y horario planificado (mismas reglas que el resolvedor TS)
-- -----------------------------------------------------------------------------
select test.ok(private.local_to_utc('Europe/Madrid', '2026-03-29', 150) = '2026-03-29 01:30+00',
  'Zona: hora inexistente de primavera -> 03:30 CEST');
select test.ok(private.local_to_utc('Europe/Madrid', '2026-10-25', 150) = '2026-10-25 00:30+00',
  'Zona: hora repetida de otoño -> primera vez (CEST)');
select test.ok(private.local_to_utc('Europe/Madrid', '2026-10-24', 1800) = '2026-10-25 05:00+00',
  'Zona: 06:00 del día siguiente tras el cambio de otoño');
select test.ok(private.local_to_utc('Atlantic/Canary', '2026-07-15', 480) = '2026-07-15 07:00+00',
  'Zona: Canarias va una hora por detrás');

-- Turno de noche publicado para E2 desde hace 60 días y mañana de 08:00 a 15:00 para E1.
insert into public.shift_templates (id, company_id, code, name) values
  ('6f000000-0000-4000-8000-000000000001', test.co('A'), 'TN', 'Noche'),
  ('6f000000-0000-4000-8000-000000000002', test.co('A'), 'TM', 'Mañana');
insert into public.shift_template_versions (id, company_id, template_id, version, kind, target_minutes,
  tolerance_early_minutes, tolerance_late_minutes) values
  ('6e000000-0000-4000-8000-000000000001', test.co('A'), '6f000000-0000-4000-8000-000000000001', 1, 'night', 480, 5, 10),
  ('6e000000-0000-4000-8000-000000000002', test.co('A'), '6f000000-0000-4000-8000-000000000002', 1, 'continuous', 420, 5, 10);
insert into public.shift_template_segments (company_id, version_id, position, start_minute, end_minute) values
  (test.co('A'), '6e000000-0000-4000-8000-000000000001', 1, 1320, 1800),
  (test.co('A'), '6e000000-0000-4000-8000-000000000002', 1, 480, 900);
update public.shift_template_versions set status = 'published', valid_from = '2026-01-01', published_at = now()
where id in ('6e000000-0000-4000-8000-000000000001', '6e000000-0000-4000-8000-000000000002');
insert into public.shift_assignments (id, company_id, scope_type, employee_id, valid_from, anchor_date, cycle_days)
values
  ('6a000000-0000-4000-8000-000000000001', test.co('A'), 'employee', test.e(8), '2026-01-01', '2026-01-01', 1),
  ('6a000000-0000-4000-8000-000000000002', test.co('A'), 'employee', test.e(7), '2026-01-01', '2026-01-01', 1);
insert into public.shift_assignment_days (assignment_id, company_id, day_index, template_id) values
  ('6a000000-0000-4000-8000-000000000001', test.co('A'), 0, '6f000000-0000-4000-8000-000000000001'),
  ('6a000000-0000-4000-8000-000000000002', test.co('A'), 0, '6f000000-0000-4000-8000-000000000002');
update public.shift_assignments set status = 'published', published_at = now()
where id in ('6a000000-0000-4000-8000-000000000001', '6a000000-0000-4000-8000-000000000002');

select test.ok((select starts_at = '2026-10-24 20:00+00' and ends_at = '2026-10-25 05:00+00'
  from private.planned_shift(test.e(8), '2026-10-24')), 'Plan: noche del cambio de otoño en SQL igual que en TS');

-- -----------------------------------------------------------------------------
-- Medianoche, cambio de hora y zona horaria (hora del servidor simulada)
-- -----------------------------------------------------------------------------
select test.punch_at(test.e(8), 'start', '2026-10-24 22:00 Europe/Madrid');
select test.punch_at(test.e(8), 'end', '2026-10-25 06:00 Europe/Madrid');
select test.ok((select work_date = '2026-10-24' and status = 'closed' and worked_seconds = 9 * 3600
  from public.time_entries where employee_id = test.e(8) and work_date = '2026-10-24'),
  'Medianoche: la jornada nocturna es del día de inicio y cuenta 9 h reales en el cambio de hora');
select test.ok((select count(*) from public.time_incidents where employee_id = test.e(8)
  and work_date = '2026-10-24' and status = 'open') = 0, 'Noche dentro de tolerancia: sin incidencias');

-- Canarias: 23:30 UTC del 2 de noviembre es 23:30 local (aún día 2); en Madrid sería día 3.
update public.work_centers set timezone = 'Atlantic/Canary' where id = test.wc('A2');
select test.punch_at(test.e(8), 'start', '2026-11-02 23:30+00');
select test.ok((select work_date = '2026-11-02' and time_zone = 'Atlantic/Canary'
  from public.time_entries where employee_id = test.e(8) and status = 'open'),
  'Zona: la fecha de la jornada sale de la zona del centro (Canarias)');
select test.punch_at(test.e(8), 'end', '2026-11-03 07:30+00');
update public.work_centers set timezone = 'Europe/Madrid' where id = test.wc('A2');

-- Olvido: una jornada abierta hace más de 16 h se cierra incompleta al empezar otra.
select test.punch_at(test.e(8), 'start', '2026-11-04 22:00 Europe/Madrid');
select test.fails($$select test.punch_at(test.e(8), 'start', '2026-11-05 02:00 Europe/Madrid')$$,
  'Estados: no se abre otra jornada con una abierta reciente', 'jornada abierta');
select test.punch_at(test.e(8), 'start', '2026-11-05 21:30 Europe/Madrid');
select test.ok((select status = 'incomplete' from public.time_entries
  where employee_id = test.e(8) and work_date = '2026-11-04'), 'Olvido: la jornada anterior queda incompleta');
select test.ok(exists (select 1 from public.time_incidents i join public.time_entries t on t.id = i.time_entry_id
  where t.employee_id = test.e(8) and t.work_date = '2026-11-04' and i.kind = 'missing_end' and i.status = 'open'),
  'Olvido: genera la incidencia de salida no registrada');
select test.ok((select count(*) from public.time_entries where employee_id = test.e(8)
  and status in ('open', 'on_break')) = 1, 'Olvido: solo queda una jornada abierta');
select test.punch_at(test.e(8), 'end', '2026-11-06 05:58 Europe/Madrid');

-- Tolerancia: E1 tiene mañana de 08:00 a 15:00 con 5 min antes / 10 después.
select test.punch_at(test.e(7), 'start', '2026-10-20 08:20 Europe/Madrid');
select test.punch_at(test.e(7), 'end', '2026-10-20 15:05 Europe/Madrid');
select test.ok((select (detail ->> 'minutes')::int = 20 from public.time_incidents
  where employee_id = test.e(7) and work_date = '2026-10-20' and kind = 'start_out_of_tolerance'),
  'Tolerancia: entrar 20 min tarde genera incidencia con la desviación');
select test.ok(not exists (select 1 from public.time_incidents where employee_id = test.e(7)
  and work_date = '2026-10-20' and kind = 'end_out_of_tolerance'), 'Tolerancia: salir 5 min tarde no');
select test.punch_at(test.e(7), 'start', '2026-10-18 09:00 Europe/Madrid');
select test.punch_at(test.e(7), 'end', '2026-10-18 10:00 Europe/Madrid');
insert into public.leave_periods (company_id, employee_id, starts_on, ends_on)
values (test.co('A'), test.e(7), '2026-10-19', '2026-10-19');
select test.punch_at(test.e(7), 'start', '2026-10-19 08:00 Europe/Madrid');
select test.punch_at(test.e(7), 'end', '2026-10-19 09:00 Europe/Madrid');
select test.ok(exists (select 1 from public.time_incidents where employee_id = test.e(7)
  and work_date = '2026-10-19' and kind = 'unplanned_work' and detail ->> 'planned' = 'absence'),
  'Fuera de horario: fichar un día de ausencia aprobada genera incidencia');

-- Inmutabilidad, incluso como servicio.
select test.fails($$update public.punches set server_at = server_at - interval '1 hour'
  where employee_id = test.e(7)$$, 'Servicio: los fichajes no se modifican', 'inmutables');
select test.fails($$delete from public.punches where employee_id = test.e(7)$$,
  'Servicio: los fichajes no se borran', 'inmutables');
select test.fails($$delete from public.time_entries where employee_id = test.e(7)$$,
  'Servicio: las jornadas no se borran', 'inmutable');

-- -----------------------------------------------------------------------------
-- Fichaje desde la aplicación: idempotencia y máquina de estados
-- -----------------------------------------------------------------------------
set role authenticated;
select test.act_as(test.u(7));
select test.ok((public.record_punch(test.co('A'), 'start', test.k(1), 'mobile') ->> 'duplicate')::boolean = false,
  'Fichaje: la primera petición registra la entrada');
select test.ok((public.record_punch(test.co('A'), 'start', test.k(1), 'mobile') ->> 'duplicate')::boolean,
  'Idempotencia: la misma clave devuelve el mismo fichaje');
select test.ok((select count(*) from public.punches where idempotency_key = test.k(1)) = 1,
  'Idempotencia: dos peticiones con la misma clave generan un solo evento');
select test.fails($$select public.record_punch(test.co('A'), 'end', test.k(1), 'mobile')$$,
  'Idempotencia: una clave no sirve para otro tipo de fichaje', 'otro fichaje');
select test.fails($$select public.record_punch(test.co('A'), 'start', test.k(2), 'mobile')$$,
  'Doble toque: una segunda entrada con otra clave se rechaza', 'jornada abierta');
select test.fails($$select public.record_punch(test.co('A'), 'break_end', test.k(3), 'web')$$,
  'Estados: no se reanuda sin pausa', 'No estás en pausa');
select test.ok((select count(*) from public.punches p join public.time_entries t on t.id = p.time_entry_id
  where t.status = 'open' and t.employee_id = test.e(7)) = 1,
  'Secuencia inválida: la jornada sigue intacta (un fichaje, abierta)');
select public.record_punch(test.co('A'), 'break_start', test.k(4), 'web');
select test.fails($$select public.record_punch(test.co('A'), 'end', test.k(5), 'web')$$,
  'Estados: no se sale estando en pausa', 'Estás en pausa');
select public.record_punch(test.co('A'), 'break_end', test.k(6), 'web');
select test.ok((public.record_punch(test.co('A'), 'end', test.k(7), 'web') ->> 'status') = 'closed',
  'Estados: inicio, pausa, reanudación y fin cierran la jornada');
select test.fails($$select public.record_punch(test.co('A'), 'break_start', test.k(8), 'web')$$,
  'Estados: sin jornada abierta no hay pausa', 'No hay ninguna jornada abierta');
select test.fails($$select public.record_punch(test.co('A'), 'start', test.k(9), 'kiosk')$$,
  'Origen: la aplicación no puede declararse terminal', 'Origen no válido');

-- Hora del dispositivo muy distinta (p. ej. reintento sin conexión): se usa la del servidor y se revisa.
select public.record_punch(test.co('A'), 'start', test.k(10), 'mobile', now() - interval '40 minutes');
select test.ok((select server_at > device_at + interval '39 minutes' from public.punches where idempotency_key = test.k(10)),
  'Reintento offline: la hora oficial es la del servidor; la del dispositivo queda declarada');
select test.ok(exists (select 1 from public.time_incidents where kind = 'device_time_mismatch'
  and punch_id = (select id from public.punches where idempotency_key = test.k(10))),
  'Reintento offline: la diferencia de hora genera una incidencia');

-- Ubicación desactivada: no se guarda aunque llegue.
select public.record_punch(test.co('A'), 'break_start', test.k(11), 'mobile', null, null, 'granted', 40.4, -3.7, 15);
select test.ok((select latitude is null and location_status = 'not_requested' from public.punches
  where idempotency_key = test.k(11)), 'Ubicación: con la política desactivada no se guarda');

select test.fails($$insert into public.punches (company_id, employee_id, time_entry_id, kind, time_zone, source,
  idempotency_key) select company_id, employee_id, id, 'end', 'Europe/Madrid', 'web', gen_random_uuid()
  from public.time_entries where employee_id = test.e(7) limit 1$$,
  'E1: no inserta fichajes directamente', 'permission denied');
select test.fails($$update public.punches set kind = 'end'$$, 'E1: no modifica fichajes', 'permission denied');
select test.fails($$delete from public.punches$$, 'E1: no borra fichajes', 'permission denied');
select test.fails($$update public.time_entries set worked_seconds = 99999$$,
  'E1: no modifica su jornada', 'permission denied');

-- Ubicación exigida: se pide al fichar; si se deniega, el fichaje vale y queda incidencia.
select test.act_as(test.u(4));
select test.ok(test.affected($$update public.time_tracking_policies set location_mode = 'required',
  location_notice = 'Registramos una única ubicación al fichar para verificar el centro.'
  where company_id = test.co('A') and work_center_id is null$$) = 1, 'Política: RR. HH. exige ubicación');
select test.act_as(test.u(7));
select public.record_punch(test.co('A'), 'break_end', test.k(12), 'mobile', null, null, 'denied');
select test.ok(exists (select 1 from public.time_incidents where kind = 'location_unavailable'
  and punch_id = (select id from public.punches where idempotency_key = test.k(12))),
  'Ubicación denegada: el fichaje se registra y se crea una incidencia');
select public.record_punch(test.co('A'), 'end', test.k(13), 'mobile', null, null, 'granted', 40.416775, -3.703790, 12);
select test.ok((select latitude = 40.416775 and accuracy_m = 12 from public.punches where idempotency_key = test.k(13)),
  'Ubicación concedida: se guardan coordenadas y precisión del momento del fichaje');
select test.fails($$select public.record_punch(test.co('A'), 'start', test.k(14), 'mobile', null, null, 'granted')$$,
  'Ubicación: concedida sin coordenadas se rechaza', 'incompleta');

-- Selfie: solo con la política activada, en la ruta propia y en el bucket privado.
select test.fails($$select public.record_punch(test.co('A'), 'start', test.k(15), 'mobile', null, null, 'denied',
  null, null, null, test.co('A') || '/' || test.e(7) || '/' || test.k(15) || '.jpg')$$,
  'Selfie: desactivada por política se rechaza', 'no está activada');
select test.fails($$insert into storage.objects (bucket_id, name, owner) values ('punch-selfies',
  test.co('A') || '/' || test.e(7) || '/' || test.k(15) || '.jpg', test.u(7))$$,
  'Selfie: sin la política no se puede subir', 'row-level security');
select test.act_as(test.u(4));
update public.time_tracking_policies set selfie_enabled = true where company_id = test.co('A');
select test.act_as(test.u(7));
insert into storage.objects (bucket_id, name, owner)
values ('punch-selfies', test.co('A') || '/' || test.e(7) || '/' || test.k(15) || '.jpg', test.u(7));
select test.fails($$insert into storage.objects (bucket_id, name, owner) values ('punch-selfies',
  test.co('A') || '/' || test.e(8) || '/' || test.k(16) || '.jpg', test.u(7))$$,
  'Selfie: nadie sube fotos en la ruta de otra persona', 'row-level security');
select public.record_punch(test.co('A'), 'start', test.k(15), 'mobile', null, null, 'denied', null, null, null,
  test.co('A') || '/' || test.e(7) || '/' || test.k(15) || '.jpg');
select test.ok((select selfie_path is not null from public.punches where idempotency_key = test.k(15)),
  'Selfie: activada, se enlaza al fichaje');
select test.fails($$select public.record_punch(test.co('A'), 'break_start', test.k(17), 'mobile', null, null,
  'denied', null, null, null, test.co('A') || '/' || test.e(7) || '/' || test.k(15) || '.jpg')$$,
  'Selfie: la ruta debe corresponder a la clave del fichaje', 'Foto no válida');
select test.act_as(test.u(8));
select test.ok(not exists (select 1 from storage.objects where bucket_id = 'punch-selfies'),
  'Selfie: E2 no ve la foto de E1');
select test.act_as(test.u(6));
select test.ok(exists (select 1 from storage.objects where bucket_id = 'punch-selfies'),
  'Selfie: el manager de E1 sí');

-- -----------------------------------------------------------------------------
-- Permisos y aislamiento
-- -----------------------------------------------------------------------------
select test.act_as(test.u(8));
select test.ok(not exists (select 1 from public.punches where employee_id = test.e(7)), 'E2: no ve fichajes de E1');
select test.ok(not exists (select 1 from public.time_incidents where employee_id = test.e(7)), 'E2: ni sus incidencias');
select test.ok(exists (select 1 from public.time_entries where employee_id = test.e(8)), 'E2: ve sus jornadas');
select test.act_as(test.u(6));
select test.ok(exists (select 1 from public.punches where employee_id = test.e(7))
  and not exists (select 1 from public.punches where employee_id = test.e(8)),
  'MGR: ve fichajes de quien supervisa y no de los demás');
select test.act_as(test.u(5));
select test.ok(exists (select 1 from public.time_entries where employee_id = test.e(8))
  and not exists (select 1 from public.time_entries where employee_id = test.e(7)),
  'HRW: solo ve jornadas de su centro');
select test.act_as(test.u(10));
select test.ok((select count(distinct employee_id) from public.time_entries) = 2, 'AUD: ve los registros de la empresa');
select test.act_as(test.u(12));
select test.ok(not exists (select 1 from public.punches) and not exists (select 1 from public.time_entries),
  'CB: no ve registros de otra empresa');
select test.fails($$select public.record_punch(test.co('A'), 'start', test.k(20), 'web')$$,
  'CB: no ficha en otra empresa', 'No tienes ficha');
select test.act_as(test.u(14));
select test.ok(not exists (select 1 from public.time_entries), 'EXP: con la membresía caducada no ve registros');
select test.fails($$select public.record_punch(test.co('A'), 'start', test.k(21), 'web')$$,
  'EXP: ni ficha', 'No tienes ficha');
select test.act_as(test.u(5));
select test.ok((select bool_and(scope_type = 'work_center') from public.my_time_access(test.co('A'))),
  'Accesos: RR. HH. de centro gestiona el control horario solo de su centro');
select test.act_as(test.u(7));
select test.ok(not exists (select 1 from public.my_time_access(test.co('A'))), 'Accesos: un empleado no gestiona');
select test.fails($$select * from public.kiosk_pins$$, 'Nadie lee los PIN desde la API', 'permission denied');
select test.fails($$select * from public.kiosk_attempts$$, 'Ni los intentos del terminal', 'permission denied');

-- -----------------------------------------------------------------------------
-- Terminal compartido
-- -----------------------------------------------------------------------------
select test.act_as(test.u(7));
select test.fails($$select public.set_my_kiosk_pin(test.co('A'), '123456')$$, 'PIN: se rechazan secuencias', 'predecible');
select test.fails($$select public.set_my_kiosk_pin(test.co('A'), '777777')$$, 'PIN: y repeticiones', 'predecible');
select test.fails($$select public.set_my_kiosk_pin(test.co('A'), '12ab')$$, 'PIN: 6 cifras', '6 cifras');
select public.set_my_kiosk_pin(test.co('A'), '482913');
select test.ok((select has_kiosk_pin from public.my_time_status(test.co('A'))), 'PIN: la persona define el suyo');
select test.fails($$select public.register_kiosk_device(test.wc('A1'), 'Entrada principal')$$,
  'Terminal: un empleado no da de alta terminales', 'no encontrado');

select test.act_as(test.u(4));
select public.register_kiosk_device(test.wc('A1'), 'Entrada principal') as kiosk_token \gset
select test.fails($$select token_hash from public.kiosk_devices$$, 'Terminal: el hash del token no se expone',
  'permission denied');
select test.ok((select count(*) from public.kiosk_devices) = 1, 'Terminal: RR. HH. lo ve en su lista');
select test.act_as(test.u(5));
select test.fails($$select public.register_kiosk_device(test.wc('A1'), 'Otro')$$,
  'Terminal: RR. HH. de centro no da de alta terminales de otro centro', 'no encontrado');
select test.act_as(test.u(12));
select test.fails($$select public.register_kiosk_device(test.wc('A1'), 'Ajeno')$$,
  'Terminal: ni otra empresa', 'no encontrado');

reset role;
-- Sin sesión: el terminal no lleva identidad de usuario.
select set_config('request.jwt.claims', '{"role": "anon"}', false);
set role anon;
select test.ok((select device_name from public.kiosk_device_info(:'kiosk_token')) = 'Entrada principal',
  'Terminal: el token activa el dispositivo sin sesión');
select test.ok(not exists (select 1 from public.kiosk_device_info('token-falso')), 'Terminal: token falso no');
select test.fails($$select * from public.punches$$, 'Anónimo: no lee fichajes', 'permission denied');
select test.fails($$select public.record_punch(test.co('A'), 'start', test.k(30), 'web')$$,
  'Anónimo: no usa el fichaje de la aplicación', 'permission denied');

select test.ok(public.kiosk_punch('token-falso', 'A-007', '482913', 'start', test.k(31)) ->> 'status' = 'device_invalid',
  'Terminal: sin token válido no ficha');
select test.ok(public.kiosk_punch(:'kiosk_token', 'A-007', '000000', 'start', test.k(32)) ->> 'status' = 'invalid',
  'Terminal: PIN incorrecto');
select test.ok(public.kiosk_punch(:'kiosk_token', 'NO-EXISTE', '482913', 'start', test.k(33)) ->> 'status' = 'invalid',
  'Terminal: un código inexistente da el mismo mensaje');
select test.ok(public.kiosk_punch(:'kiosk_token', 'B-011', '482913', 'start', test.k(34)) ->> 'status' = 'invalid',
  'Terminal: no sirve para personas de otra empresa');
select test.ok((select public.kiosk_punch(:'kiosk_token', 'a-007', '482913', 'break_start', test.k(35))) ->> 'status' = 'ok',
  'Terminal: código (sin distinguir mayúsculas) y PIN correctos registran el fichaje');
select test.ok((select public.kiosk_punch(:'kiosk_token', 'A-007', '482913', 'break_start', test.k(35))) ->> 'duplicate' = 'true',
  'Terminal: un reintento con la misma clave no duplica');
select test.ok((select not (r ? 'employee_id') and not (r ? 'name') and not (r ? 'first_name')
  from public.kiosk_punch(:'kiosk_token', 'A-007', '482913', 'break_end', test.k(36)) r),
  'Terminal: la respuesta no contiene datos de la persona');
select test.ok(public.kiosk_punch(:'kiosk_token', 'A-007', '482913', 'start', test.k(37)) ->> 'status' = 'rejected',
  'Terminal: una transición imposible se rechaza');
select public.kiosk_punch(:'kiosk_token', 'A-007', '000001', 'end', test.k(40 + n)) from generate_series(1, 5) n;
select test.ok(public.kiosk_punch(:'kiosk_token', 'A-007', '482913', 'end', test.k(50)) ->> 'status' = 'locked',
  'Terminal: 5 fallos seguidos bloquean a la persona aunque luego acierte');
reset role;
update public.kiosk_pins set locked_until = now() - interval '1 second' where employee_id = test.e(7);
set role anon;
select test.ok(public.kiosk_punch(:'kiosk_token', 'A-007', '482913', 'end', test.k(51)) ->> 'status' = 'ok',
  'Terminal: pasado el bloqueo vuelve a funcionar');
select public.kiosk_punch(:'kiosk_token', 'X-' || n, '000000', 'start', gen_random_uuid()) from generate_series(1, 11) n;
select test.ok(public.kiosk_punch(:'kiosk_token', 'A-007', '482913', 'start', test.k(52)) ->> 'status' = 'device_blocked',
  'Terminal: demasiados fallos en el dispositivo lo bloquean temporalmente');
reset role;
select test.ok((select source = 'kiosk' and kiosk_device_id is not null and created_by is null
  from public.punches where idempotency_key = test.k(35)), 'Terminal: el fichaje queda con su origen y terminal');

-- -----------------------------------------------------------------------------
-- Correcciones: la aprobación crea un ajuste y no toca el original
-- -----------------------------------------------------------------------------
set role authenticated;
select test.act_as(test.u(7));
select public.request_time_correction(test.e(7), 'change', 'Fiché tarde por un fallo de la app',
  null, (select id from public.punches where employee_id = test.e(7) and kind = 'start'
         and server_at = '2026-10-20 08:20 Europe/Madrid'),
  null, '2026-10-20 08:00 Europe/Madrid') as req_change \gset
select test.fails($$select public.decide_time_correction('$$ || :'req_change' || $$', true)$$,
  'Corrección: nadie aprueba la suya', 'no encontrada');
select test.fails($$select public.request_time_correction(test.e(8), 'add', 'Ajena', null, null, 'start', now() - interval '1 day')$$,
  'Corrección: no se solicita para otra persona', 'no encontrado');
select test.fails($$select public.request_time_correction(test.e(7), 'add', 'Futuro', null, null, 'start', now() + interval '1 day')$$,
  'Corrección: no se proponen horas futuras', 'futuras');

select test.act_as(test.u(8));
select test.ok(not exists (select 1 from public.time_correction_requests), 'E2: no ve correcciones de E1');
select test.act_as(test.u(6));
select test.ok(exists (select 1 from public.time_correction_requests where id = :'req_change'),
  'MGR: ve la solicitud de quien supervisa');
select test.ok(public.decide_time_correction(:'req_change', true, 'Comprobado con el equipo') is not null,
  'MGR: como aprobador de correcciones, la aprueba');
select test.ok((select server_at = '2026-10-20 08:20 Europe/Madrid' from public.punches
  where employee_id = test.e(7) and server_at = '2026-10-20 08:20 Europe/Madrid'),
  'Corrección: el fichaje original no cambia');
select test.ok((select before -> 'punches' -> 0 ->> 'at' <> after -> 'punches' -> 0 ->> 'at'
  and reason = 'Fiché tarde por un fallo de la app' and decided_by = test.u(6) and requested_by = test.u(7)
  from public.time_adjustments where request_id = :'req_change'),
  'Corrección: el ajuste conserva antes, después, motivo y autores');
select test.ok((select started_at = '2026-10-20 08:00 Europe/Madrid' and worked_seconds = 7 * 3600 + 300
  from public.time_entries where employee_id = test.e(7) and work_date = '2026-10-20'),
  'Corrección: la jornada se recalcula con el valor corregido');
select test.ok((select status = 'resolved' from public.time_incidents where employee_id = test.e(7)
  and work_date = '2026-10-20' and kind = 'start_out_of_tolerance'),
  'Corrección: la incidencia de tolerancia se resuelve sola al recalcular');
select test.fails($$select public.decide_time_correction('$$ || :'req_change' || $$', true)$$,
  'Corrección: no se decide dos veces', 'ya está decidida');

-- Una corrección que dejaría una secuencia imposible se rechaza sin cambiar nada.
select test.act_as(test.u(7));
select public.request_time_correction(test.e(7), 'add', 'Segunda salida por error', (select id from public.time_entries
  where employee_id = test.e(7) and work_date = '2026-10-20'), null, 'end', '2026-10-20 16:00 Europe/Madrid') as req_bad \gset
select test.act_as(test.u(6));
select test.fails($$select public.decide_time_correction('$$ || :'req_bad' || $$', true)$$,
  'Corrección imposible: se rechaza', 'imposible');
select test.ok((select status = 'pending' from public.time_correction_requests where id = :'req_bad')
  and (select worked_seconds = 7 * 3600 + 300 from public.time_entries where employee_id = test.e(7) and work_date = '2026-10-20')
  and not exists (select 1 from public.time_adjustments where request_id = :'req_bad'),
  'Corrección imposible: ni la jornada ni la solicitud se corrompen');
select public.decide_time_correction(:'req_bad', false, 'No procede');
select test.ok((select status = 'rejected' and decided_by = test.u(6) from public.time_correction_requests where id = :'req_bad'),
  'Corrección: el rechazo queda registrado con su autor');

-- Jornada olvidada entera: RR. HH. la solicita y otra persona la aprueba.
select test.act_as(test.u(4));
select public.request_time_correction(test.e(99), 'add', 'Olvidó fichar el día completo', null, null, 'start',
  '2026-10-21 09:00 Europe/Madrid') as req_add \gset
select test.fails($$select public.decide_time_correction('$$ || :'req_add' || $$', true)$$,
  'Corrección: quien la solicita no la aprueba', 'no puede aprobarla');
select test.act_as(test.u(3));
select public.decide_time_correction(:'req_add', true, 'Confirmado por el responsable');
select test.ok((select status = 'incomplete' from public.time_entries where employee_id = test.e(99)),
  'Corrección: crea la jornada olvidada, incompleta hasta añadir la salida');

select test.fails($$update public.time_adjustments set reason = 'otro'$$, 'Ajustes: sin modificación desde la API',
  'permission denied');
reset role;
select test.fails($$update public.time_adjustments set reason = 'otro'$$, 'Ajustes: inmutables incluso como servicio',
  'inmutables');
select test.ok(not exists (select 1 from public.audit_log where table_name in ('punches', 'time_entries')
  or new_data::text like '%latitude%'), 'Registros: ni coordenadas ni fichajes en audit_log');
select test.ok(exists (select 1 from public.audit_log where table_name = 'time_adjustments'),
  'Auditoría: los ajustes quedan en audit_log');

-- -----------------------------------------------------------------------------
-- Incidencias y recordatorios
-- -----------------------------------------------------------------------------
set role authenticated;
select test.act_as(test.u(7));
select test.fails($$select public.resolve_time_incident((select id from public.time_incidents where status = 'open' limit 1), 'dismissed', 'Mía')$$,
  'Incidencias: la persona no resuelve las suyas', 'no encontrada');
select test.act_as(test.u(6));
select test.fails($$select public.resolve_time_incident((select id from public.time_incidents where employee_id = test.e(7) and status = 'open' limit 1), 'resolved', '')$$,
  'Incidencias: se exige una nota', 'Explica');
select public.resolve_time_incident((select id from public.time_incidents
  where employee_id = test.e(7) and kind = 'unplanned_work'), 'dismissed', 'Acudió a una reunión');
select test.ok((select status = 'dismissed' and resolved_by = test.u(6) from public.time_incidents
  where employee_id = test.e(7) and kind = 'unplanned_work'), 'Incidencias: el manager las revisa');
select test.fails($$select public.generate_time_reminders()$$, 'Recordatorios: solo la tarea programada',
  'permission denied');

reset role;
select test.punch_at(test.e(14), 'start', now() - interval '13 hours');
set role service_role;
select test.ok(public.generate_time_reminders() >= 1, 'Recordatorios: jornada abierta demasiado tiempo');
select test.ok(public.generate_time_reminders() = 0, 'Recordatorios: no se duplican');
reset role;
select test.ok(exists (select 1 from public.work_events where employee_id = test.e(14)
  and event_type = 'reminder_open_entry'), 'Recordatorios: quedan como eventos de trabajo pendientes');
select test.ok(exists (select 1 from public.work_events where event_type = 'correction_decided'),
  'Avisos: la decisión de una corrección genera un evento');
set role authenticated;
select test.act_as(test.u(7));
select test.ok(not exists (select 1 from public.work_events where employee_id <> test.e(7)),
  'Avisos: cada persona ve solo los suyos');

\echo 'Pruebas de control horario superadas.'
