-- Ataque genérico a las funciones SECURITY DEFINER ejecutables por authenticated
-- (auditoría QA). Cada atacante (otra empresa, otro grupo, sin membresía,
-- membresía caducada, rol revocado) llama a cada función con identificadores
-- reales de la empresa A. Resultado por llamada: rechazada (SQLSTATE) o
-- devuelta (y qué). Al final se compara la huella de los datos de A antes y
-- después: ninguna llamada debe haber modificado nada de A.
\set QUIET on
create temp table qa_cand (param text, id uuid);
grant all on qa_cand to public;
insert into qa_cand
  select 'p_company', test.co('A')
  union all select 'p_employee', id from public.employees where company_id = test.co('A')
  union all select 'p_request', id from public.absence_requests where company_id = test.co('A')
  union all select 'p_request', id from public.time_correction_requests where company_id = test.co('A')
  union all select 'p_request', id from public.data_subject_requests where company_id = test.co('A')
  union all select 'p_expense', id from public.expenses where company_id = test.co('A')
  union all select 'p_report', id from public.expense_reports where company_id = test.co('A')
  union all select 'p_item', id from public.expense_report_items where company_id = test.co('A')
  union all select 'p_batch', id from public.accounting_batches where company_id = test.co('A')
  union all select 'p_export', id from public.report_exports where company_id = test.co('A')
  union all select 'p_export', id from public.accounting_exports where company_id = test.co('A')
  union all select 'p_attachment', id from public.absence_attachments where company_id = test.co('A')
  union all select 'p_notification', id from public.notifications where company_id = test.co('A')
  union all select 'p_punch', id from public.punches where company_id = test.co('A')
  union all select 'p_job', id from public.jobs where company_id = test.co('A')
  union all select 'p_run', id from public.ocr_runs where company_id = test.co('A')
  union all select 'p_policy', id from public.vacation_policies where company_id = test.co('A')
  union all select 'p_type', id from public.absence_types where company_id = test.co('A')
  union all select 'p_version', id from public.shift_template_versions where company_id = test.co('A')
  union all select 'p_version', id from public.vacation_policy_versions where company_id = test.co('A')
  union all select 'p_template', id from public.shift_templates where company_id = test.co('A')
  union all select 'p_id', id from public.shift_assignments where company_id = test.co('A')
  union all select 'p_assignment', id from public.shift_assignments where company_id = test.co('A')
  union all select 'p_incident', id from public.time_incidents where company_id = test.co('A')
  union all select 'p_entry', id from public.time_entries where company_id = test.co('A')
  union all select 'p_delivery', id from public.email_deliveries where company_id = test.co('A')
  union all select 'p_grant', id from public.support_access_grants where company_id = test.co('A')
  union all select 'p_hold', id from public.legal_holds where company_id = test.co('A')
  union all select 'p_work_center', id from public.work_centers where company_id = test.co('A')
  union all select 'p_center', id from public.work_centers where company_id = test.co('A')
  union all select 'p_team', id from public.teams where company_id = test.co('A')
  union all select 'p_actor', test.u(4)
  union all select 'p_support_user', test.u(1);

create temp table qa_calls (attacker text, fn text, param text, victim uuid, outcome text, detail text);
grant all on qa_calls to public;

