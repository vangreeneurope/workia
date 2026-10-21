-- =============================================================================
-- Pruebas de permisos (RLS + privilegios) de la fase base.
-- Se ejecutan con scripts/test-db.sh sobre una base desechable.
-- Cualquier fallo lanza una excepción y detiene la ejecución (ON_ERROR_STOP).
--
-- Escenario:
--   Empresa A y empresa B.
--   G  = administrador global
--   H  = RR. HH. (company_admin) de A
--   M  = manager en A que además supervisa a E2 (empleado de B)
--   E1 = empleado de A          E2 = empleado de B
--   C  = contabilidad de A      X  = usuario sin empresa
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on

create schema if not exists test;
grant usage on schema test to public;

create or replace function test.ok(condition boolean, description text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then
    raise exception 'FALLO: %', description;
  end if;
  raise notice 'ok - %', description;
end $$;

-- Ejecuta SQL y exige que falle (RLS o privilegios).
create or replace function test.fails(statement text, description text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    raise notice 'ok - % (%)', description, sqlerrm;
    return;
  end;
  raise exception 'FALLO: se esperaba error en: %', description;
end $$;

create or replace function test.act_as(user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, false);
end $$;

grant execute on all functions in schema test to public;

-- Datos de prueba (como superusuario, equivalente a service_role) -------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'g@grupo.test',  '{"full_name":"Global"}'),
  ('00000000-0000-0000-0000-00000000000b', 'h@grupo.test',  '{"full_name":"RRHH A"}'),
  ('00000000-0000-0000-0000-00000000000c', 'm@grupo.test',  '{"full_name":"Manager"}'),
  ('00000000-0000-0000-0000-00000000000d', 'e1@grupo.test', '{"full_name":"Empleado A"}'),
  ('00000000-0000-0000-0000-00000000000e', 'e2@grupo.test', '{"full_name":"Empleado B"}'),
  ('00000000-0000-0000-0000-00000000000f', 'c@grupo.test',  '{"full_name":"Contabilidad"}'),
  ('00000000-0000-0000-0000-000000000010', 'x@grupo.test',  '{}');

select test.ok((select count(*) from public.profiles) = 7, 'el trigger crea un perfil por usuario de Auth');

insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000000a');

insert into public.companies (id, name, slug, primary_color) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Empresa A', 'empresa-a', '#0055aa'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Empresa B', 'empresa-b', '#aa5500');

insert into public.company_memberships (id, company_id, user_id, roles) values
  ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '{company_admin,employee}'),
  ('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', '{manager,employee}'),
  ('11111111-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', '{employee}'),
  ('11111111-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000e', '{employee}'),
  ('11111111-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000f', '{accounting}');

insert into public.manager_assignments (manager_user_id, employee_membership_id, company_id) values
  ('00000000-0000-0000-0000-00000000000c', '11111111-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000002');

insert into storage.objects (bucket_id, name) values
  ('company-logos', 'aaaaaaaa-0000-0000-0000-000000000001/logo.png'),
  ('company-logos', 'bbbbbbbb-0000-0000-0000-000000000002/logo.png');

-- anon -----------------------------------------------------------------------
set role anon;
select test.fails('select * from public.companies', 'anon no puede leer empresas');
select test.fails('select * from public.profiles', 'anon no puede leer perfiles');
select test.fails('select * from public.audit_log', 'anon no puede leer auditoría');
reset role;

-- X: sin empresa ---------------------------------------------------------------
set role authenticated;
select test.act_as('00000000-0000-0000-0000-000000000010');
select test.ok((select count(*) from public.companies) = 0, 'X no ve empresas');
select test.ok((select count(*) from public.company_memberships) = 0, 'X no ve membresías');
select test.ok((select count(*) from public.profiles) = 1, 'X solo ve su perfil');
select test.ok(not exists (select 1 from public.platform_admins), 'X no ve administradores globales');

