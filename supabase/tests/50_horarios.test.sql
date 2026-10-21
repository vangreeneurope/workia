-- =============================================================================
-- Calendarios, plantillas de turno versionadas y asignaciones: permisos por
-- ámbito, versionado sin efecto retroactivo, conflictos y eventos.
-- Escenario en helpers/fixtures.sql (MGR supervisa a E1; HRW es RR. HH. solo
-- del centro A2; EXP tiene la membresía caducada; RFUT tiene un rol futuro).
-- =============================================================================

\ir helpers/asserts.sql
\ir helpers/fixtures.sql

-- Fechas relativas a hoy en Madrid (todas las empresas del escenario usan esa zona).
create or replace function test.d(offset_days int) returns date language sql stable as
  $$ select (now() at time zone 'Europe/Madrid')::date + offset_days $$;
grant execute on function test.d(int) to public;
-- Ids generados por el servidor: se buscan por código o nombre (con la RLS de quien consulta).
create or replace function test.tpl(p_code text) returns uuid language sql stable as
  $$ select id from public.shift_templates where code = p_code $$;
create or replace function test.cal() returns uuid language sql stable as
  $$ select id from public.holiday_calendars where name = 'Calendario de pruebas' $$;
grant execute on function test.tpl(text), test.cal() to public;
-- Atajos con argumentos posicionales (las funciones reales usan parámetros con nombre).
create or replace function test.save_assignment(p_id uuid, p_scope public.shift_assignment_scope,
  p_employee uuid, p_team uuid, p_terms uuid, p_valid_from date, p_valid_to date, p_cycle_days smallint,
  p_anchor date, p_days uuid[], p_note text default null)
returns uuid language sql as $$
  select public.save_shift_assignment(p_scope => p_scope, p_valid_from => p_valid_from,
    p_cycle_days => p_cycle_days, p_days => p_days, p_id => p_id, p_employee => p_employee,
    p_team => p_team, p_terms => p_terms, p_valid_to => p_valid_to, p_anchor => p_anchor, p_note => p_note)
$$;
create or replace function test.save_draft(p_template uuid, p_kind public.shift_kind, p_target integer,
  p_early integer, p_late integer, p_flex_start integer, p_flex_end integer, p_segments jsonb)
returns uuid language sql as $$
  select public.save_shift_template_draft(p_template => p_template, p_kind => p_kind,
    p_target_minutes => p_target, p_tolerance_early => p_early, p_tolerance_late => p_late,
    p_segments => p_segments, p_flex_start => p_flex_start, p_flex_end => p_flex_end)
$$;
grant execute on function test.save_assignment(uuid, public.shift_assignment_scope, uuid, uuid, uuid, date, date,
  smallint, date, uuid[], text), test.save_draft(uuid, public.shift_kind, integer, integer, integer, integer,
  integer, jsonb) to public;

-- e99 (sin cuenta) pasa al equipo AT1 junto con E1.
update public.employees set team_id = test.team('AT1') where id = test.e(99);

-- Historia: plantilla M publicada hace 30 días (08:00-15:00) y plantilla sin
-- versión publicada. Se insertan como servicio para simular el pasado.
insert into public.shift_templates (id, company_id, code, name) values
  ('5f000000-0000-0000-0000-0000000000a1', test.co('A'), 'M', 'Mañana'),
  ('5f000000-0000-0000-0000-0000000000a2', test.co('A'), 'SINV', 'Sin versión'),
  ('5f000000-0000-0000-0000-0000000000b1', test.co('B'), 'MB', 'Mañana B');
insert into public.shift_template_versions (id, company_id, template_id, version, kind, target_minutes)
values ('5e000000-0000-0000-0000-0000000000a1', test.co('A'), '5f000000-0000-0000-0000-0000000000a1', 1,
  'continuous', 420);
