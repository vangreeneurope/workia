-- Escenario sintético compartido por las pruebas de aislamiento.
-- Se inserta como superusuario (equivale a service_role: RLS no aplica).
--
-- Grupo G1: empresas A y B.   Grupo G2: empresa C.
-- A: centros A1 y A2, equipo AT1 (en A1).   B: centro B1, equipo BT1.
--
-- Usuarios (uuid ...0000NN):
--   01 PA   administración de plataforma        02 GA   administrador del grupo G1
--   03 CA   company_admin de A                  04 HR   hr de A (ámbito empresa)
--   05 HRW  hr de A solo en el centro A2         06 MGR  manager en A; supervisa a E1 (A) y EB (B)
--   07 E1   empleado de A (A1, AT1)              08 E2   empleado de A (A2)
--   09 ACC  contabilidad de A                    10 AUD  auditor de A
--   11 EB   empleado de B                        12 CB   company_admin de B
--   13 X    sin membresía                        14 EXP  membresía en A caducada
--   15 EC   empleado de C (G2)                   16 CC   company_admin de C
--   17 MOLD manager en A con asignación caducada sobre E2
--   18 MOUT manager en C (otro grupo)            19 RFUT hr en A con vigencia futura
--   20 RREV hr en A revocado

-- Atajos para referirse al escenario: test.u(7) = usuario 7, test.co('A') = empresa A...
create or replace function test.u(n int) returns uuid language sql immutable as
  $$ select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function test.m(n int) returns uuid language sql immutable as
  $$ select ('d0000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function test.e(n int) returns uuid language sql immutable as
  $$ select ('e0000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function test.co(code text) returns uuid language sql immutable as $$
  select case code
    when 'A' then 'aaaaaaaa-0000-0000-0000-000000000001'
    when 'B' then 'bbbbbbbb-0000-0000-0000-000000000002'
    when 'C' then 'cccccccc-0000-0000-0000-000000000003'
  end::uuid $$;
create or replace function test.grp(n int) returns uuid language sql immutable as
  $$ select ('10000000-0000-0000-0000-00000000000' || n)::uuid $$;
create or replace function test.wc(code text) returns uuid language sql immutable as $$
  select case code
    when 'A1' then 'a1000000-0000-0000-0000-000000000001'
    when 'A2' then 'a1000000-0000-0000-0000-000000000002'
    when 'B1' then 'b1000000-0000-0000-0000-000000000001'
  end::uuid $$;
create or replace function test.team(code text) returns uuid language sql immutable as $$
  select case code
    when 'AT1' then 'a2000000-0000-0000-0000-000000000001'
    when 'BT1' then 'b2000000-0000-0000-0000-000000000001'
  end::uuid $$;
grant execute on all functions in schema test to public;

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'usuario' || n || '@pruebas.example'
from generate_series(1, 20) as n;

insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000000001');

insert into public.groups (id, name, slug) values
  ('10000000-0000-0000-0000-000000000001', 'Grupo Uno', 'grupo-uno'),
  ('10000000-0000-0000-0000-000000000002', 'Grupo Dos', 'grupo-dos');

insert into public.group_admins (group_id, user_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002');

insert into public.companies (id, group_id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Empresa A', 'empresa-a'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Empresa B', 'empresa-b'),
  ('cccccccc-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Empresa C', 'empresa-c');

insert into public.work_centers (id, company_id, name, code) values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Sede A1', 'A1'),
  ('a1000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Sede A2', 'A2'),
  ('b1000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'Sede B1', 'B1');

insert into public.teams (id, company_id, work_center_id, name) values
  ('a2000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Equipo AT1'),
  ('b2000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'Equipo BT1');

-- Membresías: id d...NN para el usuario NN.
insert into public.company_memberships (id, company_id, user_id, valid_from, valid_to)
select ('d0000000-0000-0000-0000-0000000000' || lpad(u::text, 2, '0'))::uuid,
       c::uuid,
       ('00000000-0000-0000-0000-0000000000' || lpad(u::text, 2, '0'))::uuid,
       case when u = 14 then now() - interval '30 days' else now() - interval '1 day' end,
       case when u = 14 then now() - interval '1 day' end
from (values
  (3, 'aaaaaaaa-0000-0000-0000-000000000001'), (4, 'aaaaaaaa-0000-0000-0000-000000000001'),
  (5, 'aaaaaaaa-0000-0000-0000-000000000001'), (6, 'aaaaaaaa-0000-0000-0000-000000000001'),
  (7, 'aaaaaaaa-0000-0000-0000-000000000001'), (8, 'aaaaaaaa-0000-0000-0000-000000000001'),
  (9, 'aaaaaaaa-0000-0000-0000-000000000001'), (10, 'aaaaaaaa-0000-0000-0000-000000000001'),
  (11, 'bbbbbbbb-0000-0000-0000-000000000002'), (12, 'bbbbbbbb-0000-0000-0000-000000000002'),
  (14, 'aaaaaaaa-0000-0000-0000-000000000001'), (15, 'cccccccc-0000-0000-0000-000000000003'),
  (16, 'cccccccc-0000-0000-0000-000000000003'), (17, 'aaaaaaaa-0000-0000-0000-000000000001'),
  (18, 'cccccccc-0000-0000-0000-000000000003'), (19, 'aaaaaaaa-0000-0000-0000-000000000001'),
  (20, 'aaaaaaaa-0000-0000-0000-000000000001')
) as m(u, c);

insert into public.role_assignments (company_id, membership_id, role, scope_type, work_center_id,
  status, valid_from)
select c::uuid, ('d0000000-0000-0000-0000-0000000000' || lpad(u::text, 2, '0'))::uuid,
       r::public.app_role, s::public.role_scope, wc::uuid, st::public.grant_status,
       case when u = 19 then now() + interval '1 day' else now() - interval '1 day' end
from (values
  (3,  'aaaaaaaa-0000-0000-0000-000000000001', 'company_admin', 'company', null, 'active'),
  (4,  'aaaaaaaa-0000-0000-0000-000000000001', 'hr', 'company', null, 'active'),
  (4,  'aaaaaaaa-0000-0000-0000-000000000001', 'employee', 'company', null, 'active'),
  (5,  'aaaaaaaa-0000-0000-0000-000000000001', 'hr', 'work_center', 'a1000000-0000-0000-0000-000000000002', 'active'),
  (6,  'aaaaaaaa-0000-0000-0000-000000000001', 'manager', 'company', null, 'active'),
  (6,  'aaaaaaaa-0000-0000-0000-000000000001', 'employee', 'company', null, 'active'),
  (7,  'aaaaaaaa-0000-0000-0000-000000000001', 'employee', 'company', null, 'active'),
  (8,  'aaaaaaaa-0000-0000-0000-000000000001', 'employee', 'company', null, 'active'),
  (9,  'aaaaaaaa-0000-0000-0000-000000000001', 'accounting', 'company', null, 'active'),
  (10, 'aaaaaaaa-0000-0000-0000-000000000001', 'auditor', 'company', null, 'active'),
  (11, 'bbbbbbbb-0000-0000-0000-000000000002', 'employee', 'company', null, 'active'),
  (12, 'bbbbbbbb-0000-0000-0000-000000000002', 'company_admin', 'company', null, 'active'),
  (14, 'aaaaaaaa-0000-0000-0000-000000000001', 'hr', 'company', null, 'active'),
  (15, 'cccccccc-0000-0000-0000-000000000003', 'employee', 'company', null, 'active'),
  (16, 'cccccccc-0000-0000-0000-000000000003', 'company_admin', 'company', null, 'active'),
  (17, 'aaaaaaaa-0000-0000-0000-000000000001', 'manager', 'company', null, 'active'),
  (18, 'cccccccc-0000-0000-0000-000000000003', 'manager', 'company', null, 'active'),
  (19, 'aaaaaaaa-0000-0000-0000-000000000001', 'hr', 'company', null, 'active'),
  (20, 'aaaaaaaa-0000-0000-0000-000000000001', 'hr', 'company', null, 'revoked')
) as ra(u, c, r, s, wc, st);

-- Empleados: id e...NN para el usuario NN; e...99 no tiene cuenta.
insert into public.employees (id, company_id, membership_id, employee_code, first_name, last_name,
  work_center_id, team_id)
values
  ('e0000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004', 'A-004', 'Hache', 'Erre', 'a1000000-0000-0000-0000-000000000001', null),
  ('e0000000-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006', 'A-006', 'Eme', 'Ge', 'a1000000-0000-0000-0000-000000000001', null),
  ('e0000000-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000007', 'A-007', 'Uno', 'Ejemplo', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000008', 'A-008', 'Dos', 'Ejemplo', 'a1000000-0000-0000-0000-000000000002', null),
  ('e0000000-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000009', 'A-009', 'Ce', 'Conta', null, null),
  ('e0000000-0000-0000-0000-000000000014', 'aaaaaaaa-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000014', 'A-014', 'Antigua', 'Ejemplo', 'a1000000-0000-0000-0000-000000000001', null),
  ('e0000000-0000-0000-0000-000000000099', 'aaaaaaaa-0000-0000-0000-000000000001', null, 'A-099', 'Sin', 'Cuenta', 'a1000000-0000-0000-0000-000000000002', null),
  ('e0000000-0000-0000-0000-000000000011', 'bbbbbbbb-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000011', 'B-011', 'Be', 'Ejemplo', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-000000000015', 'cccccccc-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000015', 'C-015', 'Ce', 'Ejemplo', null, null);

insert into public.employment_terms (id, company_id, employee_id, contract_type, weekly_hours,
  job_title, valid_from)
values
  ('f0000000-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000007', 'permanent', 40, 'Comercial', '2025-01-01'),
  ('f0000000-0000-0000-0000-000000000008', 'aaaaaaaa-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000008', 'temporary', 20, 'Administrativo', '2025-06-01'),
  ('f0000000-0000-0000-0000-000000000014', 'aaaaaaaa-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000014', 'permanent', 40, 'Técnico', '2020-01-01'),
  ('f0000000-0000-0000-0000-000000000011', 'bbbbbbbb-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000011', 'permanent', 40, 'Comercial', '2024-03-01');

insert into public.manager_assignments (company_id, employee_id, manager_user_id, valid_from, valid_to)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000006', now() - interval '1 day', null),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000006', now() - interval '1 day', null),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000017', now() - interval '10 days', now() - interval '1 day');

insert into storage.objects (bucket_id, name) values
  ('company-logos', 'aaaaaaaa-0000-0000-0000-000000000001/logo.png'),
  ('company-logos', 'bbbbbbbb-0000-0000-0000-000000000002/logo.png'),
  ('company-logos', 'cccccccc-0000-0000-0000-000000000003/logo.png');

-- Horarios: una plantilla sin versiones en A (la usan las pruebas de reversión
-- para comprobar que no se pierden datos sin autorización).
insert into public.shift_templates (id, company_id, code, name) values
  ('5f000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'FX', 'Plantilla de pruebas');

-- Control horario: política por defecto de A (sin ubicación ni selfie).
insert into public.time_tracking_policies (company_id) values ('aaaaaaaa-0000-0000-0000-000000000001');

-- Ausencias: un tipo sin saldo en A (las pruebas de reversión comprueban que no
-- se pierden datos sin autorización).
insert into public.absence_types (id, company_id, code, name) values
  ('7f000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'FX', 'Tipo de pruebas');
