-- =============================================================================
-- Auditoría: registro append-only de cambios relevantes.
-- Las filas solo se insertan desde triggers SECURITY DEFINER; nadie (ni siquiera
-- service_role) puede modificarlas o borrarlas a través de la API.
-- =============================================================================

create table public.audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,                -- auth.uid() del causante; null = sistema/servicio
  company_id  uuid,                -- empresa afectada (para filtrar por RLS)
  table_name  text not null,
  record_id   text not null,
  action      text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data    jsonb,
  new_data    jsonb
);

comment on table public.audit_log is 'Auditoría inmutable de cambios relevantes. Ver docs/NORMATIVA.md (conservación).';

create index audit_log_company_idx on public.audit_log (company_id, occurred_at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);

-- Inmutabilidad: bloquea UPDATE y DELETE para cualquier rol.
create or replace function private.prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'La tabla % es inmutable: no se permite %', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function private.prevent_mutation();

create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.prevent_mutation();

-- Trigger genérico. Argumento opcional: nombre de la columna con la empresa.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_column text := tg_argv[0];
  row_data jsonb;
  company uuid;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if company_column is not null then
    company := (row_data ->> company_column)::uuid;
  end if;

  insert into public.audit_log (actor_id, company_id, table_name, record_id, action, old_data, new_data)
  values (
    (select auth.uid()),
    company,
    tg_table_name,
    coalesce(row_data ->> 'id', row_data ->> 'user_id', ''),
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end;
$$;

revoke all on function private.audit_row_change() from public;
revoke all on function private.prevent_mutation() from public;

create trigger audit_companies after insert or update or delete on public.companies
  for each row execute function private.audit_row_change('id');
create trigger audit_company_memberships after insert or update or delete on public.company_memberships
  for each row execute function private.audit_row_change('company_id');
create trigger audit_manager_assignments after insert or update or delete on public.manager_assignments
  for each row execute function private.audit_row_change('company_id');
create trigger audit_platform_admins after insert or update or delete on public.platform_admins
  for each row execute function private.audit_row_change();
create trigger audit_profiles after update on public.profiles
  for each row execute function private.audit_row_change();

-- Privilegios y RLS -----------------------------------------------------------
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

alter table public.audit_log enable row level security;

create policy "audit_log_select" on public.audit_log
  for select to authenticated
  using (
    private.is_global_admin()
    or (
      company_id is not null
      and private.has_company_role(company_id, array['company_admin']::public.company_role[])
    )
  );