insert into public.shift_template_segments (company_id, version_id, position, start_minute, end_minute)
values (test.co('A'), '5e000000-0000-0000-0000-0000000000a1', 1, 480, 900);
update public.shift_template_versions
set status = 'published', valid_from = test.d(-30), published_at = now() - interval '30 days'
where id = '5e000000-0000-0000-0000-0000000000a1';

-- Asignación publicada que empezó hace 10 días (para probar que no se reescribe el pasado).
insert into public.shift_assignments (id, company_id, scope_type, employee_id, valid_from, anchor_date,
  cycle_days)
values ('5a000000-0000-0000-0000-000000000001', test.co('A'), 'employee', test.e(14), test.d(-10),
  test.d(-10), 1);
insert into public.shift_assignment_days (assignment_id, company_id, day_index, template_id)
values ('5a000000-0000-0000-0000-000000000001', test.co('A'), 0, '5f000000-0000-0000-0000-0000000000a1');
update public.shift_assignments set status = 'published', published_at = now() - interval '10 days'
where id = '5a000000-0000-0000-0000-000000000001';

select test.fails($$update public.shift_template_segments set end_minute = 960
  where version_id = '5e000000-0000-0000-0000-0000000000a1'$$,
  'Servicio: ni siquiera sin RLS se modifican los tramos de una versión publicada', 'publicada');
select test.fails($$update public.shift_template_versions set target_minutes = 480
  where id = '5e000000-0000-0000-0000-0000000000a1'$$,
  'Servicio: una versión publicada no se modifica', 'versión nueva');
select test.fails($$update public.shift_template_versions set valid_to = test.d(-5)
  where id = '5e000000-0000-0000-0000-0000000000a1'$$,
  'Servicio: no se cierra una versión con efecto en el pasado', 'pasado');
select test.fails($$delete from public.shift_template_versions
  where id = '5e000000-0000-0000-0000-0000000000a1'$$,
  'Servicio: una versión publicada no se borra', 'no se puede borrar');
select test.fails($$update public.companies set timezone = 'Madrid/Centro' where id = test.co('A')$$,
  'Zona horaria: solo nombres IANA conocidos', 'companies_timezone_check');
select test.fails($$update public.work_centers set timezone = 'UTC+1' where id = test.wc('A1')$$,
  'Zona horaria: también en los centros', 'work_centers_timezone_check');

set role authenticated;

-- -----------------------------------------------------------------------------
-- Accesos (para la interfaz)
-- -----------------------------------------------------------------------------
select test.act_as(test.u(4));
select test.ok((select count(*) from public.my_schedule_access(test.co('A'))
  where action = 'manage' and scope_type = 'company') = 1, 'HR: gestiona horarios de toda la empresa');
select test.act_as(test.u(5));
select test.ok((select bool_and(scope_type = 'work_center' and work_center_id = test.wc('A2'))
  from public.my_schedule_access(test.co('A'))), 'HRW: su acceso a horarios se limita al centro A2');
select test.act_as(test.u(10));
select test.ok((select array_agg(action) from public.my_schedule_access(test.co('A'))) = array['read'],
  'AUD: solo lectura de horarios');
select test.act_as(test.u(6));
select test.ok(not exists (select 1 from public.my_schedule_access(test.co('A'))),
  'MGR: sin permisos de empresa (ve a sus supervisados por asignación)');
select test.act_as(test.u(14));
select test.ok(not exists (select 1 from public.my_schedule_access(test.co('A'))),
  'EXP: con la membresía caducada su rol de RR. HH. no cuenta');
select test.act_as(test.u(19));
select test.ok(not exists (select 1 from public.my_schedule_access(test.co('A'))),
  'RFUT: un rol con vigencia futura aún no da acceso');

-- -----------------------------------------------------------------------------
-- Calendarios y festivos
-- -----------------------------------------------------------------------------
select test.act_as(test.u(4));
select test.fails($$insert into public.holiday_calendars (company_id, name, scope)
  values (test.co('A'), 'Sin fuente', 'company')$$,
  'Calendario: la fuente es obligatoria', 'source_reference');
