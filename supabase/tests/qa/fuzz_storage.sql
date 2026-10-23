-- Storage (auditoría QA): un atacante no puede leer, crear, sobrescribir ni
-- borrar objetos en rutas de la empresa A de ningún bucket.
\set QUIET on
create temp table qa_s (attacker text, op text, bucket text, outcome text);
grant all on qa_s to public;
do $do$
declare att record; b record; n bigint; m bigint;
begin
  for att in select * from (values
      ('EB empleado de B', test.u(11)), ('CB admin de B', test.u(12)), ('X sin membresía', test.u(13)),
      ('EXP membresía caducada', test.u(14)), ('CC admin de C', test.u(16))) v(label, uid)
  loop
    perform test.act_as(att.uid);
    for b in select id from storage.buckets order by 1 loop
      begin
        execute 'set local role authenticated';
        execute format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)',
          b.id, test.co('A') || '/qa/intruso.pdf', att.uid);
        execute 'reset role';
        insert into qa_s values (att.label, 'insert', b.id, 'insertado');
      exception when others then
        execute 'reset role';
        insert into qa_s values (att.label, 'insert', b.id, 'error ' || sqlstate);
      end;
      begin
        execute 'set local role authenticated';
        execute format('update storage.objects set name = name where bucket_id = %L and name like %L', b.id, test.co('A') || '/%');
        get diagnostics n = row_count;
        execute format('delete from storage.objects where bucket_id = %L and name like %L', b.id, test.co('A') || '/%');
        get diagnostics m = row_count;
        n := n + m;
        execute 'reset role';
        insert into qa_s values (att.label, 'update+delete', b.id, 'filas=' || n);
      exception when others then
        execute 'reset role';
        insert into qa_s values (att.label, 'update+delete', b.id, 'error ' || sqlstate);
      end;
    end loop;
  end loop;
end $do$;
\set QUIET off
select op, outcome, count(*) from qa_s group by 1, 2 order by 1, 2;
select 'objetos de A intactos: ' || count(*) from storage.objects where name like test.co('A') || '/%';
do $$ begin
  if exists (select 1 from qa_s where outcome = 'insertado' or outcome ~ '^filas=[1-9]') then
    raise exception 'FUGA: un atacante creó, modificó o borró objetos de A en Storage';
  end if;
end $$;
