-- =============================================================================
-- DATOS SINTÉTICOS SOLO PARA DESARROLLO LOCAL.
--
-- Se cargan con `npx supabase db reset` (supabase/config.toml -> [db.seed]).
-- NUNCA se aplican a producción: no uses `supabase db push --include-seed`
-- contra un proyecto real. Ninguna persona, empresa, correo o NIF es real:
-- los correos usan el dominio reservado .example (RFC 2606).
--
-- Las cuentas no tienen contraseña (no hay credenciales en el repositorio).
-- Para entrar en local: "¿Has olvidado tu contraseña?" y abre el correo en
-- el buzón de pruebas de Supabase local (Mailpit/Inbucket).
--
-- Escenario:
--   Grupo Demo -> Alfa Servicios Demo (Madrid, Barcelona) y Beta Comercial Demo (Valencia)
--   Alfa: administración, RR. HH., manager, 2 empleados, contabilidad, auditoría
--   Beta: administración y 1 comercial
--   El manager de Alfa supervisa a un empleado de Alfa y al comercial de Beta.
-- =============================================================================

-- Usuarios de Auth (el trigger on_auth_user_created crea sus perfiles)
with seed_users(id, email, full_name) as (
  values
    ('5eed0000-0000-4000-8000-000000000001'::uuid, 'admin.grupo@grupo-demo.example', 'Gala Grupo Demo'),
    ('5eed0000-0000-4000-8000-000000000002'::uuid, 'admin@alfa-demo.example', 'Adela Admin Demo'),
    ('5eed0000-0000-4000-8000-000000000003'::uuid, 'rrhh@alfa-demo.example', 'Rita Recursos Demo'),
    ('5eed0000-0000-4000-8000-000000000004'::uuid, 'manager@alfa-demo.example', 'Mario Manager Demo'),
    ('5eed0000-0000-4000-8000-000000000005'::uuid, 'empleado1@alfa-demo.example', 'Elena Empleada Demo'),
    ('5eed0000-0000-4000-8000-000000000006'::uuid, 'empleado2@alfa-demo.example', 'Enzo Empleado Demo'),
    ('5eed0000-0000-4000-8000-000000000007'::uuid, 'contabilidad@alfa-demo.example', 'Carla Cuentas Demo'),
    ('5eed0000-0000-4000-8000-000000000008'::uuid, 'auditoria@alfa-demo.example', 'Aurelio Auditor Demo'),
    ('5eed0000-0000-4000-8000-000000000009'::uuid, 'admin@beta-demo.example', 'Bruno Admin Demo'),
    ('5eed0000-0000-4000-8000-000000000010'::uuid, 'comercial@beta-demo.example', 'Berta Comercial Demo')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token,
  email_change_token_new, email_change, created_at, updated_at
)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, '',
  now(), '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', full_name), '', '', '', '', now(), now()
from seed_users;

insert into auth.identities (user_id, provider_id, identity_data, provider, created_at, updated_at)
select u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now()
from auth.users u
where u.id::text like '5eed0000-%';

-- Organización
insert into public.groups (id, name, slug) values
  ('5eed1000-0000-4000-8000-000000000001', 'Grupo Demo', 'grupo-demo');

insert into public.group_admins (group_id, user_id) values
  ('5eed1000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000001');

insert into public.companies (id, group_id, name, legal_name, slug, primary_color) values
  ('5eed2000-0000-4000-8000-00000000000a', '5eed1000-0000-4000-8000-000000000001',
   'Alfa Servicios Demo', 'Alfa Servicios Demo, S.L. (ficticia)', 'alfa-demo', '#1d4ed8'),
  ('5eed2000-0000-4000-8000-00000000000b', '5eed1000-0000-4000-8000-000000000001',
   'Beta Comercial Demo', 'Beta Comercial Demo, S.L. (ficticia)', 'beta-demo', '#b45309');