insert into public.holiday_calendars (company_id, name, scope, region_code, source_reference)
values (test.co('A'), 'Calendario de pruebas', 'company', null,
  'Acuerdo sintético de pruebas');
select test.ok(exists (select 1 from public.holiday_calendars where name = 'Calendario de pruebas'),
  'Calendario: RR. HH. crea un calendario con su fuente');
select test.fails($$insert into public.holidays (company_id, calendar_id, holiday_date, name)
  values (test.co('A'), test.cal(), test.d(-3), 'Pasado')$$,
  'Festivo: no se registran en fechas pasadas', 'fechas pasadas');
insert into public.holidays (company_id, calendar_id, holiday_date, name)
values (test.co('A'), test.cal(), test.d(20), 'Festivo sintético');
select test.fails($$insert into public.work_center_holiday_calendars (company_id, work_center_id, calendar_id, valid_from)
  values (test.co('A'), test.wc('A1'), test.cal(), test.d(-1))$$,
  'Calendario: no se aplica a un centro con efecto pasado', 'hoy o una fecha futura');
insert into public.work_center_holiday_calendars (company_id, work_center_id, calendar_id, valid_from)
values (test.co('A'), test.wc('A1'), test.cal(), test.d(0));
select test.fails($$insert into public.work_center_holiday_calendars (company_id, work_center_id, calendar_id, valid_from)
  values (test.co('A'), test.wc('A1'), test.cal(), test.d(5))$$,
  'Calendario: no se aplica dos veces al mismo centro en fechas solapadas',
  'work_center_holiday_calendars_excl');
select test.fails($$insert into public.work_center_holiday_calendars (company_id, work_center_id, calendar_id, valid_from)
  values (test.co('A'), test.wc('B1'), test.cal(), test.d(0))$$,
  'Calendario: no se enlaza con un centro de otra empresa', 'violates');

select test.act_as(test.u(5));
select test.fails($$insert into public.holiday_calendars (company_id, name, scope, source_reference)
  values (test.co('A'), 'De centro', 'local', 'Fuente')$$,
  'HRW: los calendarios son de empresa; RR. HH. de centro no los crea', 'row-level security');
select test.act_as(test.u(7));
select test.ok((select count(*) from public.holidays) = 1, 'E1: ve los festivos de su empresa');
select test.fails($$insert into public.holidays (company_id, calendar_id, holiday_date, name)
  values (test.co('A'), test.cal(), test.d(30), 'Por mi cuenta')$$,
  'E1: no registra festivos', 'row-level security');
select test.act_as(test.u(11));
select test.ok(not exists (select 1 from public.holiday_calendars), 'EB: no ve calendarios de otra empresa');
select test.ok(not exists (select 1 from public.holidays), 'EB: no ve festivos de otra empresa');
select test.act_as(test.u(12));
select test.fails($$insert into public.holidays (company_id, calendar_id, holiday_date, name)
  values (test.co('A'), test.cal(), test.d(30), 'Ajeno')$$,
  'CB: no registra festivos en otra empresa', 'row-level security');
select test.act_as(test.u(14));
select test.ok(not exists (select 1 from public.holiday_calendars), 'EXP: con la membresía caducada no ve calendarios');
select test.fails($$insert into public.holiday_calendars (company_id, name, scope, source_reference)
  values (test.co('A'), 'Caducado', 'company', 'Fuente')$$,
  'EXP: ni los crea', 'row-level security');

-- -----------------------------------------------------------------------------
-- Plantillas: validación y versionado
-- -----------------------------------------------------------------------------
select test.act_as(test.u(7));
select test.fails($$insert into public.shift_templates (company_id, code, name) values (test.co('A'), 'X', 'Mía')$$,
  'E1: no crea plantillas', 'row-level security');
select test.fails($$select test.save_draft('5f000000-0000-0000-0000-0000000000a1',
  'continuous', 420, 0, 0, null, null, '[]'::jsonb)$$, 'E1: no edita plantillas', 'no encontrada');
select test.ok(not exists (select 1 from public.shift_template_versions where status = 'draft'),
  'E1: no ve borradores');
