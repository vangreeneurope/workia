-- =============================================================================
-- Aislamiento multiempresa: qué ve y qué puede hacer cada actor.
-- Escenario en helpers/fixtures.sql. Cada archivo corre en una base nueva.
-- =============================================================================

\ir helpers/asserts.sql
\ir helpers/fixtures.sql

-- -----------------------------------------------------------------------------
-- anon: ningún acceso
-- -----------------------------------------------------------------------------
set role anon;
select test.fails(format('select * from public.%I', t), 'anon no puede leer ' || t, 'permission denied')
from unnest(array['groups', 'group_admins', 'companies', 'profiles', 'company_memberships',
  'role_assignments', 'work_centers', 'teams', 'employees', 'employment_terms',
  'manager_assignments', 'audit_log']) as t;
reset role;

set role authenticated;

-- -----------------------------------------------------------------------------
-- Usuario sin membresía (X)
-- -----------------------------------------------------------------------------
select test.act_as(test.u(13));
select test.ok((select count(*) from public.groups) = 0, 'X: no ve grupos');
select test.ok((select count(*) from public.companies) = 0, 'X: no ve empresas');
select test.ok((select count(*) from public.work_centers) = 0, 'X: no ve centros');
select test.ok((select count(*) from public.teams) = 0, 'X: no ve equipos');
select test.ok((select count(*) from public.company_memberships) = 0, 'X: no ve membresías');
select test.ok((select count(*) from public.role_assignments) = 0, 'X: no ve roles');
select test.ok((select count(*) from public.employees) = 0, 'X: no ve empleados');
select test.ok((select count(*) from public.employment_terms) = 0, 'X: no ve condiciones');
select test.ok((select count(*) from public.manager_assignments) = 0, 'X: no ve asignaciones');
select test.ok((select count(*) from public.audit_log) = 0, 'X: no ve auditoría');
select test.ok((select count(*) from storage.objects) = 0, 'X: no ve logotipos');
select test.ok((select count(*) from public.profiles) = 1, 'X: solo ve su perfil');
select test.fails($$insert into public.company_memberships (company_id, user_id)
  values (test.co('A'), test.u(13))$$, 'X: no puede crear su propia membresía', 'row-level security');

-- -----------------------------------------------------------------------------
-- Propio registro (E1, empleado de A)
-- -----------------------------------------------------------------------------
select test.act_as(test.u(7));
select test.ok((select array_agg(id) from public.employees) = array[test.e(7)], 'E1: solo ve su ficha');
select test.ok((select array_agg(id) from public.employment_terms)
  = array['f0000000-0000-0000-0000-000000000007'::uuid], 'E1: solo ve sus condiciones');
select test.ok((select count(*) from public.company_memberships) = 1, 'E1: solo ve su membresía');
select test.ok((select count(*) from public.role_assignments) = 1, 'E1: solo ve sus roles');
select test.ok((select array_agg(slug) from public.companies) = '{empresa-a}', 'E1: solo ve la empresa A');
select test.ok((select array_agg(slug) from public.groups) = '{grupo-uno}', 'E1: solo ve su grupo');
select test.ok((select count(*) from public.work_centers) = 2, 'E1: ve los centros de A');
select test.ok((select count(*) from public.teams) = 1, 'E1: ve los equipos de A');
select test.ok((select count(*) from public.profiles) = 1, 'E1: solo ve su perfil');
select test.ok((select count(*) from public.manager_assignments) = 1, 'E1: ve quién le supervisa');
select test.ok((select count(*) from storage.objects) = 1, 'E1: solo ve el logotipo de A');
select test.ok((select count(*) from public.audit_log) = 0, 'E1: no ve auditoría');
select test.ok((select count(*) from public.employees where id = test.e(8)) = 0,
  'E1: no puede leer a un compañero aunque conozca su id');
select test.ok((select count(*) from public.employees where company_id = test.co('B')) = 0,
  'E1: filtrar por company_id de B no devuelve nada');
select test.ok(test.affected($$update public.employees set first_name = 'Yo' where id = test.e(7)$$) = 0,
  'E1: no puede editar su ficha');
