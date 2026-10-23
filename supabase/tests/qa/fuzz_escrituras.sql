-- Escrituras directas (vía PostgREST) contra filas de la empresa A (auditoría QA).
--  UPDATE: para cada columna con privilegio UPDATE de authenticated, el atacante
--          ejecuta "set col = col where company_id = A": debe afectar 0 filas.
--  INSERT: copia una fila real de A (leída como superusuario) con id nuevo y la
--          inserta como atacante con las columnas que tiene permitidas: debe
--          fallar por RLS (42501) o por privilegios. Un error de integridad
--          (23xxx) indicaría que RLS lo dejó pasar.
-- Control positivo: la administración de A sí puede actualizar filas de A.
\set QUIET on
create temp table qa_w (attacker text, op text, rel text, col text, outcome text);
grant all on qa_w to public;

do $do$
declare
  att record; c record; t record; n bigint; cols text; vals text; sample jsonb;
begin
  for att in select * from (values
      ('EB empleado de B', test.u(11)), ('CB admin de B', test.u(12)), ('X sin membresía', test.u(13)),
      ('EXP membresía caducada', test.u(14)), ('CC admin de C', test.u(16)), ('RREV hr revocado en A', test.u(20)),
      ('CONTROL admin de A', test.u(3))) v(label, uid)
  loop
    perform test.act_as(att.uid);
    for c in
      select cp.table_name, cp.column_name from information_schema.column_privileges cp
      where cp.grantee = 'authenticated' and cp.table_schema = 'public' and cp.privilege_type = 'UPDATE'
        and exists (select 1 from information_schema.columns ic where ic.table_schema = 'public'
          and ic.table_name = cp.table_name and ic.column_name = 'company_id')
      order by 1, 2
    loop
      begin
        execute 'set local role authenticated';
        execute format('update public.%I set %I = %I where company_id = %L', c.table_name, c.column_name, c.column_name, test.co('A'));
        get diagnostics n = row_count;
        execute 'reset role';
        insert into qa_w values (att.label, 'update', c.table_name, c.column_name, 'filas=' || n);
      exception when others then
        execute 'reset role';
        insert into qa_w values (att.label, 'update', c.table_name, c.column_name, 'error ' || sqlstate);
      end;
    end loop;

    for t in
      select cp.table_name, string_agg(quote_ident(cp.column_name), ', ' order by cp.column_name) as cols
      from information_schema.column_privileges cp
      where cp.grantee = 'authenticated' and cp.table_schema = 'public' and cp.privilege_type = 'INSERT'
        and cp.column_name not in ('id')
        and exists (select 1 from information_schema.columns ic where ic.table_schema = 'public'
          and ic.table_name = cp.table_name and ic.column_name = 'company_id')
      group by cp.table_name order by 1
    loop
      execute format('select to_jsonb(x) from public.%I x where company_id = %L limit 1', t.table_name, test.co('A')) into sample;
      if sample is null then
        insert into qa_w values (att.label, 'insert', t.table_name, null, 'sin muestra');
        continue;
      end if;
      begin
        execute 'set local role authenticated';
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, %L)',
          t.table_name, t.cols, t.cols, t.table_name, sample);
        execute 'reset role';
        insert into qa_w values (att.label, 'insert', t.table_name, null, 'insertada');
      exception when others then
        execute 'reset role';
        insert into qa_w values (att.label, 'insert', t.table_name, null, 'error ' || sqlstate || ' ' || left(sqlerrm, 70));
      end;
    end loop;
  end loop;
end $do$;

\set QUIET off
select 'intentos de atacantes=' || count(*) from qa_w where attacker not like 'CONTROL%';
-- Hallazgos: actualizaciones con filas afectadas o inserciones que pasan RLS.
select attacker, op, rel, col, outcome from qa_w
where attacker not like 'CONTROL%'
  and (outcome ~ '^filas=[1-9]' or outcome = 'insertada' or outcome ~ '^error 23')
order by 1, 2, 3;
select 'control positivo (admin de A): updates con filas = ' || count(*) from qa_w
where attacker like 'CONTROL%' and outcome ~ '^filas=[1-9]';
select op, split_part(outcome, ' ', 1) || ' ' || split_part(outcome, ' ', 2) as resultado, count(*)
from qa_w where attacker not like 'CONTROL%' group by 1, 2 order by 1, 2;
