-- =============================================================================
-- Módulo de administración: aprobadores, suplencias, bajas, auditoría
-- minimizada, importación y separación plataforma / empresa.
-- Escenario en helpers/fixtures.sql (MGR supervisa a E1; MOLD tiene una
-- asignación caducada sobre E2).
-- =============================================================================

\ir helpers/asserts.sql
\ir helpers/fixtures.sql

-- Datos adicionales: e99 pasa al equipo AT1; ficha para CA (administrador).
update public.employees set team_id = test.team('AT1') where id = test.e(99);
insert into public.employees (id, company_id, membership_id, employee_code, first_name, last_name)
values (test.e(3), test.co('A'), test.m(3), 'A-003', 'Ce', 'Admin');

set role authenticated;

-- -----------------------------------------------------------------------------
-- Separación plataforma / empresa
-- -----------------------------------------------------------------------------
select test.act_as(test.u(1));
select test.ok((select count(*) from public.companies) = 3, 'PA: ve el listado de empresas');
select test.ok((select count(*) from public.employees) = 0, 'PA: no ve empleados de las empresas');
select test.ok((select count(*) from public.company_memberships) = 0, 'PA: no ve membresías de las empresas');
select test.ok((select count(*) from public.my_company_permissions(test.co('A'))) = 0,
  'PA: no tiene permisos de empresa');
select test.ok(not exists (select 1 from public.audit_log where company_id is not null),
  'PA: no ve auditoría con datos de empresa');
select test.fails($$insert into public.companies (group_id, name, slug)
  values (test.grp(1), 'Desde plataforma', 'desde-plataforma')$$,
  'PA: las empresas las crea la administración de grupo', 'row-level security');

-- -----------------------------------------------------------------------------
-- Permisos propios (para la interfaz)
-- -----------------------------------------------------------------------------
select test.act_as(test.u(3));
select test.ok((select count(*) from public.my_company_permissions(test.co('A'))) = 11,
  'CA: tiene los 11 permisos de empresa');
select test.act_as(test.u(5));
select test.ok((select bool_and(scope_type = 'work_center' and work_center_id = test.wc('A2'))
  from public.my_company_permissions(test.co('A'))), 'HRW: sus permisos están limitados al centro A2');
select test.act_as(test.u(7));
select test.ok((select count(*) from public.my_company_permissions(test.co('A'))) = 0,
  'E1: un empleado no tiene permisos de gestión');

-- -----------------------------------------------------------------------------
-- Resolución de aprobador: precedencia y solapes
-- -----------------------------------------------------------------------------
select test.act_as(test.u(3));
select test.ok((select approver_user_id from public.resolve_approver(test.e(7), 'absences')) = test.u(6),
  'Aprobador: la asignación directa (todas) resuelve a MGR');

insert into public.manager_assignments (company_id, scope_type, team_id, request_type, manager_user_id)
values (test.co('A'), 'team', test.team('AT1'), 'all', test.u(6));
select test.ok((select approver_user_id from public.resolve_approver(test.e(99), 'expenses')) = test.u(6),
  'Aprobador: una persona sin asignación directa hereda la de su equipo');

insert into public.manager_assignments (company_id, scope_type, team_id, request_type, manager_user_id)
values (test.co('A'), 'team', test.team('AT1'), 'absences', test.u(4));
select test.ok((select approver_user_id from public.resolve_approver(test.e(7), 'absences')) = test.u(6),
  'Aprobador: persona+todas tiene prioridad sobre equipo+tipo');
select test.ok((select approver_user_id from public.resolve_approver(test.e(99), 'absences')) = test.u(4),
  'Aprobador: en el equipo, el tipo concreto tiene prioridad sobre todas');

insert into public.manager_assignments (company_id, employee_id, request_type, manager_user_id)
values (test.co('A'), test.e(7), 'absences', test.u(17));
select test.ok((select approver_user_id from public.resolve_approver(test.e(7), 'absences')) = test.u(17),
  'Aprobador: persona+tipo es la máxima prioridad');
select test.ok((select approver_user_id from public.resolve_approver(test.e(7), 'expenses')) = test.u(6),
  'Aprobador: para otro tipo sigue aplicando persona+todas');