insert into public.work_centers (id, company_id, name, code, city, province) values
  ('5eed3000-0000-4000-8000-0000000000a1', '5eed2000-0000-4000-8000-00000000000a', 'Oficina central (demo)', 'MAD', 'Madrid', 'Madrid'),
  ('5eed3000-0000-4000-8000-0000000000a2', '5eed2000-0000-4000-8000-00000000000a', 'Delegación (demo)', 'BCN', 'Barcelona', 'Barcelona'),
  ('5eed3000-0000-4000-8000-0000000000b1', '5eed2000-0000-4000-8000-00000000000b', 'Oficina (demo)', 'VLC', 'Valencia', 'Valencia');

insert into public.teams (id, company_id, work_center_id, name) values
  ('5eed4000-0000-4000-8000-0000000000a1', '5eed2000-0000-4000-8000-00000000000a', '5eed3000-0000-4000-8000-0000000000a1', 'Comercial Centro'),
  ('5eed4000-0000-4000-8000-0000000000a2', '5eed2000-0000-4000-8000-00000000000a', '5eed3000-0000-4000-8000-0000000000a1', 'Administración'),
  ('5eed4000-0000-4000-8000-0000000000b1', '5eed2000-0000-4000-8000-00000000000b', '5eed3000-0000-4000-8000-0000000000b1', 'Ventas');

