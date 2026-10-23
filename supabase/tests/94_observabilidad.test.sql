-- =============================================================================
-- Observabilidad: public.ops_metrics() devuelve solo agregados de la plataforma
-- (sin ids de empresa ni de persona), la ejecuta solo service_role y refleja
-- las colas: avisos pendientes, envío fallido, tareas programadas y cierre.
-- Escenario: helpers/fixtures.sql (E1 = u07/e07 supervisado por MGR = u06).
-- =============================================================================

\ir helpers/asserts.sql
\ir helpers/fixtures.sql

create or replace function test.next_monday() returns date language sql stable as $$
  select (now() at time zone 'Europe/Madrid')::date
    + (8 - extract(isodow from (now() at time zone 'Europe/Madrid')::date)::int) + 14 $$;
grant execute on function test.next_monday() to public;

-- Permisos: ni anon ni authenticated (ni siquiera administración de plataforma).
select test.ok(not has_function_privilege('anon', 'public.ops_metrics(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.ops_metrics(timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.ops_metrics(timestamptz)', 'execute'),
  'ops_metrics: solo service_role puede ejecutarla');

set role authenticated;
select test.act_as(test.u(1));
select test.fails($$ select public.ops_metrics() $$,
  'ops_metrics: la administración de plataforma con sesión no la ejecuta', 'permission denied');
reset role;

-- Estado base: estructura completa y valores numéricos.
set role service_role;
select test.ok((select public.ops_metrics() ?& array['generated_at', 'jobs', 'ocr', 'outbox', 'envios',
  'report_exports', 'scheduler', 'settlement']), 'ops_metrics: incluye todas las secciones');
select test.ok((select (public.ops_metrics() -> 'scheduler' ->> 'last_run_age_s')::bigint = -1),
  'ops_metrics: sin ejecuciones de tareas, la antigüedad es -1 (nunca ha corrido)');
reset role;

-- Una solicitud deja un evento pendiente en el outbox; una ejecución fallida de tareas.
set role authenticated;
select test.act_as(test.u(7));
-- Un lunes dentro de dos semanas (día laborable del escenario).
select public.submit_absence_request(test.co('A'), '7f000000-0000-4000-8000-000000000001', 'day',
  test.next_monday(), test.next_monday(), 'ab000000-0000-4000-8000-000000000001');
reset role;
select public.record_job_run('correo', now() - interval '2 minutes', false, '{}', 'step_failed');

set role service_role;
select test.ok((select (public.ops_metrics() -> 'outbox' ->> 'pending')::int >= 1),
  'ops_metrics: cuenta los avisos pendientes del outbox');
select test.ok((select (public.ops_metrics() -> 'scheduler' ->> 'failed_24h')::int = 1
  and (public.ops_metrics() -> 'scheduler' ->> 'last_run_age_s')::bigint between 0 and 600),
  'ops_metrics: cuenta las ejecuciones fallidas y la antigüedad de la última');
-- Antigüedad relativa al instante pedido (para alertas y pruebas reproducibles).
select test.ok((select (public.ops_metrics(now() + interval '1 hour') -> 'outbox' ->> 'oldest_pending_s')::int >= 3600),
  'ops_metrics: la antigüedad del pendiente más viejo se mide desde p_now');
reset role;

-- Sin datos de empresas ni personas: ningún uuid ni correo en la salida.
set role service_role;
select test.ok((select public.ops_metrics()::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-'
  and public.ops_metrics()::text !~ '@'), 'ops_metrics: la salida no contiene identificadores ni correos');
reset role;