select test.fails($$insert into public.manager_assignments (company_id, employee_id, request_type, manager_user_id)
  values (test.co('A'), test.e(7), 'all', test.u(4))$$,
  'Solape: no se admiten dos aprobadores vigentes del mismo nivel para una persona',
  'manager_assignments_employee_excl');
select test.fails($$insert into public.manager_assignments (company_id, scope_type, team_id, request_type, manager_user_id)
  values (test.co('A'), 'team', test.team('AT1'), 'all', test.u(17))$$,
  'Solape: ni para un equipo', 'manager_assignments_team_excl');
insert into public.manager_assignments (company_id, employee_id, request_type, manager_user_id, valid_from)
values (test.co('A'), test.e(8), 'all', test.u(6), now() + interval '30 days');
select test.ok(true, 'Una asignación futura no se solapa con la caducada');

select test.fails($$select * from public.resolve_approver(test.e(8), 'all')$$,
  'Sin asignación vigente: error accionable', 'APROBADOR_NO_ASIGNADO');

reset role;
update public.employees set team_id = test.team('AT1') where id = test.e(6);
insert into public.manager_assignments (company_id, employee_id, request_type, manager_user_id)
values (test.co('A'), test.e(4), 'all', test.u(14));
set role authenticated;
select test.act_as(test.u(3));
select test.fails($$select * from public.resolve_approver(test.e(6), 'all')$$,
  'Autoaprobación detectada (el manager del equipo es la propia persona)', 'APROBADOR_AUTOAPROBACION');
select test.fails($$select * from public.resolve_approver(test.e(4), 'all')$$,
  'Aprobador sin cuenta vigente: error accionable', 'APROBADOR_INACTIVO');

select test.act_as(test.u(7));
select test.ok((select approver_user_id from public.resolve_approver(test.e(7), 'expenses')) = test.u(6),
  'E1: puede consultar quién aprueba sus solicitudes');
select test.act_as(test.u(12));
select test.fails($$select * from public.resolve_approver(test.e(7), 'all')$$,
  'CB: no puede consultar el aprobador de alguien de otra empresa', 'no encontrado');

select test.act_as(test.u(5));
select test.fails($$insert into public.manager_assignments (company_id, scope_type, team_id, request_type, manager_user_id)
  values (test.co('A'), 'team', test.team('AT1'), 'expenses', test.u(6))$$,
  'HRW: no asigna managers a equipos de otro centro', 'row-level security');

select test.act_as(test.u(3));
insert into public.manager_assignments (company_id, scope_type, team_id, request_type, manager_user_id)
values (test.co('A'), 'team', test.team('AT1'), 'time_corrections', test.u(17));
select test.act_as(test.u(17));
select test.ok((select array_agg(id order by id) from public.employees)
  @> array[test.e(6), test.e(7), test.e(99)], 'MOLD: una asignación de equipo vigente da visibilidad sobre el equipo');

-- Búsqueda de personas del grupo para nombrar managers o suplentes
select test.act_as(test.u(3));
select test.ok(public.find_group_user_by_email(test.co('A'), ' USUARIO11@pruebas.example ') = test.u(11),
  'Búsqueda: encuentra por correo a alguien de otra empresa del grupo');
select test.ok(public.find_group_user_by_email(test.co('A'), 'usuario18@pruebas.example') is null,
  'Búsqueda: no encuentra a personas de otro grupo');
select test.ok((select count(*) from public.group_user_labels(test.co('A'), array[test.u(11), test.u(18)])) = 1,
  'Nombres: solo de personas del grupo');
select test.act_as(test.u(7));
select test.ok(public.find_group_user_by_email(test.co('A'), 'usuario3@pruebas.example') is null,
  'Búsqueda: un empleado no puede buscar personas');
select test.ok((select count(*) from public.group_user_labels(test.co('A'), array[test.u(3)])) = 0,
  'Nombres: un empleado no puede consultarlos');

-- -----------------------------------------------------------------------------
-- Suplencias temporales
-- -----------------------------------------------------------------------------
select test.act_as(test.u(8));
select test.ok((select count(*) from public.employees) = 1, 'E2: antes de la suplencia solo se ve a sí misma');

select test.act_as(test.u(3));
insert into public.approver_substitutions (company_id, absent_user_id, substitute_user_id, request_type,
  reason, valid_from, valid_to)