-- E1: empleado de A --------------------------------------------------------------
select test.act_as('00000000-0000-0000-0000-00000000000d');
select test.ok((select array_agg(slug) from public.companies) = '{empresa-a}', 'E1 solo ve la empresa A');
select test.ok((select count(*) from public.company_memberships) = 1, 'E1 solo ve su membresía');
select test.ok((select count(*) from public.profiles) = 1, 'E1 solo ve su propio perfil');
select test.ok((select count(*) from public.audit_log) = 0, 'E1 no ve la auditoría');
select test.ok((select count(*) from storage.objects) = 1, 'E1 solo ve el logotipo de A');

update public.profiles set full_name = 'Empleado A editado' where id = '00000000-0000-0000-0000-00000000000d';
select test.ok((select full_name from public.profiles where id = '00000000-0000-0000-0000-00000000000d') = 'Empleado A editado',
  'E1 puede editar su nombre');
select test.fails($$update public.profiles set email = 'otro@x.test' where id = '00000000-0000-0000-0000-00000000000d'$$,
  'E1 no puede cambiar su email desde la API');

update public.company_memberships set roles = '{company_admin}' where user_id = '00000000-0000-0000-0000-00000000000d';
reset role;
select test.ok((select roles from public.company_memberships where id = '11111111-0000-0000-0000-000000000003') = '{employee}',
  'E1 no puede escalar sus propios roles');
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000d');

