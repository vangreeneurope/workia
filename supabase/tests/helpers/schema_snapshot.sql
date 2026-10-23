-- Descripción normalizada del esquema (una línea por objeto, ordenada).
-- La usa scripts/test-db.sh para comprobar que cada reversión deja el esquema
-- exactamente igual que antes de su migración. No depende del orden físico de
-- columnas ni del orden en que se concedieron los permisos.

with acl_text as (
  select a.acl, (
    select string_agg(
      format('%s:%s%s', case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end,
        x.privilege_type, case when x.is_grantable then '*' else '' end),
      ',' order by 1
    )
    from aclexplode(a.acl) x
  ) as txt
  from (
    select relacl as acl from pg_class where relacl is not null
    union select proacl from pg_proc where proacl is not null
    union select attacl from pg_attribute where attacl is not null
  ) a
),
lines as (
  select format('table %s.%s kind=%s rls=%s force=%s acl=%s', n.nspname, c.relname, c.relkind,
    c.relrowsecurity, c.relforcerowsecurity, (select txt from acl_text where acl = c.relacl)) as l
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm') and n.nspname in ('public', 'private')

  union all
  select format('column %s.%s.%s %s notnull=%s default=%s identity=%s generated=%s acl=%s',
    n.nspname, c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
    pg_get_expr(d.adbin, d.adrelid), a.attidentity, a.attgenerated,
    (select txt from acl_text where acl = a.attacl))
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'v')
    and n.nspname in ('public', 'private')

  union all
  select format('constraint %s.%s %s %s', n.nspname, c.relname, co.conname,
    pg_get_constraintdef(co.oid))
  from pg_constraint co
  join pg_class c on c.oid = co.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private')

  union all
  select format('index %s', indexdef) from pg_indexes where schemaname in ('public', 'private')

  union all
  select format('policy %s.%s %s %s %s permissive=%s using=%s check=%s', schemaname, tablename,
    policyname, cmd, roles, permissive, qual, with_check)
  from pg_policies
  where schemaname in ('public', 'private', 'storage')

  union all
  select format('function %s.%s(%s) returns %s secdef=%s volatile=%s config=%s acl=%s body=%s',
    n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid),
    p.prosecdef, p.provolatile, p.proconfig, (select txt from acl_text where acl = p.proacl),
    md5(p.prosrc))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')

  union all
  select format('trigger %s', pg_get_triggerdef(t.oid))
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in ('public', 'private', 'auth', 'storage')

  union all
  select format('enum %s.%s %s', n.nspname, t.typname,
    (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid))
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where t.typtype = 'e' and n.nspname in ('public', 'private')
)
select l from lines order by l;