values (test.co('A'), test.u(6), test.u(8), 'expenses', 'Vacaciones del responsable',
  now() - interval '1 day', now() + interval '10 days');
select test.ok((select approver_user_id from public.resolve_approver(test.e(7), 'expenses')) = test.u(8),
  'Suplencia: el suplente aprueba el tipo indicado');
select test.ok((select approver_user_id from public.resolve_approver(test.e(99), 'all')) = test.u(6),
  'Suplencia: no afecta a otros tipos');
select test.fails($$insert into public.approver_substitutions (company_id, absent_user_id, substitute_user_id,
  request_type, reason, valid_to) values (test.co('A'), test.u(6), test.u(4), 'expenses',
  'Otra suplencia', now() + interval '5 days')$$,
  'Suplencia: no se solapan dos para el mismo aprobador y tipo', 'approver_substitutions_excl');
select test.fails($$insert into public.approver_substitutions (company_id, absent_user_id, substitute_user_id,
  reason, valid_to) values (test.co('A'), test.u(4), test.u(9), 'no', now() + interval '5 days')$$,
  'Suplencia: el motivo es obligatorio', 'check');
select test.fails($$insert into public.approver_substitutions (company_id, absent_user_id, substitute_user_id,
  reason, valid_to) values (test.co('A'), test.u(4), test.u(9), 'Excedencia larga', now() + interval '2 years')$$,
  'Suplencia: dura como máximo un año', 'check');
select test.fails($$insert into public.approver_substitutions (company_id, absent_user_id, substitute_user_id,
  reason, valid_to) values (test.co('A'), test.u(4), test.u(3), 'Me nombro a mí', now() + interval '5 days')$$,
  'Suplencia: nadie se nombra suplente a sí mismo', 'row-level security');
select test.fails($$insert into public.approver_substitutions (company_id, absent_user_id, substitute_user_id,
  reason, valid_to) values (test.co('A'), test.u(4), test.u(18), 'Suplente de otro grupo', now() + interval '5 days')$$,
  'Suplencia: el suplente debe ser del mismo grupo', 'row-level security');

select test.act_as(test.u(8));
select test.ok(exists (select 1 from public.employees where id = test.e(7)),
  'E2: como suplente vigente ve a las personas que supervisa el ausente');

-- -----------------------------------------------------------------------------
-- Cambio de condiciones con fecha de efecto
-- -----------------------------------------------------------------------------
select test.act_as(test.u(4));
select public.change_employment_terms(test.e(14), '2026-12-01', 'permanent', 'part_time', 30, 'Técnico senior');
select test.ok((select valid_to from public.employment_terms where id = 'f0000000-0000-0000-0000-000000000014')
  = '2026-12-01', 'Cambio con fecha de efecto: cierra las condiciones vigentes ese día');
select test.ok((select count(*) from public.employment_terms where employee_id = test.e(14)
  and valid_from = '2026-12-01' and weekly_hours = 30 and status = 'active') = 1,
  'Cambio con fecha de efecto: abre las nuevas desde ese día');
select test.fails($$select public.change_employment_terms(test.e(14), '2026-11-15', 'permanent', 'full_time', 40)$$,
  'Cambio con fecha de efecto: no se cuela antes de otro ya programado', 'Ya hay condiciones');
select test.ok((select count(*) from public.employment_terms where employee_id = test.e(14)) = 2,
  'Cambio con fecha de efecto: si falla no deja nada a medias');
select test.act_as(test.u(5));
select test.fails($$select public.change_employment_terms(test.e(7), '2027-01-01', 'permanent', 'full_time', 40)$$,
  'Cambio con fecha de efecto: RR. HH. de otro centro ni siquiera ve a la persona', 'no encontrado');

-- -----------------------------------------------------------------------------
-- Bajas con fecha efectiva y reactivación
-- -----------------------------------------------------------------------------
select test.act_as(test.u(4));
select public.terminate_employee(test.e(7), current_date + 10);
select test.ok((select end_date from public.employees where id = test.e(7)) = current_date + 10,
  'Baja: se registra el último día');
select test.ok((select valid_to from public.employment_terms where id = 'f0000000-0000-0000-0000-000000000007')
  = current_date + 11, 'Baja: las condiciones se cierran el día siguiente');