select test.ok(exists (select 1 from public.shift_template_segments), 'E1: ve los tramos publicados');
select test.act_as(test.u(12));
select test.ok((select count(*) from public.shift_templates) = 1, 'CB: solo ve las plantillas de su empresa');
select test.fails($$select test.save_draft('5f000000-0000-0000-0000-0000000000a1',
  'continuous', 420, 0, 0, null, null, '[]'::jsonb)$$, 'CB: no edita plantillas de otra empresa', 'no encontrada');

select test.act_as(test.u(4));
insert into public.shift_templates (company_id, code, name) values
  (test.co('A'), 'N', 'Noche'), (test.co('A'), 'P', 'Partida'), (test.co('A'), 'F', 'Flexible');
select test.fails($$insert into public.shift_templates (company_id, code, name) values (test.co('A'), 'N', 'Otra')$$,
  'Plantilla: el código es único en la empresa', 'shift_templates_company_id_code_key');

-- Horas objetivo que no cuadran con los tramos.
select test.save_draft(test.tpl('N'), 'night', 450, 0, 0, null, null,
  '[{"start_minute": 1320, "end_minute": 1800, "kind": "work"}]'::jsonb);
select test.fails($$select public.publish_shift_template_version(
  (select id from public.shift_template_versions where template_id = test.tpl('N')),
  test.d(1))$$, 'Plantilla: las horas objetivo deben cuadrar con los tramos', 'no coinciden');
-- Noche de 22:00 a 06:00 con pausa no retribuida de 30 min: 450 min.
select test.save_draft(test.tpl('N'), 'night', 450, 5, 10, null, null,
  '[{"start_minute": 1320, "end_minute": 1560, "kind": "work"},
    {"start_minute": 1560, "end_minute": 1590, "kind": "break", "paid": false},
    {"start_minute": 1590, "end_minute": 1800, "kind": "work"}]'::jsonb);
select test.ok((select count(*) from public.shift_template_versions
  where template_id = test.tpl('N')) = 1, 'Plantilla: guardar de nuevo reutiliza el borrador');
select test.ok((select public.publish_shift_template_version(
  (select id from public.shift_template_versions where template_id = test.tpl('N')),
  test.d(1))) = 0, 'Plantilla: una jornada nocturna que cruza la medianoche es válida');

select test.save_draft(test.tpl('P'), 'split', 480, 0, 0, null, null,
  '[{"start_minute": 540, "end_minute": 1020, "kind": "work"}]'::jsonb);
select test.fails($$select public.publish_shift_template_version(
  (select id from public.shift_template_versions where template_id = test.tpl('P')),
  test.d(1))$$, 'Plantilla: una partida necesita dos tramos con hueco', 'partida');
select test.save_draft(test.tpl('P'), 'split', 480, 0, 0, null, null,
  '[{"start_minute": 540, "end_minute": 840, "kind": "work"},
    {"start_minute": 800, "end_minute": 1080, "kind": "work"}]'::jsonb);
select test.fails($$select public.publish_shift_template_version(
  (select id from public.shift_template_versions where template_id = test.tpl('P')),
  test.d(1))$$, 'Plantilla: los tramos no se solapan', 'solapan');
select test.save_draft(test.tpl('P'), 'split', 480, 0, 0, null, null,
  '[{"start_minute": 540, "end_minute": 840, "kind": "work"},
    {"start_minute": 960, "end_minute": 1140, "kind": "work"}]'::jsonb);
select test.fails($$select public.publish_shift_template_version(
  (select id from public.shift_template_versions where template_id = test.tpl('P')),
  test.d(-1))$$, 'Plantilla: no se publica con efecto en el pasado', 'hoy o una fecha futura');
select public.publish_shift_template_version(
  (select id from public.shift_template_versions where template_id = test.tpl('P')),
  test.d(0));

select test.save_draft(test.tpl('F'), 'flexible', 480, 0, 0, 420, 1200,
  '[{"start_minute": 600, "end_minute": 840, "kind": "work"}]'::jsonb);
