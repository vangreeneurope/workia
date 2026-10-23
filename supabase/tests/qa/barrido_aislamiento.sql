-- Barrido genérico de aislamiento (auditoría QA): para cada atacante y cada
-- tabla de public con company_id (y storage.objects), filas visibles de
-- empresas que no le corresponden. Se ejecuta sobre una base poblada con los
-- escenarios de las pruebas de dominio (docs/qa/QA_REPORT.md, § 4).
create temp table qa_attackers (label text, uid uuid, allowed uuid[]);
grant all on qa_attackers to public;
insert into qa_attackers values
  ('EB empleado de B',            test.u(11), array[test.co('B')]),
  ('CB admin de B (aal2)',        test.u(12), array[test.co('B')]),
  ('X sin membresía',             test.u(13), array[]::uuid[]),
  ('EXP membresía caducada en A', test.u(14), array[]::uuid[]),
  ('EC empleado de C (grupo 2)',  test.u(15), array[test.co('C')]),
  ('CC admin de C (aal2)',        test.u(16), array[test.co('C')]),
  ('MOUT manager en C',           test.u(18), array[test.co('C')]),
  ('RREV RR. HH. revocado en A',  test.u(20), array[test.co('A')]),
  ('E1 empleado de A',            test.u(7),  array[test.co('A')]);

create temp table qa_leaks (attacker text, relation text, rows bigint);
create temp table qa_checked (total int default 0);
insert into qa_checked values (0);
grant all on qa_checked to public;
grant all on qa_leaks to public;

do $$
declare
  a record;
  t record;
  n bigint;
begin
  for a in select * from qa_attackers loop
    perform test.act_as(a.uid);
    for t in
      select c.relname from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      where ns.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from pg_attribute at where at.attrelid = c.oid and at.attname = 'company_id' and not at.attisdropped)
      order by 1
    loop
      begin
        execute 'set local role authenticated';
        execute format('select count(*) from public.%I where company_id <> all ($1)', t.relname) into n using a.allowed;
        execute 'reset role';
      exception when insufficient_privilege then
        n := 0; -- sin privilegio de lectura: inaccesible desde la API
        execute 'reset role';
      end;
      if n > 0 then insert into qa_leaks values (a.label, t.relname, n); end if;
      update qa_checked set total = total + 1;
    end loop;
    execute 'set local role authenticated';
    select count(*) into n from storage.objects o
      where split_part(o.name, '/', 1) <> ''
        and split_part(o.name, '/', 1) <> all (select x::text from unnest(a.allowed) x);
    execute 'reset role';
    if n > 0 then insert into qa_leaks values (a.label, 'storage.objects', n); end if;
  end loop;
end $$;

select attacker, relation, rows from qa_leaks order by 1, 2;
select 'atacantes=' || (select count(*) from qa_attackers) || ' comprobaciones=' || (select total from qa_checked);
-- Aserción: solo se admiten los registros propios de la persona con membresía caducada
-- (su membresía, su rol y la asignación en la que figuraba como manager).
do $$ begin
  if exists (select 1 from qa_leaks where not (attacker like 'EXP%'
      and relation in ('company_memberships', 'role_assignments', 'manager_assignments'))) then
    raise exception 'FUGA de aislamiento en lectura: %', (select string_agg(attacker || ' → ' || relation, '; ') from qa_leaks);
  end if;
  if (select total from qa_checked) < 500 then raise exception 'Barrido incompleto'; end if;
end $$;