select test.ok((select bool_and(valid_to = ((current_date + 11)::timestamp at time zone 'Europe/Madrid'))
  from public.manager_assignments where employee_id = test.e(7) and status = 'active'),
  'Baja: las asignaciones de la persona terminan en la fecha efectiva');
select test.ok((select count(*) from public.employees where id = test.e(7)) = 1, 'Baja: la ficha se conserva');
select test.fails($$insert into public.employment_terms (company_id, employee_id, contract_type, weekly_hours,
  valid_from) values (test.co('A'), test.e(7), 'temporary', 20, current_date + 20)$$,
  'Baja: bloquea condiciones posteriores', 'causa baja');
select test.fails($$insert into public.manager_assignments (company_id, employee_id, request_type, manager_user_id)
  values (test.co('A'), test.e(7), 'time_corrections', test.u(17))$$,
  'Baja: bloquea asignaciones que pasen de la fecha efectiva', 'causa baja');
select test.fails($$select public.terminate_employee(test.e(7), current_date + 15)$$,
  'Baja: no se registra dos veces', 'ya tiene una baja');
select test.fails($$select public.terminate_employee(test.e(3), current_date)$$,
  'Baja: RR. HH. no da de baja a un administrador de empresa', 'Solo la administración');
select test.fails($$select public.terminate_employee(test.e(4), current_date)$$,
  'Baja: nadie tramita su propia baja', 'propia baja');

select test.act_as(test.u(7));
select test.ok((select count(*) from public.companies) = 1, 'E1: hasta su último día conserva el acceso');

select test.act_as(test.u(4));
select public.terminate_employee(test.e(8), current_date - 1);
select test.act_as(test.u(8));
select test.ok((select count(*) from public.companies) = 0, 'E2: con la baja ya efectiva pierde el acceso');
select test.fails($$select public.terminate_employee(test.e(8), current_date)$$,
  'E2: con la cuenta caducada ya no tiene ningún permiso', 'no encontrado');

select test.act_as(test.u(3));
select test.ok((select approver_user_id from public.resolve_approver(test.e(7), 'expenses')) = test.u(6),
  'Al dar de baja a la suplente, la aprobación vuelve al manager');
select test.fails($$select * from public.resolve_approver(test.e(7), 'all', now() + interval '20 days')$$,
  'Tras la baja no se resuelven aprobadores para nuevas solicitudes', 'APROBADOR_EMPLEADO_DE_BAJA');

select test.act_as(test.u(12));
select test.fails($$select public.terminate_employee(test.e(7), current_date)$$,
  'CB: no puede dar de baja a alguien de otra empresa', 'no encontrado');
select test.fails('delete from public.employees', 'Nadie borra fichas desde la API', 'permission denied');

select test.act_as(test.u(4));
select public.reactivate_employee(test.e(8));
select test.act_as(test.u(8));
select test.ok((select count(*) from public.companies) = 1, 'Reactivación: E2 recupera el acceso');

-- -----------------------------------------------------------------------------
-- Auditoría minimizada
-- -----------------------------------------------------------------------------
select test.act_as(test.u(4));
update public.employees set last_name = 'ApellidoSecreto' where id = test.e(99);
select test.act_as(test.u(3));
update public.work_centers set status = 'inactive' where id = test.wc('A2');

select test.act_as(test.u(10));
select test.ok(exists (select 1 from public.audit_events where entity = 'employees'
  and entity_id = test.e(99)::text and action = 'update' and changed_fields = '{last_name}'
  and actor_id = test.u(4)), 'Auditoría: registra qué cambió y quién');
select test.ok(not exists (select 1 from public.audit_events
  where before::text like '%Ejemplo%' or after::text like '%ApellidoSecreto%'),
  'Auditoría: no guarda los valores personales');
select test.ok(exists (select 1 from public.audit_events where entity = 'work_centers'
  and action = 'deactivate'), 'Auditoría: distingue desactivaciones');
select test.ok(exists (select 1 from public.audit_events where entity = 'employees'
  and entity_id = test.e(7)::text and action = 'terminate'), 'Auditoría: registra las bajas');
