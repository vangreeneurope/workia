-- =============================================================================
-- Las semillas sintéticas se cargan sobre las migraciones y respetan el
-- aislamiento. Protege frente a semillas rotas o con datos que parezcan reales.
-- =============================================================================

\ir helpers/asserts.sql
\ir ../seeds/01_demo_sintetico.sql

select test.ok((select count(*) from public.companies) = 2, 'Semilla: dos empresas');
select test.ok((select count(*) from public.employees) = 6, 'Semilla: seis fichas de empleado');
select test.ok((select count(*) from public.profiles) = 10, 'Semilla: un perfil por cuenta');
select test.ok(not exists (select 1 from auth.users where email not like '%.example'),
  'Semilla: todos los correos usan el dominio reservado .example');
select test.ok(not exists (select 1 from auth.users where coalesce(encrypted_password, '') <> ''),
  'Semilla: ninguna cuenta tiene contraseña en el repositorio');
select test.ok(not exists (select 1 from auth.users where raw_app_meta_data ? 'roles'
  or raw_user_meta_data ? 'roles' or raw_user_meta_data ? 'role'),
  'Semilla: ningún permiso vive en los metadatos de Auth');
select test.ok(not exists (select 1 from public.companies where tax_id is not null),
  'Semilla: sin NIF que pueda coincidir con uno real');

set role authenticated;

select test.act_as('5eed0000-0000-4000-8000-000000000005'); -- Elena, empleada de Alfa
select test.ok((select count(*) from public.employees) = 1, 'Semilla: la empleada solo ve su ficha');
select test.ok((select array_agg(slug) from public.companies) = '{alfa-demo}', 'Semilla: y solo su empresa');

select test.act_as('5eed0000-0000-4000-8000-000000000004'); -- Mario, manager
select test.ok((select count(*) from public.employees) = 3, 'Semilla: el manager ve su ficha y sus 2 supervisadas');
select test.ok((select count(*) from public.employees where id = '5eed6000-0000-4000-8000-000000000006') = 0,
  'Semilla: el manager no ve a quien no supervisa');

select test.act_as('5eed0000-0000-4000-8000-000000000009'); -- Bruno, admin de Beta
select test.ok((select count(*) from public.employees) = 1, 'Semilla: la administración de Beta solo ve Beta');

select test.act_as('5eed0000-0000-4000-8000-000000000007'); -- Carla, contabilidad de Alfa
select test.ok((select count(*) from public.employees) = 5, 'Semilla: contabilidad ve las fichas de Alfa');
select test.ok((select array_agg(employee_id) from public.employment_terms)
  = array['5eed6000-0000-4000-8000-000000000007'::uuid],
  'Semilla: de las condiciones laborales solo ve las suyas');

select test.act_as('5eed0000-0000-4000-8000-000000000005'); -- Elena
select test.ok((select count(*) from public.shift_assignments) = 2,
  'Semilla: la empleada ve el horario de su equipo y su excepción');
select test.act_as('5eed0000-0000-4000-8000-000000000006'); -- Enzo
select test.ok((select count(*) from public.shift_assignments) = 1, 'Semilla: Enzo solo ve el suyo');
select test.act_as('5eed0000-0000-4000-8000-000000000009'); -- Bruno, admin de Beta
select test.ok(not exists (select 1 from public.shift_templates), 'Semilla: Beta no ve plantillas de Alfa');
reset role;
select test.ok(not exists (select 1 from public.holidays where name not like '%sintético%')
  and not exists (select 1 from public.holiday_calendars where source_reference not like 'Datos sintéticos%'),
  'Semilla: los únicos festivos son sintéticos y lo declaran en su fuente');
select test.ok((select status = 'closed' and worked_seconds = (7 * 60 + 13) * 60 from public.time_entries
  where employee_id = '5eed6000-0000-4000-8000-000000000005'), 'Semilla: jornada sintética de ayer recalculada');
select test.ok(not exists (select 1 from public.kiosk_pins), 'Semilla: sin PIN en el repositorio');
set role authenticated;
select test.act_as('5eed0000-0000-4000-8000-000000000001'); -- Gala, admin de grupo
select test.ok((select count(*) from public.employees) = 6, 'Semilla: la administración de grupo ve ambas empresas');
reset role;

\echo 'Semillas sintéticas verificadas.'