select test.ok(test.affected($$update public.employment_terms set valid_to = '2030-01-01'
  where employee_id = test.e(7)$$) = 0, 'E1: no puede editar sus condiciones');
select test.fails($$insert into public.role_assignments (company_id, membership_id, role)
  values (test.co('A'), test.m(7), 'company_admin')$$, 'E1: no puede concederse roles', 'row-level security');
select test.fails($$insert into public.company_memberships (company_id, user_id)
  values (test.co('B'), test.u(7))$$, 'E1: no puede darse de alta en otra empresa', 'row-level security');
select test.ok(test.affected($$update public.company_memberships set valid_to = now() + interval '9 years'
  where user_id = test.u(7)$$) = 0, 'E1: no puede ampliar la vigencia de su membresía');

-- -----------------------------------------------------------------------------
-- Equipo asignado (MGR supervisa a E1 en A y a EB en B)
-- -----------------------------------------------------------------------------
select test.act_as(test.u(6));
select test.ok((select array_agg(id order by id) from public.employees)
  = array[test.e(6), test.e(7), test.e(11)], 'MGR: ve su ficha y solo a sus supervisados (también de B)');
select test.ok((select count(*) from public.employees where id = test.e(8)) = 0,
  'MGR: no ve a empleados sin asignación vigente');
select test.ok((select count(*) from public.employment_terms) = 2, 'MGR: ve las condiciones de sus supervisados');
select test.ok((select count(*) from public.profiles) = 3, 'MGR: ve su perfil y los de sus supervisados');
select test.ok((select count(*) from public.company_memberships) = 3, 'MGR: ve su membresía y las de sus supervisados');
select test.ok((select array_agg(slug order by slug) from public.companies) = '{empresa-a,empresa-b}',
  'MGR: ve A (miembro) y B (supervisa), no C');
select test.ok((select count(*) from storage.objects) = 2, 'MGR: ve los logotipos de A y B');
select test.ok((select count(*) from public.audit_log) = 0, 'MGR: no ve auditoría');
select test.fails($$insert into public.manager_assignments (company_id, employee_id, manager_user_id)
  values (test.co('A'), test.e(8), test.u(6))$$, 'MGR: no puede asignarse empleados', 'row-level security');
select test.ok(test.affected($$update public.employees set first_name = 'X' where id = test.e(7)$$) = 0,
  'MGR: supervisar no permite editar la ficha');

select test.act_as(test.u(17));
select test.ok((select count(*) from public.employees) = 0, 'MOLD: con la asignación caducada no ve a E2');
select test.ok((select count(*) from public.employment_terms) = 0, 'MOLD: ni sus condiciones');

-- -----------------------------------------------------------------------------
-- Administrador de empresa (CA de A)
-- -----------------------------------------------------------------------------
select test.act_as(test.u(3));
select test.ok((select count(*) from public.employees) = 7, 'CA: ve los 7 empleados de A');
select test.ok(not exists (select 1 from public.employees where company_id <> test.co('A')),
  'CA: no ve empleados de otras empresas');
select test.ok((select count(*) from public.company_memberships) = 12, 'CA: ve las 12 membresías de A');
select test.ok((select count(*) from public.employment_terms) = 3, 'CA: ve las condiciones de A');
select test.ok((select count(*) from public.profiles) = 12, 'CA: ve los perfiles de la plantilla de A');
select test.ok((select array_agg(slug) from public.companies) = '{empresa-a}', 'CA: solo ve la empresa A');

insert into public.work_centers (company_id, name, code) values (test.co('A'), 'Sede A3', 'A3');
select test.ok(true, 'CA: crea centros en A');
select test.fails($$insert into public.work_centers (company_id, name, code)
  values (test.co('B'), 'Pirata', 'PX')$$, 'CA: no crea centros en B', 'row-level security');

insert into public.employees (company_id, employee_code, first_name, last_name, work_center_id)
values (test.co('A'), 'A-100', 'Nueva', 'Incorporación', test.wc('A1'));
select test.ok(true, 'CA: da de alta empleados en A');
select test.fails($$insert into public.employees (company_id, employee_code, first_name, last_name)
  values (test.co('B'), 'B-100', 'Pirata', 'Ejemplo')$$, 'CA: no da de alta empleados en B', 'row-level security');