-- Huella de los datos de A (superusuario).
create or replace function pg_temp.fingerprint() returns text language plpgsql as $f$
declare t record; acc text := ''; h text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id')
      and c.relname not in ('audit_events', 'audit_log') order by 1
  loop
    execute format('select md5(coalesce(string_agg(x::text, ''|'' order by x::text), '''')) from public.%I x where company_id = %L',
      t.relname, test.co('A')) into h;
    acc := acc || t.relname || ':' || h || ';';
  end loop;
  return md5(acc);
end $f$;

create temp table qa_fp (stage text, fp text);
insert into qa_fp values ('antes', pg_temp.fingerprint());

do $do$
declare
  att record; fn record; arg record;
  args text[]; primary_param text; victim uuid; cand record;
  sql text; res text; n_ok int;
begin
  for att in select * from (values
      ('EB empleado de B', test.u(11)), ('CB admin de B', test.u(12)), ('X sin membresía', test.u(13)),
      ('EXP membresía caducada', test.u(14)), ('CC admin de C', test.u(16)), ('MOUT manager en C', test.u(18)),
      ('RREV hr revocado en A', test.u(20)),
      -- Control positivo: RR. HH. de A SÍ debe obtener datos (demuestra que el arnés detecta contenido).
      ('CONTROL hr de A', test.u(4))) v(label, uid)
  loop
    -- El control positivo (último) puede escribir legítimamente en A: la huella
    -- «después» se toma justo antes de él, tras todos los atacantes.
    if att.label like 'CONTROL%' then
      insert into qa_fp values ('después', pg_temp.fingerprint());
    end if;
    perform test.act_as(att.uid);
    for fn in
      select p.oid, p.proname, p.proretset, p.pronargs
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
        and p.proname not in ('kiosk_device_info', 'kiosk_punch')
      order by p.proname
    loop
      -- Parámetro principal: el primer uuid con candidatos; se prueba con cada candidato.
      select a.name into primary_param from (
        select (p.proargnames)[i] as name, (p.proargtypes::oid[])[i - 1] as typ
        from pg_proc p, generate_series(1, p.pronargs) i where p.oid = fn.oid
      ) a where a.typ = 'uuid'::regtype and exists (select 1 from qa_cand c where c.param = a.name) limit 1;
      for cand in
        select id from qa_cand where param = primary_param
        union all select null::uuid where primary_param is null
      loop
        args := '{}';
        for arg in
          -- Solo parámetros de entrada (proargnames incluye también las columnas de salida).
          select a.name, a.typ, a.ord from (
            select (p.proargnames)[i] as name, (p.proargtypes::oid[])[i - 1] as typ, i as ord
            from pg_proc p, generate_series(1, p.pronargs) i where p.oid = fn.oid) a order by a.ord
        loop
          args := args || case
            when arg.typ = 'uuid'::regtype then
              coalesce(quote_literal(case when arg.name = primary_param then cand.id
                else (select id from qa_cand c where c.param = arg.name limit 1) end), 'null') || '::uuid'
            when arg.typ = 'uuid[]'::regtype then
              coalesce('array[' || (select string_agg(quote_literal(id), ',') from qa_cand c
                where c.param in ('p_notification', 'p_employee') ) || ']::uuid[]', '''{}''::uuid[]')
            when arg.typ = 'text'::regtype then case arg.name
              when 'p_decision' then '''approve''' when 'p_action' then '''approve'''
              when 'p_status' then '''approved''' when 'p_format' then '''csv'''
              when 'p_report' then '''jornada-diaria''' when 'p_kind' then '''access'''
              when 'p_group' then '''employee'''
              when 'p_mime' then '''application/pdf''' when 'p_sha256' then quote_literal(repeat('a', 64))
              else '''qa''' end
            when arg.typ in ('integer'::regtype, 'bigint'::regtype) then '1'
            when arg.typ = 'smallint'::regtype then '1::smallint'
            when arg.typ = 'boolean'::regtype then 'true'
            when arg.typ = 'date'::regtype then 'current_date'
            when arg.typ = 'timestamptz'::regtype then 'now()'
            when arg.typ = 'jsonb'::regtype then '''{}''::jsonb'
            when arg.typ = 'text[]'::regtype then '''{}''::text[]'
            when (select typtype from pg_type where oid = arg.typ) = 'e' then
              quote_literal((select enumlabel from pg_enum where enumtypid = arg.typ order by enumsortorder limit 1))
                || '::' || arg.typ::regtype::text
            else 'null' end;
        end loop;
        sql := format(case when fn.proretset then 'select count(*)::text from public.%I(%s) x'
                           else 'select left(coalesce(public.%I(%s)::text, ''<null>''), 200)' end,
                      fn.proname, array_to_string(args, ', '));
        begin
          execute 'set local role authenticated';
          execute sql into res;
          execute 'reset role';
          insert into qa_calls values (att.label, fn.proname, primary_param, cand.id, 'devuelta', res);
        exception when others then
          execute 'reset role';
          insert into qa_calls values (att.label, fn.proname, primary_param, cand.id, 'rechazada ' || sqlstate, left(sqlerrm, 120));
        end;
      end loop;
    end loop;
  end loop;
end $do$;

\set QUIET off
select 'llamadas de atacantes=' || count(*) || ' rechazadas=' || count(*) filter (where outcome like 'rechazada%')
  || ' devueltas=' || count(*) filter (where outcome = 'devuelta')
  || ' funciones=' || count(distinct fn) from qa_calls where attacker not like 'CONTROL%';
select 'huella A sin cambios: ' || ((select fp from qa_fp where stage = 'antes') = (select fp from qa_fp where stage = 'después'));
-- Devueltas con contenido (a revisar): ni vacías, ni 0, ni false, ni null.
select fn, detail, count(*) as veces, string_agg(distinct attacker, ', ') as atacantes
from qa_calls where outcome = 'devuelta' and detail not in ('0', 'false', '<null>', '[]', '{}', '')
  and attacker not like 'CONTROL%'
group by fn, detail order by fn;
select 'control positivo: funciones con contenido para RR. HH. de A = ' || count(distinct fn)
from qa_calls where attacker like 'CONTROL%' and outcome = 'devuelta'
  and detail not in ('0', 'false', '<null>', '[]', '{}', '');
-- Motivos de rechazo por función (42501 = permiso; otros = validación o estado).
select fn, string_agg(distinct split_part(outcome, ' ', 2) || ':' || left(detail, 60), ' | ') as motivos
from qa_calls where outcome like 'rechazada%' and attacker not like 'CONTROL%' group by fn order by fn;