select test.ok((select public.publish_shift_template_version(
  (select id from public.shift_template_versions where template_id = test.tpl('F')),
  test.d(0))) = 0, 'Plantilla: flexible con presencia obligatoria dentro de la ventana');
select test.fails($$select test.save_draft(test.tpl('F'),
  'flexible', 480, 0, 0, null, null, '[]'::jsonb)$$,
  'Plantilla: la flexible necesita ventana', 'shift_template_versions_flex_check');

select test.fails($$insert into public.shift_template_versions (company_id, template_id, version, kind, target_minutes)
  values (test.co('A'), '5f000000-0000-0000-0000-0000000000a1', 9, 'continuous', 60)$$,
  'Versiones: solo se crean mediante la función (sin privilegio directo)', 'permission denied');

select test.act_as(test.u(5));
select test.fails($$select test.save_draft('5f000000-0000-0000-0000-0000000000a1',
  'continuous', 420, 0, 0, null, null, '[{"start_minute": 540, "end_minute": 960, "kind": "work"}]'::jsonb)$$,
  'HRW: las plantillas son de empresa; RR. HH. de centro no las edita', 'no encontrada');

-- -----------------------------------------------------------------------------
-- Asignaciones: borrador, conflictos, publicación y eventos
-- -----------------------------------------------------------------------------
select test.act_as(test.u(4));
select test.save_assignment(null, 'employee', test.e(7), null, null, test.d(2), null, 7::smallint,
  test.d(2), array['5f000000-0000-0000-0000-0000000000a1', '5f000000-0000-0000-0000-0000000000a1',
    '5f000000-0000-0000-0000-0000000000a1', '5f000000-0000-0000-0000-0000000000a1',
    '5f000000-0000-0000-0000-0000000000a1', null, null]::uuid[], 'Semana de mañana') as emp_assignment
\gset
select test.fails($$select test.save_assignment(null, 'employee', test.e(7), null, null, test.d(-1),
  null, 1::smallint, null, array['5f000000-0000-0000-0000-0000000000a1']::uuid[])$$,
  'Asignación: no empieza en el pasado', 'fecha futura');
select test.fails($$select test.save_assignment(null, 'employee', test.e(7), null, null, test.d(2),
  null, 7::smallint, null, array['5f000000-0000-0000-0000-0000000000a1']::uuid[])$$,
  'Asignación: indica cada día del ciclo', '7 días del ciclo');
select test.fails($$select test.save_assignment(null, 'employee', test.e(7), null, null, test.d(2),
  null, 1::smallint, null, array['5f000000-0000-0000-0000-0000000000b1']::uuid[])$$,
  'Asignación: no usa plantillas de otra empresa', 'violates foreign key');
select test.fails($$insert into public.shift_assignments (company_id, scope_type, employee_id, valid_from, anchor_date)
  values (test.co('A'), 'employee', test.e(7), test.d(2), test.d(2))$$,
  'Asignación: sin escritura directa (solo mediante funciones)', 'permission denied');
select test.ok(not exists (select 1 from public.shift_assignment_conflicts(:'emp_assignment')),
  'Conflictos: una asignación limpia no tiene ninguno');

select test.act_as(test.u(7));
select test.ok(not exists (select 1 from public.shift_assignments where id = :'emp_assignment'),
  'E1: no ve los borradores de su horario');
select test.act_as(test.u(6));
select test.ok(not exists (select 1 from public.shift_assignments where id = :'emp_assignment'),
  'MGR: tampoco ve borradores');
select test.fails($$select public.publish_shift_assignment('$$ || :'emp_assignment' || $$')$$,
  'MGR: no publica horarios', 'no encontrada');

select test.act_as(test.u(4));
select test.ok(public.publish_shift_assignment(:'emp_assignment') = 1, 'Publicar: notifica a la persona');
select test.ok((select published_by from public.shift_assignments where id = :'emp_assignment') = test.u(4),
  'Publicar: registra quién publica');