select test.fails($$insert into public.employees (company_id, employee_code, first_name, last_name, team_id)
  values (test.co('A'), 'A-101', 'Cruce', 'Ejemplo', test.team('BT1'))$$,
  'CA: no puede usar un equipo de B en A', 'foreign key');

insert into public.role_assignments (company_id, membership_id, role) values (test.co('A'), test.m(8), 'hr');
select test.ok((select granted_by from public.role_assignments where membership_id = test.m(8) and role = 'hr')
  = test.u(3), 'CA: concede hr y queda registrado quién lo concedió');
select test.fails($$insert into public.role_assignments (company_id, membership_id, role)
  values (test.co('A'), test.m(3), 'auditor')$$, 'CA: no puede concederse roles a sí mismo', 'row-level security');
select test.fails($$insert into public.role_assignments (company_id, membership_id, role)
  values (test.co('A'), test.m(11), 'employee')$$, 'CA: no puede dar rol en A a una membresía de B', 'foreign key');

insert into public.company_memberships (company_id, user_id) values (test.co('A'), test.u(13));
select test.ok(true, 'CA: da de alta a X en A');
select test.fails($$insert into public.company_memberships (company_id, user_id)
  values (test.co('B'), test.u(13))$$, 'CA: no da de alta en B', 'row-level security');

select test.ok(test.affected($$update public.companies set name = 'Empresa A renombrada'
  where id = test.co('A')$$) = 1, 'CA: edita los datos de su empresa');
select test.fails($$update public.companies set status = 'inactive' where id = test.co('A')$$,
  'CA: no puede desactivar su empresa', 'administración del grupo');

insert into public.manager_assignments (company_id, employee_id, manager_user_id)
values (test.co('A'), test.e(8), test.u(11));
select test.ok(true, 'CA: asigna como manager a alguien de otra empresa del mismo grupo');
select test.fails($$insert into public.manager_assignments (company_id, employee_id, manager_user_id)
  values (test.co('A'), test.e(99), test.u(18))$$,
  'CA: no puede asignar un manager de otro grupo', 'row-level security');
select test.fails($$insert into public.manager_assignments (company_id, employee_id, manager_user_id)
  values (test.co('A'), test.e(8), test.u(8))$$,
  'CA: nadie supervisa su propia ficha', 'row-level security');
select test.fails($$insert into public.manager_assignments (company_id, employee_id, manager_user_id)
  values (test.co('A'), test.e(99), test.u(3))$$,
  'CA: no puede asignarse a sí mismo como manager', 'row-level security');

-- Cambiar company_id en la petición no amplía permisos
select test.fails($$update public.employees set company_id = test.co('B') where id = test.e(7)$$,
  'CA: no puede mover un empleado a otra empresa', 'permission denied');
select test.fails($$update public.company_memberships set company_id = test.co('B')
  where id = test.m(7)$$, 'CA: no puede mover una membresía', 'permission denied');
select test.fails($$insert into public.employment_terms (company_id, employee_id, contract_type,
  weekly_hours, valid_from) values (test.co('A'), test.e(11), 'permanent', 40, '2026-01-01')$$,
  'CA: no puede crear condiciones para un empleado de B declarando la empresa A', 'row-level security');
select test.fails($$insert into public.manager_assignments (company_id, employee_id, manager_user_id)
  values (test.co('A'), test.e(11), test.u(4))$$,
  'CA: no puede asignar manager a un empleado de B declarando la empresa A', 'row-level security');

select test.ok((select count(*) from public.audit_log where table_name = 'role_assignments'
  and actor_id = test.u(3) and company_id = test.co('A') and group_id = test.grp(1)) = 1,
  'CA: la concesión de rol queda auditada con actor, empresa y grupo');
select test.ok(not exists (select 1 from public.audit_log where company_id is distinct from test.co('A')),
  'CA: solo ve auditoría de A');

-- -----------------------------------------------------------------------------
-- RR. HH. (HR con ámbito empresa y HRW limitado al centro A2)
-- -----------------------------------------------------------------------------
select test.act_as(test.u(4));
insert into public.role_assignments (company_id, membership_id, role) values (test.co('A'), test.m(8), 'manager');
select test.ok(true, 'HR: concede el rol manager');
select test.fails($$insert into public.role_assignments (company_id, membership_id, role)
  values (test.co('A'), test.m(8), 'company_admin')$$, 'HR: no concede company_admin', 'row-level security');
