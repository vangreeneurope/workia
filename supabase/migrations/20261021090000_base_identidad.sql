-- =============================================================================
-- Migración base: identidad, empresas, membresías, roles y asignaciones de manager.
-- Ver docs/BASE_DATOS.md y docs/PERMISOS.md.
--
-- Convenciones:
--   * Identificadores en inglés (snake_case); textos de interfaz en español.
--   * Toda tabla de "public" tiene RLS activada y privilegios explícitos.
--   * Las funciones de autorización viven en el esquema "private", que la API
--     REST de Supabase no expone, y son SECURITY DEFINER con search_path vacío.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------

-- Roles dentro de una empresa. El administrador global NO es un rol de empresa:
-- se modela aparte en public.platform_admins.
create type public.company_role as enum (
  'company_admin', -- Administrador de empresa / RR. HH.
  'manager',       -- Manager o responsable
  'employee',      -- Empleado / comercial
  'accounting'     -- Contabilidad
);

-- -----------------------------------------------------------------------------
-- Utilidades
-- -----------------------------------------------------------------------------

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tablas
-- -----------------------------------------------------------------------------

create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 2 and 120),
  legal_name    text check (legal_name is null or char_length(legal_name) <= 200),
  tax_id        text check (tax_id is null or tax_id ~ '^[A-Z0-9]{8,12}$'),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Identidad visual. El color se valida para evitar inyección CSS.
  primary_color text not null default '#1f2937' check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_path     text check (logo_path is null or logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]+$'),
  timezone      text not null default 'Europe/Madrid',
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.companies is 'Empresas del grupo. Cada una con su identidad visual y políticas.';

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text not null default '' check (char_length(full_name) <= 160),
  phone      text check (phone is null or phone ~ '^\+?[0-9 ]{6,20}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Datos personales mínimos del usuario (1:1 con auth.users).';

create table public.platform_admins (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);

comment on table public.platform_admins is 'Administradores globales del grupo. Solo se gestiona con service_role o SQL.';

create table public.company_memberships (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  user_id     uuid not null references public.profiles (id) on delete restrict,
  roles       public.company_role[] not null default array['employee']::public.company_role[]
              check (cardinality(roles) between 1 and 4),
  job_title   text check (job_title is null or char_length(job_title) <= 120),
  active      boolean not null default true,
  start_date  date not null default current_date,
  end_date    date check (end_date is null or end_date >= start_date),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, user_id),
  -- Permite claves foráneas compuestas que garantizan coherencia de empresa.
  unique (id, company_id)
);

comment on table public.company_memberships is 'Pertenencia de un usuario a una empresa con uno o varios roles.';

create index company_memberships_user_idx on public.company_memberships (user_id) where active;

-- Un manager puede supervisar a empleados de cualquier empresa del grupo.
create table public.manager_assignments (
  id                      uuid primary key default gen_random_uuid(),
  manager_user_id         uuid not null references public.profiles (id) on delete cascade,
  employee_membership_id  uuid not null,
  company_id              uuid not null,
  created_at              timestamptz not null default now(),
  created_by              uuid references public.profiles (id) on delete set null,
  unique (manager_user_id, employee_membership_id),
  foreign key (employee_membership_id, company_id)
    references public.company_memberships (id, company_id) on delete cascade
);

comment on table public.manager_assignments is 'Relación manager -> empleado (membresía). Puede cruzar empresas.';

create index manager_assignments_manager_idx on public.manager_assignments (manager_user_id);
create index manager_assignments_company_idx on public.manager_assignments (company_id);

create trigger companies_updated_at before update on public.companies
  for each row execute function private.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger company_memberships_updated_at before update on public.company_memberships
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Funciones de autorización (usadas por las políticas RLS)
-- SECURITY DEFINER evita recursión de RLS y fija el comportamiento.
-- -----------------------------------------------------------------------------

create or replace function private.is_global_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())
  );
$$;

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

-- ¿El usuario actual supervisa a alguien en esa empresa?
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

-- ¿El usuario actual supervisa esa membresía concreta?
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

-- ¿El usuario actual supervisa a ese usuario en alguna empresa?
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

-- ¿Comparte el usuario actual alguna empresa como RR. HH. con ese usuario?
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

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Reglas de integridad
-- -----------------------------------------------------------------------------

-- Un manager no puede asignarse a sí mismo como su propio supervisor.
create or replace function private.check_manager_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee_user uuid;
begin
  select m.user_id into employee_user
  from public.company_memberships m
  where m.id = new.employee_membership_id;

  if employee_user = new.manager_user_id then
    raise exception 'Un usuario no puede ser su propio manager'
      using errcode = 'check_violation';
  end if;

  if new.created_by is null then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger manager_assignments_check before insert or update on public.manager_assignments
  for each row execute function private.check_manager_assignment();

-- Crea el perfil al dar de alta un usuario en Supabase Auth.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 160)
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Mantiene sincronizado el email del perfil con Auth.
create or replace function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- -----------------------------------------------------------------------------
-- Privilegios: nada para anon; lo mínimo para authenticated.
-- -----------------------------------------------------------------------------

revoke all on public.companies, public.profiles, public.platform_admins,
  public.company_memberships, public.manager_assignments from anon, authenticated;

grant select on public.companies to authenticated;
grant insert, update on public.companies to authenticated;

grant select on public.profiles to authenticated;
-- Solo columnas editables por el propio usuario; email lo gestiona Auth.
grant update (full_name, phone) on public.profiles to authenticated;

grant select on public.platform_admins to authenticated;

grant select, insert on public.company_memberships to authenticated;
-- company_id y user_id no se pueden cambiar: una membresía no se "mueve".
grant update (roles, job_title, active, start_date, end_date) on public.company_memberships
  to authenticated;

grant select, insert, delete on public.manager_assignments to authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.company_memberships enable row level security;
alter table public.manager_assignments enable row level security;

-- companies ------------------------------------------------------------------
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

-- En la fase base solo el administrador global edita empresas.
create policy "companies_update_global_admin" on public.companies
  for update to authenticated
  using (private.is_global_admin())
  with check (private.is_global_admin());

-- profiles -------------------------------------------------------------------
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_global_admin()
    or private.is_hr_of_user(id)
    or private.manages_user(id)
  );

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- platform_admins ------------------------------------------------------------
create policy "platform_admins_select" on public.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_global_admin());

-- company_memberships --------------------------------------------------------
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

-- manager_assignments --------------------------------------------------------
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