select test.ok(exists (select 1 from public.audit_events where entity = 'approver_substitutions'
  and action = 'create' and after ->> 'reason' = '[dato personal]'), 'Auditoría: registra suplencias sin el motivo');
select test.ok(not exists (select 1 from public.audit_events where company_id is distinct from test.co('A')),
  'Auditoría: el auditor solo ve su empresa');
select test.fails('update public.audit_events set action = ''create''', 'Auditoría: inmutable', 'permission denied');

select test.act_as(test.u(7));
select test.ok((select count(*) from public.audit_events) = 0, 'E1: no ve la auditoría');

select test.act_as(test.u(9));
select public.log_admin_event(test.co('A'), 'export', 'employees', 7,
  '{"status": "active", "q": "texto personal"}'::jsonb);
select test.act_as(test.u(10));
select test.ok(exists (select 1 from public.audit_events where action = 'export' and actor_id = test.u(9)
  and after -> 'filters' = '{"status": "active"}'::jsonb), 'Exportación: se registra sin el texto buscado');
select test.act_as(test.u(7));
select test.fails($$select public.log_admin_event(test.co('A'), 'export', 'employees', 1)$$,
  'Exportación: quien no puede leer empleados no exporta', 'Sin permiso');
select test.act_as(test.u(3));
select test.fails($$select public.log_admin_event(test.co('A'), 'delete', 'employees', 1)$$,
  'Solo se registran exportaciones e importaciones', 'no admitido');

-- -----------------------------------------------------------------------------
-- Importación atómica
-- -----------------------------------------------------------------------------
select test.act_as(test.u(3));
select test.ok(public.import_employees(test.co('A'), '[
  {"employee_code": "IMP-1", "first_name": "Imp", "last_name": "Uno", "work_center_code": "A1",
   "team_name": "Equipo AT1", "contract_type": "permanent", "weekly_hours": "40", "valid_from": "2026-11-01"},
  {"employee_code": "IMP-2", "first_name": "Imp", "last_name": "Dos"}
]'::jsonb) = 2, 'Importación: inserta todas las filas válidas');
select test.ok((select count(*) from public.employment_terms t join public.employees e on e.id = t.employee_id
  where e.employee_code = 'IMP-1') = 1, 'Importación: crea las condiciones iniciales');

select test.fails($$select public.import_employees(test.co('A'), '[
  {"employee_code": "IMP-3", "first_name": "Imp", "last_name": "Tres"},
  {"employee_code": "IMP-4", "first_name": "Imp", "last_name": "Cuatro", "work_center_code": "ZZ"}
]'::jsonb)$$, 'Importación: informa de la fila que falla', 'Fila 2: el centro ZZ no existe');
select test.ok(not exists (select 1 from public.employees where employee_code = 'IMP-3'),
  'Importación: si una fila falla no se escribe ninguna');
select test.fails($$select public.import_employees(test.co('A'), '[
  {"employee_code": "IMP-5", "first_name": "Imp", "last_name": "Cinco"},
  {"employee_code": "IMP-1", "first_name": "Imp", "last_name": "Duplicado"}
]'::jsonb)$$, 'Importación: detecta códigos duplicados', 'Fila 2');
select test.ok(not exists (select 1 from public.employees where employee_code = 'IMP-5'),
  'Importación: tampoco escribe nada ante un duplicado');

select test.act_as(test.u(5));
select test.fails($$select public.import_employees(test.co('A'), '[
  {"employee_code": "IMP-6", "first_name": "Fuera", "last_name": "Ámbito", "work_center_code": "A1"}
]'::jsonb)$$, 'Importación: RR. HH. de centro no importa fuera de su ámbito', 'row-level security');
select test.act_as(test.u(12));
select test.fails($$select public.import_employees(test.co('A'), '[
  {"employee_code": "IMP-7", "first_name": "Otra", "last_name": "Empresa"}
]'::jsonb)$$, 'Importación: no se puede importar en otra empresa', 'row-level security');
select test.act_as(test.u(7));
select test.fails($$select public.import_employees(test.co('A'), '[
  {"employee_code": "IMP-8", "first_name": "Sin", "last_name": "Permiso"}
]'::jsonb)$$, 'Importación: un empleado no importa', 'row-level security');
reset role;

\echo 'Pruebas del módulo de administración superadas.'