select test.fails($$insert into public.role_assignments (company_id, membership_id, role)
  values (test.co('A'), test.m(9), 'auditor')$$, 'HR: no concede auditor', 'row-level security');
select test.ok(test.affected($$update public.role_assignments set status = 'revoked'
  where membership_id = test.m(3)$$) = 0, 'HR: no puede revocar al administrador de empresa');
select test.ok(test.affected($$update public.role_assignments set valid_to = now() + interval '1 hour'
  where membership_id = test.m(4)$$) = 0, 'HR: no puede tocar sus propios roles');
select test.ok(test.affected($$update public.employees set last_name = 'Editado'
  where id = test.e(4)$$) = 0, 'HR: no puede editar su propia ficha');
select test.ok(test.affected($$update public.employees set last_name = 'Editado'
  where id = test.e(7)$$) = 1, 'HR: edita fichas de su empresa');

select test.act_as(test.u(5));
select test.ok((select array_agg(id order by id) from public.employees) = array[test.e(8), test.e(99)],
  'HRW: solo ve empleados de su centro (A2)');
select test.ok((select count(*) from public.employment_terms) = 1, 'HRW: solo ve condiciones de su centro');
select test.ok((select count(*) from public.company_memberships) = 1,
  'HRW: un rol de centro no da acceso al listado de membresías');
select test.ok(test.affected($$update public.employees set last_name = 'X' where id = test.e(7)$$) = 0,
  'HRW: no edita empleados de otro centro');
select test.ok(test.affected($$update public.employees set last_name = 'Editado' where id = test.e(8)$$) = 1,
  'HRW: edita empleados de su centro');
select test.fails($$insert into public.employees (company_id, employee_code, first_name, last_name, work_center_id)
  values (test.co('A'), 'A-102', 'Fuera', 'Ámbito', test.wc('A1'))$$,
  'HRW: no da de alta empleados en otro centro', 'row-level security');
select test.fails($$update public.employees set work_center_id = test.wc('A1') where id = test.e(8)$$,
  'HRW: no puede sacar un empleado de su ámbito', 'row-level security');

-- -----------------------------------------------------------------------------
-- Contabilidad y auditor
-- -----------------------------------------------------------------------------
select test.act_as(test.u(9));
select test.ok((select count(*) from public.employees where company_id = test.co('A')) >= 7,
  'ACC: ve los empleados de A (datos básicos)');
select test.ok(not exists (select 1 from public.employees where company_id <> test.co('A')),
  'ACC: no ve empleados de otras empresas');
select test.ok((select count(*) from public.employment_terms) = 0, 'ACC: no ve condiciones laborales');
select test.ok((select count(*) from public.company_memberships) = 1, 'ACC: no ve la plantilla de cuentas');
select test.ok((select count(*) from public.audit_log) = 0, 'ACC: no ve auditoría');
select test.ok(test.affected($$update public.employees set first_name = 'X' where id = test.e(7)$$) = 0,
  'ACC: no edita empleados');
select test.fails($$insert into public.employees (company_id, employee_code, first_name, last_name)
  values (test.co('A'), 'A-103', 'No', 'Permitido')$$, 'ACC: no da de alta empleados', 'row-level security');

select test.act_as(test.u(10));
select test.ok((select count(*) from public.employment_terms) = 3, 'AUD: lee condiciones de A');
select test.ok((select count(*) from public.audit_log) > 0, 'AUD: lee la auditoría de A');
select test.ok(not exists (select 1 from public.audit_log where company_id is distinct from test.co('A')),
  'AUD: solo auditoría de A');
select test.ok(test.affected($$update public.employees set first_name = 'X' where id = test.e(7)$$) = 0,
  'AUD: no modifica empleados');
select test.fails($$insert into public.role_assignments (company_id, membership_id, role)
  values (test.co('A'), test.m(7), 'auditor')$$, 'AUD: no concede roles', 'row-level security');