select test.fails($$insert into public.companies (name, slug) values ('Pirata', 'pirata')$$, 'E1 no puede crear empresas');
select test.fails($$insert into public.company_memberships (company_id, user_id) values
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000d')$$, 'E1 no puede darse de alta en otra empresa');
select test.fails($$insert into storage.objects (bucket_id, name) values
  ('company-logos', 'aaaaaaaa-0000-0000-0000-000000000001/x.png')$$, 'E1 no puede subir logotipos');

-- H: RR. HH. de A ------------------------------------------------------------------
select test.act_as('00000000-0000-0000-0000-00000000000b');
select test.ok((select count(*) from public.company_memberships) = 4, 'RR. HH. de A ve las 4 membresías de A');
select test.ok(not exists (select 1 from public.company_memberships where company_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'RR. HH. de A no ve membresías de B');
select test.ok((select count(*) from public.profiles) = 4, 'RR. HH. de A ve los perfiles de su plantilla');

insert into public.company_memberships (company_id, user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010');
select test.ok(true, 'RR. HH. de A puede dar de alta en A');
select test.fails($$insert into public.company_memberships (company_id, user_id) values
  ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000010')$$, 'RR. HH. de A no puede dar de alta en B');
select test.fails($$update public.company_memberships set user_id = '00000000-0000-0000-0000-00000000000b'
  where id = '11111111-0000-0000-0000-000000000003'$$, 'Una membresía no puede cambiar de usuario');
-- Un UPDATE bloqueado por RLS no da error: afecta a 0 filas. Se comprueba el resultado.
update public.companies set name = 'Renombrada' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select test.ok((select name from public.companies where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'Empresa A',
  'RR. HH. no puede editar los datos de la empresa en la fase base');

insert into public.manager_assignments (manager_user_id, employee_membership_id, company_id) values
  ('00000000-0000-0000-0000-00000000000c', '11111111-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001');
select test.ok(true, 'RR. HH. de A puede asignar manager a un empleado de A');
select test.fails($$insert into public.manager_assignments (manager_user_id, employee_membership_id, company_id) values
  ('00000000-0000-0000-0000-00000000000d', '11111111-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'Nadie puede ser su propio manager');
select test.fails($$insert into public.manager_assignments (manager_user_id, employee_membership_id, company_id) values
  ('00000000-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'La empresa de la asignación debe coincidir con la de la membresía');
select test.fails($$insert into public.manager_assignments (manager_user_id, employee_membership_id, company_id) values
  ('00000000-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000002')$$,
  'RR. HH. de A no puede asignar managers en B');

select test.ok((select count(*) from public.audit_log where company_id = 'aaaaaaaa-0000-0000-0000-000000000001') > 0,
  'RR. HH. de A ve la auditoría de A');
select test.ok(not exists (select 1 from public.audit_log where company_id is distinct from 'aaaaaaaa-0000-0000-0000-000000000001'),
  'RR. HH. de A no ve auditoría ajena');

-- M: manager con empleados en A y B ---------------------------------------------
select test.act_as('00000000-0000-0000-0000-00000000000c');
select test.ok((select count(*) from public.companies) = 2, 'El manager ve A (miembro) y B (supervisa)');
select test.ok((select count(*) from public.company_memberships) = 3, 'El manager ve su membresía y las de sus supervisados');
select test.ok(exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000e'),
  'El manager ve el perfil de su supervisado en otra empresa');
select test.ok(not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-00000000000f'),
  'El manager no ve perfiles que no supervisa');
select test.ok((select count(*) from storage.objects) = 2, 'El manager ve los logotipos de A y B');
select test.fails($$insert into public.manager_assignments (manager_user_id, employee_membership_id, company_id) values
  ('00000000-0000-0000-0000-00000000000c', '11111111-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'Un manager no puede asignarse empleados');

-- E2: ve quién es su manager ----------------------------------------------------
select test.act_as('00000000-0000-0000-0000-00000000000e');
select test.ok((select count(*) from public.manager_assignments) = 1, 'E2 ve su asignación de manager');
select test.ok((select count(*) from public.companies) = 1, 'E2 solo ve la empresa B');

-- C: contabilidad de A ----------------------------------------------------------
select test.act_as('00000000-0000-0000-0000-00000000000f');
select test.ok((select count(*) from public.company_memberships) = 1, 'Contabilidad no ve la plantilla en la fase base');

-- G: administrador global --------------------------------------------------------
select test.act_as('00000000-0000-0000-0000-00000000000a');
select test.ok((select count(*) from public.companies) = 2, 'El administrador global ve todas las empresas');
insert into public.companies (name, slug) values ('Empresa C', 'empresa-c');
select test.ok((select count(*) from public.companies) = 3, 'El administrador global puede crear empresas');
select test.fails($$insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000000b')$$,
  'Los administradores globales no se crean desde la API');
reset role;

-- Membresía desactivada ----------------------------------------------------------
update public.company_memberships set active = false where id = '11111111-0000-0000-0000-000000000003';
set role authenticated;
select test.act_as('00000000-0000-0000-0000-00000000000d');
select test.ok((select count(*) from public.companies) = 0, 'Un empleado dado de baja deja de ver la empresa');
reset role;

-- Auditoría inmutable ------------------------------------------------------------
select test.ok((select count(*) from public.audit_log where table_name = 'company_memberships') >= 6,
  'Los cambios de membresías quedan auditados');
select test.ok(exists (select 1 from public.audit_log
  where table_name = 'company_memberships' and actor_id = '00000000-0000-0000-0000-00000000000b'),
  'La auditoría registra al actor');
select test.fails('update public.audit_log set action = ''DELETE''', 'La auditoría no se puede modificar (ni como superusuario)');
select test.fails('delete from public.audit_log', 'La auditoría no se puede borrar (ni como superusuario)');
select test.fails('truncate public.audit_log', 'La auditoría no se puede vaciar');

-- Validaciones de datos ----------------------------------------------------------
select test.fails($$insert into public.companies (name, slug, primary_color) values ('Mala', 'mala', 'red;}')$$,
  'El color corporativo se valida (evita inyección CSS)');
select test.fails($$insert into public.companies (name, slug) values ('Mala', 'Slug Mal')$$, 'El slug se valida');

\echo 'Todas las pruebas de RLS han pasado.'
