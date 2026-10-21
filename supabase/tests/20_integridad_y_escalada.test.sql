-- =============================================================================
-- Integridad de datos y resistencia a escaladas de privilegios.
-- =============================================================================

\ir helpers/asserts.sql
\ir helpers/fixtures.sql

-- -----------------------------------------------------------------------------
-- Claves inmutables incluso para service_role / superusuario
-- -----------------------------------------------------------------------------
select test.fails($$update public.company_memberships set company_id = test.co('B') where id = test.m(7)$$,
  'Nadie mueve una membresía de empresa', 'no se puede modificar');
select test.fails($$update public.company_memberships set user_id = test.u(13) where id = test.m(7)$$,
  'Nadie cambia el titular de una membresía', 'no se puede modificar');
select test.fails($$update public.role_assignments set role = 'company_admin' where membership_id = test.m(7)$$,
  'Un rol concedido no se transforma en otro', 'no se puede modificar');
select test.fails($$update public.employees set company_id = test.co('B') where id = test.e(7)$$,
  'Nadie mueve una ficha de empleado de empresa', 'no se puede modificar');
select test.fails($$update public.manager_assignments set employee_id = test.e(8)
  where employee_id = test.e(7)$$, 'Una asignación de manager no cambia de empleado', 'no se puede modificar');
select test.fails($$update public.companies set group_id = test.grp(2) where id = test.co('A')$$,
  'Una empresa no cambia de grupo', 'no se puede modificar');

-- -----------------------------------------------------------------------------
-- Auditoría inmutable
-- -----------------------------------------------------------------------------
select test.ok((select count(*) from public.audit_log where table_name = 'role_assignments') >= 19,
  'Las concesiones de roles quedan auditadas');
select test.fails('update public.audit_log set action = ''DELETE''', 'La auditoría no se modifica', 'inmutable');
select test.fails('delete from public.audit_log', 'La auditoría no se borra', 'inmutable');
select test.fails('truncate public.audit_log', 'La auditoría no se vacía', 'inmutable');

-- -----------------------------------------------------------------------------
-- Restricciones de datos
-- -----------------------------------------------------------------------------
select test.fails($$insert into public.employment_terms (company_id, employee_id, contract_type,
  weekly_hours, valid_from) values (test.co('A'), test.e(7), 'temporary', 40, '2026-01-01')$$,
  'No hay dos condiciones activas solapadas', 'employment_terms_no_overlap');
insert into public.employment_terms (company_id, employee_id, contract_type, weekly_hours, valid_from, status)
values (test.co('A'), test.e(7), 'temporary', 30, '2026-01-01', 'draft');
select test.ok(true, 'Un borrador puede solaparse');
update public.employment_terms set valid_to = '2026-01-01' where id = 'f0000000-0000-0000-0000-000000000007';
insert into public.employment_terms (company_id, employee_id, contract_type, weekly_hours, valid_from)
values (test.co('A'), test.e(7), 'permanent', 35, '2026-01-01');
select test.ok(true, 'Tras cerrar unas condiciones se pueden abrir otras consecutivas');
select test.fails($$insert into public.employment_terms (company_id, employee_id, contract_type,
  weekly_hours, valid_from) values (test.co('A'), test.e(8), 'permanent', 45, '2026-01-01')$$,
  'La jornada ordinaria no supera 40 h semanales', 'check');
select test.fails($$insert into public.role_assignments (company_id, membership_id, role, scope_type, work_center_id)
  values (test.co('A'), test.m(8), 'auditor', 'company', test.wc('A1'))$$,
  'El ámbito del rol es coherente', 'role_assignments_scope_check');
select test.fails($$insert into public.role_assignments (company_id, membership_id, role, scope_type, work_center_id)
  values (test.co('A'), test.m(8), 'hr', 'work_center', test.wc('B1'))$$,
  'Un rol de A no puede tener como ámbito un centro de B', 'foreign key');
select test.fails($$insert into public.teams (company_id, work_center_id, name)
  values (test.co('A'), test.wc('B1'), 'Cruzado')$$, 'Un equipo de A no cuelga de un centro de B', 'foreign key');
select test.fails($$insert into public.company_memberships (company_id, user_id, valid_from, valid_to)
  values (test.co('B'), test.u(13), now(), now() - interval '1 day')$$, 'La vigencia es coherente', 'check');

set role authenticated;

-- -----------------------------------------------------------------------------
-- Falsificación de campos controlados por el servidor
-- -----------------------------------------------------------------------------
select test.act_as(test.u(3));
select test.fails($$insert into public.role_assignments (company_id, membership_id, role, granted_by)
  values (test.co('A'), test.m(9), 'employee', test.u(1))$$,
  'No se puede falsear quién concede un rol', 'permission denied');
select test.fails($$insert into public.manager_assignments (company_id, employee_id, manager_user_id, status)
  values (test.co('A'), test.e(99), test.u(6), 'active')$$,
  'El estado inicial no lo decide el cliente', 'permission denied');
select test.fails($$insert into public.employees (id, company_id, employee_code, first_name, last_name)
  values (test.e(11), test.co('A'), 'A-200', 'Sonda', 'Id')$$,
  'El cliente no elige ids (evita sondear ids de otras empresas)', 'permission denied');

-- Errores sin pistas sobre otras empresas: la clave foránea compuesta falla
-- antes de revelar si esa membresía de B ya tiene ficha o roles.
select test.fails($$insert into public.employees (company_id, membership_id, employee_code, first_name, last_name)
  values (test.co('A'), test.m(11), 'A-201', 'Sonda', 'Membresía')$$,
  'Vincular una membresía de B en A falla por clave foránea, no por duplicado', 'foreign key');

select test.act_as(test.u(2));
insert into public.companies (group_id, name, slug) values (test.grp(1), 'Otra C', 'empresa-c');
select test.ok(true, 'El slug es único por grupo: no revela slugs de otros grupos');

-- -----------------------------------------------------------------------------
-- Los permisos no salen de user_metadata ni de claims añadidos al JWT
-- -----------------------------------------------------------------------------
reset role;
insert into auth.users (id, email, raw_user_meta_data) values (
  '00000000-0000-0000-0000-000000000077', 'metadatos@pruebas.example',
  jsonb_build_object('role', 'company_admin', 'roles', array['company_admin'],
    'company_id', test.co('A'), 'is_global_admin', true)
);
set role authenticated;
select test.act_as('00000000-0000-0000-0000-000000000077');
select test.ok((select count(*) from public.companies) = 0, 'Declararse administrador en user_metadata no da acceso');
select test.ok((select count(*) from public.employees) = 0, 'Ni a empleados');

select set_config('request.jwt.claims', json_build_object(
  'sub', test.u(7), 'role', 'authenticated', 'company_id', test.co('B'),
  'app_metadata', json_build_object('roles', array['company_admin'], 'company_id', test.co('B'))
)::text, false);
select test.ok((select count(*) from public.employees where company_id = test.co('B')) = 0,
  'Añadir company_id o roles a los claims no amplía permisos');
reset role;

\echo 'Pruebas de integridad y escalada superadas.'
