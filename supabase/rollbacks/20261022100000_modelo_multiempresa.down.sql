-- =============================================================================
-- Reversión de 20261022100000_modelo_multiempresa.sql
--
-- Deja el esquema exactamente como tras 20261021090200_storage_logos.sql
-- (verificado por scripts/test-db.sh, comprobación de reversibilidad).
-- Requiere haber revertido antes 20261022100100_empleados.
--
-- Pérdida de datos: grupos, administradores de grupo, centros, equipos, roles
-- con ámbito distinto de empresa y los roles hr/auditor (no existen en el
-- modelo anterior). La auditoría ya escrita se conserva salvo su columna
-- group_id. Si hay datos que se perderían, aborta salvo que se ejecute antes:
--   set app.allow_lossy_rollback = 'on';
-- =============================================================================

do $$
begin
  if coalesce(current_setting('app.allow_lossy_rollback', true), 'off') <> 'on' and (
    exists (select 1 from public.group_admins)
    or exists (select 1 from public.work_centers)
    or exists (select 1 from public.teams)
    or (select count(*) from public.groups) > 1
    or exists (select 1 from public.role_assignments
               where scope_type <> 'company' or role in ('hr', 'auditor'))
    or exists (select 1 from public.company_memberships where status in ('invited', 'suspended'))
  ) then
    raise exception 'La reversión perdería datos del modelo multiempresa. Revisa docs/BASE_DATOS.md y usa app.allow_lossy_rollback si es intencionado.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Políticas del modelo nuevo
-- -----------------------------------------------------------------------------

drop policy "groups_select" on public.groups;
drop policy "groups_insert" on public.groups;
drop policy "groups_update" on public.groups;
drop policy "group_admins_select" on public.group_admins;
drop policy "group_admins_insert" on public.group_admins;
drop policy "group_admins_update" on public.group_admins;
drop policy "companies_select" on public.companies;
drop policy "companies_insert" on public.companies;
drop policy "companies_update" on public.companies;
drop policy "profiles_select" on public.profiles;
drop policy "work_centers_select" on public.work_centers;
drop policy "work_centers_insert" on public.work_centers;
drop policy "work_centers_update" on public.work_centers;
drop policy "teams_select" on public.teams;
drop policy "teams_insert" on public.teams;
drop policy "teams_update" on public.teams;
drop policy "memberships_select" on public.company_memberships;
drop policy "memberships_insert" on public.company_memberships;
drop policy "memberships_update" on public.company_memberships;
drop policy "role_assignments_select" on public.role_assignments;
drop policy "role_assignments_insert" on public.role_assignments;
drop policy "role_assignments_update" on public.role_assignments;
drop policy "manager_assignments_select" on public.manager_assignments;
drop policy "manager_assignments_insert" on public.manager_assignments;
drop policy "manager_assignments_delete" on public.manager_assignments;
drop policy "audit_log_select" on public.audit_log;
drop policy "company_logos_select" on storage.objects;
drop policy "company_logos_insert" on storage.objects;
drop policy "company_logos_update" on storage.objects;
drop policy "company_logos_delete" on storage.objects;

drop trigger companies_keys on public.companies;
drop trigger companies_guard on public.companies;
drop trigger company_memberships_keys on public.company_memberships;
drop trigger audit_companies on public.companies;

-- -----------------------------------------------------------------------------
-- Columnas del modelo anterior
-- -----------------------------------------------------------------------------

create type public.company_role as enum (
  'company_admin', -- Administrador de empresa / RR. HH.
  'manager',       -- Manager o responsable
  'employee',      -- Empleado / comercial
  'accounting'     -- Contabilidad
);

alter table public.companies add column active boolean not null default true;
update public.companies set active = (status = 'active');

alter table public.company_memberships
  add column roles public.company_role[] not null default array['employee']::public.company_role[]
    check (cardinality(roles) between 1 and 4),
  add column active boolean not null default true,
  add column start_date date not null default current_date,
  add column end_date date check (end_date is null or end_date >= start_date);

update public.company_memberships m set
  roles = coalesce((
    select array_agg(distinct ra.role::text::public.company_role)
    from public.role_assignments ra
    where ra.membership_id = m.id
      and ra.status = 'active'
      and ra.scope_type = 'company'
      and ra.role in ('company_admin', 'manager', 'employee', 'accounting')
  ), array['employee']::public.company_role[]),
  active = (m.status = 'active'),
  start_date = (m.valid_from at time zone 'Europe/Madrid')::date,
  end_date = case
    when m.valid_to is not null then greatest(
      (m.valid_from at time zone 'Europe/Madrid')::date,
      (m.valid_to at time zone 'Europe/Madrid')::date - 1
    )
  end;

drop index public.company_memberships_user_idx;
drop index public.company_memberships_company_idx;
alter table public.company_memberships
  drop column status,
  drop column valid_from,
  drop column valid_to;
create index company_memberships_user_idx on public.company_memberships (user_id) where active;

-- -----------------------------------------------------------------------------
-- Tablas, columnas y tipos nuevos
-- -----------------------------------------------------------------------------

drop table public.role_assignments;
drop table public.teams;
drop table public.work_centers;
alter table public.companies drop column group_id, drop column status;
alter table public.companies add constraint companies_slug_key unique (slug);
drop table public.group_admins;
drop table public.groups;
alter table public.audit_log drop column group_id;