reset role;
select test.ok(exists (select 1 from public.audit_events where entity = 'shift_assignments'
  and entity_id = :'emp_assignment' and action = 'publish' and actor_id = test.u(4)),
  'Auditoría: la publicación queda registrada como tal');
set role authenticated;
select test.fails($$select public.publish_shift_assignment('$$ || :'emp_assignment' || $$')$$,
  'Publicar: no se publica dos veces', 'borradores');
select test.fails($$select test.save_assignment('$$ || :'emp_assignment' || $$', 'employee', test.e(7),
  null, null, test.d(3), null, 1::smallint, null, array[null]::uuid[])$$,
  'Asignación publicada: no se edita (se cierra y se crea otra)', 'borradores');

-- Solape en el mismo nivel.
select test.save_assignment(null, 'employee', test.e(7), null, null, test.d(9), null, 1::smallint,
  null, array[test.tpl('N')]::uuid[]) as overlap_assignment
\gset
select test.ok((select code from public.shift_assignment_conflicts(:'overlap_assignment')) = 'OVERLAP',
  'Conflictos: detecta el solape con un horario publicado del mismo nivel');
select test.fails($$select public.publish_shift_assignment('$$ || :'overlap_assignment' || $$', true)$$,
  'Conflictos: un solape impide publicar aunque se acepten avisos', 'impiden publicar');

-- Plantilla sin versión publicada.
select test.save_assignment(null, 'contract', null, null, 'f0000000-0000-0000-0000-000000000007',
  test.d(2), test.d(30), 1::smallint, null, array['5f000000-0000-0000-0000-0000000000a2']::uuid[])
  as contract_assignment
\gset
select test.ok((select code from public.shift_assignment_conflicts(:'contract_assignment')) = 'TEMPLATE_WITHOUT_VERSION',
  'Conflictos: detecta plantillas sin versión vigente');
select test.ok((select employee_id from public.shift_assignments where id = :'contract_assignment') = test.e(7),
  'Asignación por contrato: la persona sale de las condiciones, no del formulario');
select test.save_assignment(:'contract_assignment', 'contract', null, null,
  'f0000000-0000-0000-0000-000000000007', test.d(2), test.d(30), 1::smallint, null,
  array['5f000000-0000-0000-0000-0000000000a1']::uuid[]);
select test.ok(public.publish_shift_assignment(:'contract_assignment') = 1,
  'Asignación por contrato: corregida, se publica (nivel distinto del individual)');

-- Ausencia aprobada en un día con turno: aviso que exige confirmación.
reset role;
insert into public.leave_periods (company_id, employee_id, starts_on, ends_on)
values (test.co('A'), test.e(7), test.d(4), test.d(4));
set role authenticated;
select test.act_as(test.u(4));
select test.save_assignment(null, 'exception', test.e(7), null, null, test.d(3), test.d(6),
  1::smallint, null, array[test.tpl('N')]::uuid[], 'Cambio puntual') as exc_assignment
\gset
select test.ok((select code || ':' || days || ':' || employee_code
  from public.shift_assignment_conflicts(:'exc_assignment')) = 'ABSENCE:1:A-007',
  'Conflictos: explica la ausencia aprobada (código de empleado, días)');
select test.fails($$select public.publish_shift_assignment('$$ || :'exc_assignment' || $$')$$,
  'Conflictos: los avisos exigen confirmación', 'confirma');
select test.ok(public.publish_shift_assignment(:'exc_assignment', true) = 1,
  'Conflictos: con la confirmación se publica');
select test.fails($$select test.save_assignment(null, 'exception', test.e(7), null, null, test.d(2),
  test.d(40), 1::smallint, null, array[null]::uuid[])$$,
  'Excepción: como mucho 31 días', 'shift_assignments_exception_check');

-- Sin condiciones vigentes (e99) y equipo.
select test.save_assignment(null, 'team', null, test.team('AT1'), null, test.d(2), null, 1::smallint,
  null, array[test.tpl('F')]::uuid[]) as team_assignment