-- Membresías (id 5eed5000-...-0000000000NN para el usuario NN)
insert into public.company_memberships (id, company_id, user_id, valid_from)
select ('5eed5000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  case when n >= 9 then '5eed2000-0000-4000-8000-00000000000b'::uuid
       else '5eed2000-0000-4000-8000-00000000000a'::uuid end,
  ('5eed0000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  now() - interval '1 year'
from generate_series(2, 10) as n;

insert into public.role_assignments (company_id, membership_id, role, valid_from)
select m.company_id, m.id, r.role::public.app_role, now() - interval '1 year'
from (values
  (2, 'company_admin'), (3, 'hr'), (3, 'employee'), (4, 'manager'), (4, 'employee'),
  (5, 'employee'), (6, 'employee'), (7, 'accounting'), (8, 'auditor'),
  (9, 'company_admin'), (10, 'employee')
) as r(n, role)
join public.company_memberships m
  on m.id = ('5eed5000-0000-4000-8000-0000000000' || lpad(r.n::text, 2, '0'))::uuid;

-- Fichas de empleado y condiciones laborales
insert into public.employees (id, company_id, membership_id, employee_code, first_name, last_name,
  work_email, work_center_id, team_id)
values
  ('5eed6000-0000-4000-8000-000000000003', '5eed2000-0000-4000-8000-00000000000a', '5eed5000-0000-4000-8000-000000000003', 'ALFA-0003', 'Rita', 'Recursos Demo', 'rrhh@alfa-demo.example', '5eed3000-0000-4000-8000-0000000000a1', '5eed4000-0000-4000-8000-0000000000a2'),
  ('5eed6000-0000-4000-8000-000000000004', '5eed2000-0000-4000-8000-00000000000a', '5eed5000-0000-4000-8000-000000000004', 'ALFA-0004', 'Mario', 'Manager Demo', 'manager@alfa-demo.example', '5eed3000-0000-4000-8000-0000000000a1', '5eed4000-0000-4000-8000-0000000000a1'),
  ('5eed6000-0000-4000-8000-000000000005', '5eed2000-0000-4000-8000-00000000000a', '5eed5000-0000-4000-8000-000000000005', 'ALFA-0005', 'Elena', 'Empleada Demo', 'empleado1@alfa-demo.example', '5eed3000-0000-4000-8000-0000000000a1', '5eed4000-0000-4000-8000-0000000000a1'),
  ('5eed6000-0000-4000-8000-000000000006', '5eed2000-0000-4000-8000-00000000000a', '5eed5000-0000-4000-8000-000000000006', 'ALFA-0006', 'Enzo', 'Empleado Demo', 'empleado2@alfa-demo.example', '5eed3000-0000-4000-8000-0000000000a2', null),
  ('5eed6000-0000-4000-8000-000000000007', '5eed2000-0000-4000-8000-00000000000a', '5eed5000-0000-4000-8000-000000000007', 'ALFA-0007', 'Carla', 'Cuentas Demo', 'contabilidad@alfa-demo.example', '5eed3000-0000-4000-8000-0000000000a1', '5eed4000-0000-4000-8000-0000000000a2'),
  ('5eed6000-0000-4000-8000-000000000010', '5eed2000-0000-4000-8000-00000000000b', '5eed5000-0000-4000-8000-000000000010', 'BETA-0010', 'Berta', 'Comercial Demo', 'comercial@beta-demo.example', '5eed3000-0000-4000-8000-0000000000b1', '5eed4000-0000-4000-8000-0000000000b1');

insert into public.employment_terms (company_id, employee_id, contract_type, working_time,
  weekly_hours, job_title, valid_from)
select e.company_id, e.id, t.contract_type::public.contract_type, t.working_time::public.working_time,
  t.hours, t.title, t.valid_from::date
from (values
  ('5eed6000-0000-4000-8000-000000000003', 'permanent', 'full_time', 40, 'Técnica de RR. HH.', '2023-02-01'),
  ('5eed6000-0000-4000-8000-000000000004', 'permanent', 'full_time', 40, 'Jefe de equipo comercial', '2022-09-01'),
  ('5eed6000-0000-4000-8000-000000000005', 'permanent', 'full_time', 40, 'Comercial', '2024-01-15'),
  ('5eed6000-0000-4000-8000-000000000006', 'temporary', 'part_time', 20, 'Administrativo', '2025-10-01'),
  ('5eed6000-0000-4000-8000-000000000007', 'permanent', 'full_time', 37.5, 'Contable', '2021-05-03'),
  ('5eed6000-0000-4000-8000-000000000010', 'permanent', 'full_time', 40, 'Comercial', '2024-04-01')
) as t(employee_id, contract_type, working_time, hours, title, valid_from)
join public.employees e on e.id = t.employee_id::uuid;

-- El manager de Alfa supervisa a Elena (Alfa) y a Berta (Beta)
insert into public.manager_assignments (company_id, employee_id, manager_user_id, valid_from) values
  ('5eed2000-0000-4000-8000-00000000000a', '5eed6000-0000-4000-8000-000000000005', '5eed0000-0000-4000-8000-000000000004', now() - interval '6 months'),
  ('5eed2000-0000-4000-8000-00000000000b', '5eed6000-0000-4000-8000-000000000010', '5eed0000-0000-4000-8000-000000000004', now() - interval '6 months');

-- -----------------------------------------------------------------------------
-- Horarios sintéticos (fechas relativas a hoy para que siempre haya datos)
-- El festivo es INVENTADO para pruebas: en entornos reales los festivos se
-- registran o importan desde una fuente validada (docs/HORARIOS.md).
-- -----------------------------------------------------------------------------
insert into public.shift_templates (id, company_id, code, name) values
  ('5eed7000-0000-4000-8000-000000000001', '5eed2000-0000-4000-8000-00000000000a', 'M', 'Mañana'),
  ('5eed7000-0000-4000-8000-000000000002', '5eed2000-0000-4000-8000-00000000000a', 'N', 'Noche'),
  ('5eed7000-0000-4000-8000-000000000003', '5eed2000-0000-4000-8000-00000000000a', 'MJ', 'Media jornada');

insert into public.shift_template_versions (id, company_id, template_id, version, kind, target_minutes,
  tolerance_early_minutes, tolerance_late_minutes) values
  ('5eed7100-0000-4000-8000-000000000001', '5eed2000-0000-4000-8000-00000000000a', '5eed7000-0000-4000-8000-000000000001', 1, 'continuous', 450, 5, 10),
  ('5eed7100-0000-4000-8000-000000000002', '5eed2000-0000-4000-8000-00000000000a', '5eed7000-0000-4000-8000-000000000002', 1, 'night', 480, 5, 10),
  ('5eed7100-0000-4000-8000-000000000003', '5eed2000-0000-4000-8000-00000000000a', '5eed7000-0000-4000-8000-000000000003', 1, 'continuous', 240, 0, 0);

insert into public.shift_template_segments (company_id, version_id, position, start_minute, end_minute, kind, paid) values
  ('5eed2000-0000-4000-8000-00000000000a', '5eed7100-0000-4000-8000-000000000001', 1, 480, 720, 'work', true),
  ('5eed2000-0000-4000-8000-00000000000a', '5eed7100-0000-4000-8000-000000000001', 2, 720, 750, 'break', false),
  ('5eed2000-0000-4000-8000-00000000000a', '5eed7100-0000-4000-8000-000000000001', 3, 750, 990, 'work', true),
  ('5eed2000-0000-4000-8000-00000000000a', '5eed7100-0000-4000-8000-000000000002', 1, 1320, 1800, 'work', true),
  ('5eed2000-0000-4000-8000-00000000000a', '5eed7100-0000-4000-8000-000000000003', 1, 540, 780, 'work', true);

update public.shift_template_versions
set status = 'published', valid_from = current_date - 60, published_at = now() - interval '60 days'
where company_id = '5eed2000-0000-4000-8000-00000000000a';

insert into public.holiday_calendars (id, company_id, name, scope, applies_to_all_centers, source_reference)
values ('5eed7200-0000-4000-8000-000000000001', '5eed2000-0000-4000-8000-00000000000a',
  'Calendario sintético de pruebas', 'company', true, 'Datos sintéticos de desarrollo: no son festivos reales');
insert into public.holidays (company_id, calendar_id, holiday_date, name)
values ('5eed2000-0000-4000-8000-00000000000a', '5eed7200-0000-4000-8000-000000000001', current_date + 10,
  'Festivo sintético de prueba');

-- Equipo comercial de Alfa: mañana de lunes a viernes desde hace cuatro semanas.
-- Enzo: media jornada de lunes a viernes. Elena: excepción de noche dentro de 3 días.
insert into public.shift_assignments (id, company_id, scope_type, team_id, employee_id, valid_from,
  valid_to, cycle_days, anchor_date) values
  ('5eed7300-0000-4000-8000-000000000001', '5eed2000-0000-4000-8000-00000000000a', 'team', '5eed4000-0000-4000-8000-0000000000a1', null,
    current_date - 28, null, 7, current_date - extract(isodow from current_date)::int + 1 - 28),
  ('5eed7300-0000-4000-8000-000000000002', '5eed2000-0000-4000-8000-00000000000a', 'employee', null, '5eed6000-0000-4000-8000-000000000006',
    current_date - 28, null, 7, current_date - extract(isodow from current_date)::int + 1 - 28),
  ('5eed7300-0000-4000-8000-000000000003', '5eed2000-0000-4000-8000-00000000000a', 'exception', null, '5eed6000-0000-4000-8000-000000000005',
    current_date + 3, current_date + 5, 1, current_date + 3);

insert into public.shift_assignment_days (assignment_id, company_id, day_index, template_id)
select a.id, a.company_id, d.i, case when d.i < 5 then t.template_id end
from (values
  ('5eed7300-0000-4000-8000-000000000001'::uuid, '5eed7000-0000-4000-8000-000000000001'::uuid),
  ('5eed7300-0000-4000-8000-000000000002'::uuid, '5eed7000-0000-4000-8000-000000000003'::uuid)
) as t(assignment_id, template_id)
join public.shift_assignments a on a.id = t.assignment_id
cross join generate_series(0, 6) as d(i);
insert into public.shift_assignment_days (assignment_id, company_id, day_index, template_id) values
  ('5eed7300-0000-4000-8000-000000000003', '5eed2000-0000-4000-8000-00000000000a', 0, '5eed7000-0000-4000-8000-000000000002');

update public.shift_assignments
set status = 'published', published_at = now(), published_by = '5eed0000-0000-4000-8000-000000000003'
where company_id = '5eed2000-0000-4000-8000-00000000000a';