drop function private.guard_company_update();
drop function private.can_read_user(uuid);
drop function private.is_own_membership(uuid);
drop function private.can_grant_role(uuid, public.app_role);
drop function private.has_company_role(uuid, public.app_role[]);
drop function private.has_permission(uuid, private.app_permission, uuid, uuid);
drop function private.role_has_permission(public.app_role, private.app_permission);
drop function private.has_current_membership_in_group(uuid);
drop function private.user_has_current_membership_in_group(uuid, uuid);
drop function private.is_group_admin_of_company(uuid);
drop function private.is_group_admin(uuid);
drop function private.set_granted_by();
drop function private.prevent_key_change();

-- -----------------------------------------------------------------------------
-- Funciones del modelo anterior (texto idéntico al de las migraciones base)
-- -----------------------------------------------------------------------------

create or replace function private.has_company_role(
  target_company uuid,
  allowed public.company_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_memberships m
    join public.companies c on c.id = m.company_id
    where m.company_id = target_company
      and m.user_id = (select auth.uid())
      and m.active
      and c.active
      and m.roles && allowed
  );
$$;

create or replace function private.is_company_member(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_company_role(
    target_company,
    array['company_admin', 'manager', 'employee', 'accounting']::public.company_role[]
  );
$$;

create or replace function private.manages_in_company(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.manager_assignments a
    join public.company_memberships m on m.id = a.employee_membership_id
    where a.company_id = target_company
      and a.manager_user_id = (select auth.uid())
      and m.active
  );
$$;

create or replace function private.manages_membership(target_membership uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.manager_assignments a
    where a.employee_membership_id = target_membership
      and a.manager_user_id = (select auth.uid())
  );
$$;

create or replace function private.manages_user(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.manager_assignments a
    join public.company_memberships m on m.id = a.employee_membership_id
    where m.user_id = target_user
      and a.manager_user_id = (select auth.uid())
  );
$$;

create or replace function private.is_hr_of_user(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_memberships m
    where m.user_id = target_user
      and private.has_company_role(m.company_id, array['company_admin']::public.company_role[])
  );
$$;

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

drop function private.current_membership_id(uuid);
drop function private.is_active_window(timestamptz, timestamptz);
drop type private.app_permission;
drop type public.app_role;
drop type public.role_scope;
drop type public.grant_status;
drop type public.membership_status;
drop type public.entity_status;

revoke all on function
  private.has_company_role(uuid, public.company_role[]),
  private.is_hr_of_user(uuid)
from public;
grant execute on function
  private.has_company_role(uuid, public.company_role[]),
  private.is_hr_of_user(uuid)
to authenticated, service_role;

create trigger audit_companies after insert or update or delete on public.companies
  for each row execute function private.audit_row_change('id');

-- -----------------------------------------------------------------------------
-- Privilegios y políticas del modelo anterior
-- -----------------------------------------------------------------------------

revoke all on public.companies, public.company_memberships from anon, authenticated;
grant select, insert, update on public.companies to authenticated;
grant select, insert on public.company_memberships to authenticated;
grant update (roles, job_title, active, start_date, end_date) on public.company_memberships
  to authenticated;

create policy "companies_select" on public.companies
  for select to authenticated
  using (
    private.is_global_admin()
    or private.is_company_member(id)
    or private.manages_in_company(id)
  );

create policy "companies_insert_global_admin" on public.companies
  for insert to authenticated
  with check (private.is_global_admin());

create policy "companies_update_global_admin" on public.companies
  for update to authenticated
  using (private.is_global_admin())
  with check (private.is_global_admin());

create policy "profiles_select" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_global_admin()
    or private.is_hr_of_user(id)
    or private.manages_user(id)
  );

create policy "memberships_select" on public.company_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_global_admin()
    or private.has_company_role(company_id, array['company_admin']::public.company_role[])
    or private.manages_membership(id)
  );

create policy "memberships_insert" on public.company_memberships
  for insert to authenticated
  with check (
    private.is_global_admin()
    or private.has_company_role(company_id, array['company_admin']::public.company_role[])
  );

create policy "memberships_update" on public.company_memberships
  for update to authenticated
  using (
    private.is_global_admin()
    or private.has_company_role(company_id, array['company_admin']::public.company_role[])
  )
  with check (
    private.is_global_admin()
    or private.has_company_role(company_id, array['company_admin']::public.company_role[])
  );

create policy "manager_assignments_select" on public.manager_assignments
  for select to authenticated
  using (
    manager_user_id = (select auth.uid())
    or private.is_global_admin()
    or private.has_company_role(company_id, array['company_admin']::public.company_role[])
    or exists (
      select 1 from public.company_memberships m
      where m.id = employee_membership_id and m.user_id = (select auth.uid())
    )
  );

create policy "manager_assignments_insert" on public.manager_assignments
  for insert to authenticated
  with check (
    private.is_global_admin()
    or private.has_company_role(company_id, array['company_admin']::public.company_role[])
  );

create policy "manager_assignments_delete" on public.manager_assignments
  for delete to authenticated
  using (
    private.is_global_admin()
    or private.has_company_role(company_id, array['company_admin']::public.company_role[])
  );

create policy "audit_log_select" on public.audit_log
  for select to authenticated
  using (
    private.is_global_admin()
    or (
      company_id is not null
      and private.has_company_role(company_id, array['company_admin']::public.company_role[])
    )
  );

create policy "company_logos_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'company-logos'
    and (
      private.is_global_admin()
      or private.is_company_member(private.object_company_id(name))
      or private.manages_in_company(private.object_company_id(name))
    )
  );

create policy "company_logos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'company-logos' and private.is_global_admin());

create policy "company_logos_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'company-logos' and private.is_global_admin())
  with check (bucket_id = 'company-logos' and private.is_global_admin());

create policy "company_logos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'company-logos' and private.is_global_admin());