\gset
select test.ok(exists (select 1 from public.shift_assignment_conflicts(:'team_assignment')
  where code = 'NO_CONTRACT' and employee_code = 'A-099' and severity = 'warning'),
  'Conflictos: detecta personas sin condiciones de empleo vigentes');
select test.ok(exists (select 1 from public.shift_assignment_conflicts(:'team_assignment')
  where code = 'ABSENCE' and employee_code = 'A-007'), 'Conflictos: en un equipo, por cada persona');
select test.ok(public.publish_shift_assignment(:'team_assignment', true) = 2,
  'Equipo: se notifica a cada persona del equipo');

-- RR. HH. de centro: solo su ámbito; baja posterior.
select test.act_as(test.u(5));
select test.fails($$select test.save_assignment(null, 'employee', test.e(7), null, null, test.d(2), null,
  1::smallint, null, array[null]::uuid[])$$, 'HRW: no asigna fuera de su centro', 'sin permiso');
select test.fails($$select test.save_assignment(null, 'team', null, test.team('AT1'), null, test.d(2), null,
  1::smallint, null, array[null]::uuid[])$$, 'HRW: ni a equipos de otro centro', 'sin permiso');
select test.save_assignment(null, 'employee', test.e(8), null, null, test.d(2), null, 1::smallint,
  null, array['5f000000-0000-0000-0000-0000000000a1']::uuid[]) as e2_assignment
\gset
select test.ok(exists (select 1 from public.shift_assignments where id = :'e2_assignment'),
  'HRW: asigna a personas de su centro');
select test.act_as(test.u(4));
select public.terminate_employee(test.e(8), test.d(5));
select test.ok((select code || ':' || first_day::text from public.shift_assignment_conflicts(:'e2_assignment'))
  = 'AFTER_TERMINATION:' || test.d(6)::text, 'Conflictos: detecta días posteriores a la baja');

-- Otra empresa y membresía caducada.
select test.act_as(test.u(12));
select test.fails($$select test.save_assignment(null, 'employee', test.e(7), null, null, test.d(2), null,
  1::smallint, null, array[null]::uuid[])$$, 'CB: no asigna en otra empresa', 'sin permiso');
select test.fails($$select * from public.shift_assignment_conflicts('$$ || :'emp_assignment' || $$')$$,
  'CB: ni consulta conflictos de otra empresa', 'no encontrada');
select test.ok(not exists (select 1 from public.shift_assignments), 'CB: no ve asignaciones de otra empresa');
select test.act_as(test.u(14));
select test.ok(not exists (select 1 from public.shift_assignments), 'EXP: con la membresía caducada no ve asignaciones');
select test.fails($$select test.save_assignment(null, 'employee', test.e(7), null, null, test.d(2), null,
  1::smallint, null, array[null]::uuid[])$$, 'EXP: ni asigna', 'sin permiso');

-- -----------------------------------------------------------------------------
-- Visibilidad de los calendarios publicados
-- -----------------------------------------------------------------------------
select test.act_as(test.u(7));
select test.ok((select count(*) from public.shift_assignments) = 4,
  'E1: ve sus asignaciones publicadas (individual, contrato, excepción y equipo)');
select test.ok((select count(*) from public.schedule_events) = 4, 'E1: ve sus eventos de cambio');
select test.ok(exists (select 1 from public.leave_periods), 'E1: ve sus ausencias');
select test.fails($$update public.schedule_events set delivered_at = now()$$,
  'E1: los eventos no se modifican', 'permission denied');
select test.act_as(test.u(8));
select test.ok(not exists (select 1 from public.shift_assignments), 'E2: no ve horarios ajenos (ni del equipo AT1)');
select test.ok(not exists (select 1 from public.schedule_events), 'E2: no ve eventos ajenos');
select test.ok(not exists (select 1 from public.leave_periods), 'E2: no ve ausencias ajenas');
select test.act_as(test.u(6));
select test.ok((select count(*) from public.shift_assignments) = 4,
  'MGR: ve los horarios publicados de quien supervisa y de su equipo');
