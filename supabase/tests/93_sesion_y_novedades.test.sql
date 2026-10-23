-- =============================================================================
-- Duración de la sesión por empresa (companies.session_max_minutes y
-- public.my_session_limit) y novedades vistas (profiles.last_seen_release).
-- Escenario: helpers/fixtures.sql (B cierra a los 30 minutos; E1 = u07 en A).
-- =============================================================================

\ir helpers/asserts.sql
\ir helpers/fixtures.sql

-- Permisos de la función: nada para anon.
select test.ok(not has_function_privilege('anon', 'public.my_session_limit()', 'execute')
  and has_function_privilege('authenticated', 'public.my_session_limit()', 'execute'),
  'my_session_limit: la ejecuta authenticated, nunca anon');

-- Valor que se aplica a cada persona.
set role authenticated;
select test.act_as(test.u(7));
select test.ok(public.my_session_limit() = 60, 'E1 (empresa A, por defecto): 60 minutos');
select test.act_as(test.u(11));
select test.ok(public.my_session_limit() = 30, 'EB (empresa B): 30 minutos');
select test.act_as(test.u(13));
select test.ok(public.my_session_limit() = 60, 'Sin membresía: 60 minutos por defecto');
select test.act_as(test.u(14));
select test.ok(public.my_session_limit() = 60,
  'Membresía caducada: no aplica el valor de esa empresa (60 por defecto)');
reset role;

-- Con membresías en varias empresas se aplica el valor más corto.
insert into public.company_memberships (company_id, user_id, valid_from) values
  (test.co('A'), test.u(13), now() - interval '1 day'),
  (test.co('B'), test.u(13), now() - interval '1 day');
set role authenticated;
select test.act_as(test.u(13));
select test.ok(public.my_session_limit() = 30, 'En A y B: se aplica el más corto (30 de B)');
reset role;

-- Quién lo cambia: la administración de la empresa (company.manage), con MFA.
set role authenticated;
select test.act_as(test.u(3));
select test.ok(test.affected(format(
  'update public.companies set session_max_minutes = 45 where id = %L', test.co('A'))) = 1,
  'company_admin de A cambia la duración de A');
select test.act_as(test.u(7));
select test.ok(public.my_session_limit() = 45, 'E1 recibe el nuevo valor de A (45)');
select test.act_as(test.u(3));
select test.ok(test.affected(format(
  'update public.companies set session_max_minutes = 20 where id = %L', test.co('B'))) = 0,
  'company_admin de A no cambia otra empresa (B)');
select test.act_as(test.u(3), 'aal1');
select test.ok(test.affected(format(
  'update public.companies set session_max_minutes = 20 where id = %L', test.co('A'))) = 0,
  'company_admin de A sin segundo factor no la cambia');
select test.act_as(test.u(4));
select test.ok(test.affected(format(
  'update public.companies set session_max_minutes = 20 where id = %L', test.co('A'))) = 0,
  'RR. HH. de A no la cambia (no gestiona la empresa)');
select test.act_as(test.u(7));
select test.ok(test.affected(format(
  'update public.companies set session_max_minutes = 720 where id = %L', test.co('A'))) = 0,
  'Una persona empleada no la cambia');
select test.act_as(test.u(14));
select test.ok(test.affected(format(
  'update public.companies set session_max_minutes = 720 where id = %L', test.co('A'))) = 0,
  'Membresía caducada: no la cambia');
select test.act_as(test.u(3));
select test.fails(format('update public.companies set session_max_minutes = 5 where id = %L', test.co('A')),
  'Fuera de rango (menos de 15 minutos): rechazado', 'companies_session_max_minutes_check');
select test.fails(format('update public.companies set session_max_minutes = 721 where id = %L', test.co('A')),
  'Fuera de rango (más de 12 horas): rechazado', 'companies_session_max_minutes_check');
reset role;

-- Novedades vistas: cada persona solo la suya y con formato vAA.N.
set role authenticated;
select test.act_as(test.u(7));
select test.ok(test.affected(format(
  'update public.profiles set last_seen_release = %L where id = %L', 'v26.30', test.u(7))) = 1,
  'E1 marca como vistas las novedades de v26.30');
select test.ok(test.affected(format(
  'update public.profiles set last_seen_release = %L where id = %L', 'v26.30', test.u(8))) = 0,
  'E1 no cambia las novedades vistas de otra persona');
select test.fails(format('update public.profiles set last_seen_release = %L where id = %L',
  '<script>', test.u(7)), 'Formato de versión no válido: rechazado', 'profiles_last_seen_release_check');
select test.fails(format('update public.profiles set email = %L where id = %L', 'x@example.test', test.u(7)),
  'El correo sigue sin poder cambiarse desde la API', 'permission denied');
reset role;

select test.ok((select last_seen_release = 'v26.30' from public.profiles where id = test.u(7)),
  'La versión vista queda guardada');