-- -----------------------------------------------------------------------------
-- Empresa ajena (CB administra B; CC administra C en otro grupo)
-- -----------------------------------------------------------------------------
select test.act_as(test.u(12));
select test.ok((select array_agg(id) from public.employees) = array[test.e(11)], 'CB: solo ve empleados de B');
select test.ok((select count(*) from public.employees where id = test.e(7)) = 0, 'CB: no ve a E1 aunque conozca su id');
select test.ok((select count(*) from public.work_centers where company_id = test.co('A')) = 0, 'CB: no ve centros de A');
select test.ok((select count(*) from public.company_memberships where company_id = test.co('A')) = 0,
  'CB: no ve membresías de A');
select test.ok(test.affected($$update public.employees set first_name = 'X' where id = test.e(7)$$) = 0,
  'CB: no modifica empleados de A');
select test.fails($$insert into public.employees (company_id, employee_code, first_name, last_name)
  values (test.co('A'), 'A-007', 'Sonda', 'Ejemplo')$$,
  'CB: insertar en A falla por RLS, sin revelar si el código existe', 'row-level security');
select test.fails($$insert into public.role_assignments (company_id, membership_id, role)
  values (test.co('B'), test.m(7), 'employee')$$, 'CB: no puede dar rol en B a una membresía de A', 'foreign key');

select test.act_as(test.u(16));
select test.ok((select array_agg(slug) from public.companies) = '{empresa-c}', 'CC: solo ve la empresa C');
select test.ok((select array_agg(slug) from public.groups) = '{grupo-dos}', 'CC: solo ve su grupo');

-- -----------------------------------------------------------------------------
-- Membresía caducada y roles fuera de vigencia
-- -----------------------------------------------------------------------------
select test.act_as(test.u(14));
select test.ok((select count(*) from public.companies) = 0, 'EXP: con la membresía caducada no ve su empresa');
select test.ok((select count(*) from public.employees) = 0, 'EXP: ni su propia ficha');
select test.ok((select count(*) from public.employment_terms) = 0, 'EXP: ni sus condiciones');
select test.ok((select count(*) from public.work_centers) = 0, 'EXP: ni los centros');
select test.fails($$insert into public.employees (company_id, employee_code, first_name, last_name)
  values (test.co('A'), 'A-104', 'Caducado', 'Ejemplo')$$,
  'EXP: un rol hr activo no sirve con la membresía caducada', 'row-level security');

select test.act_as(test.u(19));
select test.ok((select count(*) from public.employees) = 0, 'RFUT: un rol con vigencia futura aún no da acceso');
select test.act_as(test.u(20));
select test.ok((select count(*) from public.employees) = 0, 'RREV: un rol revocado no da acceso');

-- -----------------------------------------------------------------------------
-- Administración de grupo y de plataforma
-- -----------------------------------------------------------------------------
select test.act_as(test.u(2));
select test.ok((select array_agg(slug order by slug) from public.companies) = '{empresa-a,empresa-b}',
  'GA: ve las empresas de su grupo y no las de otro');
select test.ok(not exists (select 1 from public.employees where company_id = test.co('C')),
  'GA: no ve empleados de otro grupo');
insert into public.companies (group_id, name, slug) values (test.grp(1), 'Empresa nueva', 'empresa-nueva');
select test.ok(true, 'GA: crea empresas en su grupo');
select test.fails($$insert into public.companies (group_id, name, slug)
  values (test.grp(2), 'Pirata', 'pirata')$$, 'GA: no crea empresas en otro grupo', 'row-level security');
select test.fails($$insert into public.group_admins (group_id, user_id)
  values (test.grp(1), test.u(3))$$, 'GA: no nombra administradores de grupo', 'row-level security');
select test.ok(test.affected($$update public.companies set status = 'inactive'
  where slug = 'empresa-nueva'$$) = 1, 'GA: puede desactivar empresas de su grupo');

select test.act_as(test.u(1));
select test.ok((select count(*) from public.companies) = 4, 'PA: la plataforma ve todas las empresas');
select test.fails($$insert into public.group_admins (group_id, user_id)
  values (test.grp(1), test.u(1))$$, 'PA: tampoco puede nombrarse a sí mismo', 'row-level security');
reset role;

\echo 'Pruebas de aislamiento multiempresa superadas.'