select test.ok(not exists (select 1 from public.shift_assignments where status = 'draft'), 'MGR: sin borradores');
select test.ok(not exists (select 1 from public.schedule_events), 'MGR: los eventos son de cada persona');
select test.act_as(test.u(10));
select test.ok(not exists (select 1 from public.shift_assignments where status = 'draft'),
  'AUD: lee horarios publicados pero no borradores');
select test.ok((select count(*) from public.shift_assignments where status = 'published') = 5,
  'AUD: ve todos los publicados de la empresa');
select test.act_as(test.u(5));
select test.ok((select count(*) from public.shift_assignments) = 1, 'HRW: solo ve lo de su centro');

-- -----------------------------------------------------------------------------
-- Sin efecto retroactivo
-- -----------------------------------------------------------------------------
select test.act_as(test.u(4));
select test.fails($$select public.close_shift_assignment('5a000000-0000-0000-0000-000000000001', test.d(-3))$$,
  'Cierre: no se acorta una asignación hacia el pasado', 'hacia el pasado');
select test.fails($$select public.close_shift_assignment('5a000000-0000-0000-0000-000000000001', test.d(-11))$$,
  'Cierre: una asignación iniciada no se revoca', 'ya iniciada');
select public.close_shift_assignment('5a000000-0000-0000-0000-000000000001', test.d(1));
select test.ok((select valid_from = test.d(-10) and valid_to = test.d(2) and status = 'published'
  from public.shift_assignments where id = '5a000000-0000-0000-0000-000000000001'),
  'Cierre: termina en la fecha indicada y conserva el pasado');
select test.ok((select count(*) from public.schedule_events
  where employee_id = test.e(14) and event_type = 'shift_assignment_changed') = 1, 'Cierre: notifica a la persona');
select public.close_shift_assignment(:'overlap_assignment', test.d(20));
select test.ok((select status from public.shift_assignments where id = :'overlap_assignment') = 'revoked',
  'Cierre: un borrador se descarta');

-- Nueva versión de la plantilla M desde dentro de 7 días.
select test.save_draft('5f000000-0000-0000-0000-0000000000a1', 'continuous', 420, 0, 0, null,
  null, '[{"start_minute": 540, "end_minute": 960, "kind": "work"}]'::jsonb);
select test.fails($$select public.publish_shift_template_version(
  (select id from public.shift_template_versions where template_id = '5f000000-0000-0000-0000-0000000000a1'
   and status = 'draft'), test.d(-30))$$,
  'Versión: no se publica sobre periodos pasados', 'hoy o una fecha futura');
select test.ok(public.publish_shift_template_version(
  (select id from public.shift_template_versions where template_id = '5f000000-0000-0000-0000-0000000000a1'
   and status = 'draft'), test.d(7)) = 1,
  'Versión: notifica a quienes tienen asignaciones vigentes con esa plantilla');
select test.ok((select valid_from = test.d(-30) and valid_to = test.d(7)
  from public.shift_template_versions where id = '5e000000-0000-0000-0000-0000000000a1'),
  'Versión: la anterior se cierra en la fecha de efecto y conserva su inicio');
select test.ok((select string_agg(start_minute || '-' || end_minute, ',') from public.shift_template_segments
  where version_id = '5e000000-0000-0000-0000-0000000000a1') = '480-900',
  'Versión: los tramos de la anterior siguen intactos (los días pasados no cambian)');
select test.ok((select count(*) from public.shift_template_versions
  where template_id = '5f000000-0000-0000-0000-0000000000a1' and status = 'published') = 2,
  'Versión: conviven dos versiones publicadas sin solaparse');

select test.act_as(test.u(7));
select test.ok((select count(*) from public.schedule_events where event_type = 'shift_template_published') = 1,
  'E1: recibe el aviso de la nueva versión una sola vez');

\echo 'Pruebas de horarios superadas.'
