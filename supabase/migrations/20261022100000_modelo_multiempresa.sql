-- =============================================================================
-- Modelo multiempresa y autorización por empresa y ámbito.
--
-- Añade: groups, group_admins, work_centers, teams, role_assignments.
-- Cambia: companies (group_id, status), company_memberships (status y vigencia;
--         los roles salen a role_assignments), audit_log (group_id).
-- Sustituye las funciones de autorización por has_permission() con ámbito.
--
-- Reversión: supabase/rollbacks/20261022100000_modelo_multiempresa.down.sql
-- Documentación: docs/BASE_DATOS.md, docs/PERMISOS.md, ADR-017.
--
-- Todas las funciones SECURITY DEFINER de este archivo:
--   * pertenecen al propietario de las tablas (postgres), por lo que leen sin
--     aplicar RLS y así se evita la recursión de políticas;
--   * fijan search_path = '' y cualifican todos los objetos con su esquema;
--   * solo devuelven booleanos o ids relativos al usuario que llama
--     (auth.uid()), nunca datos de otras personas o empresas;
--   * viven en el esquema private, que la API REST no expone, y solo
--     authenticated y service_role pueden ejecutarlas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------

create type public.entity_status as enum ('active', 'inactive');
create type public.membership_status as enum ('invited', 'active', 'suspended', 'ended');
create type public.grant_status as enum ('active', 'revoked');
create type public.role_scope as enum ('company', 'work_center', 'team');

-- Roles dentro de una empresa. El administrador de grupo se modela en
-- group_admins y la administración de plataforma en platform_admins.
create type public.app_role as enum (
  'company_admin', -- Administrador de empresa
  'hr',            -- RR. HH.
  'manager',       -- Manager o responsable (la visibilidad la dan manager_assignments)
  'accounting',    -- Contabilidad
  'employee',      -- Empleado
  'auditor'        -- Auditor (solo lectura)
);

-- Permisos que conceden los roles. Interno: no se expone a la API.
create type private.app_permission as enum (
  'company.manage',
  'org.manage',
  'members.read',
  'members.manage',
  'roles.manage',
  'employees.read',
  'employees.manage',
  'terms.read',
  'terms.manage',
  'assignments.manage',
  'audit.read'
);

-- -----------------------------------------------------------------------------
-- 2. Utilidades genéricas
-- -----------------------------------------------------------------------------

-- Vigencia temporal [valid_from, valid_to). valid_to null = sin fin.
create or replace function private.is_active_window(p_from timestamptz, p_to timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_from <= now() and (p_to is null or p_to > now());
$$;

-- Impide cambiar columnas clave (company_id, user_id...) para cualquier rol,
-- incluido service_role. Argumentos: nombres de columna.
create or replace function private.prevent_key_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  col text;
begin
  foreach col in array tg_argv loop
    if (to_jsonb(new) -> col) is distinct from (to_jsonb(old) -> col) then
      raise exception 'La columna %.% no se puede modificar', tg_table_name, col
        using errcode = 'insufficient_privilege';
    end if;
  end loop;
  return new;
end;
$$;

-- Registra quién concede un permiso. Ignora cualquier valor enviado por el cliente.
create or replace function private.set_granted_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.granted_by := (select auth.uid());
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Grupos
-- -----------------------------------------------------------------------------

create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 2 and 120),
  slug       text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status     public.entity_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.groups is 'Grupos empresariales. Una empresa pertenece a un único grupo.';

create table public.group_admins (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete restrict,
  user_id    uuid not null references public.profiles (id) on delete restrict,
  status     public.grant_status not null default 'active',
  valid_from timestamptz not null default now(),
  valid_to   timestamptz check (valid_to is null or valid_to > valid_from),
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.group_admins is 'Administradores de grupo con vigencia. Solo los concede la administración de plataforma.';

create unique index group_admins_active_uidx on public.group_admins (group_id, user_id)
  where status = 'active';
create index group_admins_user_idx on public.group_admins (user_id, status);

-- -----------------------------------------------------------------------------
-- 4. Empresas: grupo y estado explícito
-- -----------------------------------------------------------------------------

alter table public.companies
  add column group_id uuid references public.groups (id) on delete restrict,
  add column status public.entity_status not null default 'active';

-- Empresas existentes sin grupo: se agrupan en un grupo por defecto.
do $$
begin
  if exists (select 1 from public.companies where group_id is null) then
    insert into public.groups (name, slug) values ('Grupo principal', 'grupo-principal')
    on conflict (slug) do nothing;
    update public.companies
    set group_id = (select g.id from public.groups g where g.slug = 'grupo-principal')
    where group_id is null;
  end if;
end;
$$;

update public.companies set status = case when active then 'active' else 'inactive' end::public.entity_status;

alter table public.companies alter column group_id set not null;
create index companies_group_idx on public.companies (group_id, status);

-- El slug pasa a ser único por grupo: con unicidad global, un administrador de
-- grupo podría averiguar los slugs de empresas de otros grupos.
alter table public.companies
  drop constraint companies_slug_key,
  add constraint companies_group_slug_key unique (group_id, slug);

-- -----------------------------------------------------------------------------
-- 5. Centros de trabajo y equipos
-- -----------------------------------------------------------------------------

create table public.work_centers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  name          text not null check (char_length(btrim(name)) between 2 and 120),
  code          text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  address_line  text check (address_line is null or char_length(address_line) <= 200),
  city          text check (city is null or char_length(city) <= 100),
  postal_code   text check (postal_code is null or postal_code ~ '^[A-Za-z0-9 -]{3,10}$'),
  province      text check (province is null or char_length(province) <= 100),
  country_code  char(2) not null default 'ES' check (country_code ~ '^[A-Z]{2}$'),
  timezone      text not null default 'Europe/Madrid',
  status        public.entity_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, code),
  unique (id, company_id)
);

comment on table public.work_centers is 'Centros de trabajo de una empresa.';

create index work_centers_company_idx on public.work_centers (company_id, status);

create table public.teams (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete restrict,
  work_center_id uuid,
  name           text not null check (char_length(btrim(name)) between 2 and 120),
  status         public.entity_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id),
  -- El centro debe ser de la misma empresa.
  foreign key (work_center_id, company_id) references public.work_centers (id, company_id)
);

comment on table public.teams is 'Equipos de una empresa, opcionalmente ligados a un centro.';

create index teams_company_idx on public.teams (company_id, status);
create index teams_work_center_idx on public.teams (work_center_id);

-- -----------------------------------------------------------------------------
-- 6. Membresías: estado y vigencia
-- -----------------------------------------------------------------------------

alter table public.company_memberships
  add column status public.membership_status not null default 'active',
  add column valid_from timestamptz,
  add column valid_to timestamptz;

update public.company_memberships set
  status = case when active then 'active' else 'ended' end::public.membership_status,
  valid_from = (start_date::timestamp at time zone 'Europe/Madrid'),
  valid_to = case
    when end_date is not null then ((end_date + 1)::timestamp at time zone 'Europe/Madrid')
  end;

alter table public.company_memberships
  alter column valid_from set not null,
  alter column valid_from set default now(),
  add constraint company_memberships_validity_check
    check (valid_to is null or valid_to > valid_from);

-- -----------------------------------------------------------------------------
-- 7. Asignación de roles con ámbito y vigencia
-- -----------------------------------------------------------------------------

create table public.role_assignments (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete restrict,
  membership_id  uuid not null,
  role           public.app_role not null,
  scope_type     public.role_scope not null default 'company',
  work_center_id uuid,
  team_id        uuid,
  status         public.grant_status not null default 'active',
  valid_from     timestamptz not null default now(),
  valid_to       timestamptz check (valid_to is null or valid_to > valid_from),
  granted_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Coherencia de empresa garantizada por claves compuestas.
  foreign key (membership_id, company_id)
    references public.company_memberships (id, company_id) on delete restrict,
  foreign key (work_center_id, company_id) references public.work_centers (id, company_id),
  foreign key (team_id, company_id) references public.teams (id, company_id),
  constraint role_assignments_scope_check check (
    (scope_type = 'company' and work_center_id is null and team_id is null)
    or (scope_type = 'work_center' and work_center_id is not null and team_id is null)
    or (scope_type = 'team' and team_id is not null and work_center_id is null)
  )
);

comment on table public.role_assignments is 'Roles de una membresía con ámbito (empresa, centro o equipo) y vigencia.';

-- company_id va en el índice: la unicidad se comprueba antes que las claves
-- foráneas y, sin él, un intento con una membresía de otra empresa revelaría
-- qué roles tiene esa persona allí.
create unique index role_assignments_active_uidx on public.role_assignments (
  company_id, membership_id, role, scope_type,
  coalesce(work_center_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where status = 'active';
create index role_assignments_membership_idx on public.role_assignments (membership_id, status);
create index role_assignments_company_idx on public.role_assignments (company_id, role, status);

-- Traslado de los roles antiguos (array en la membresía) a role_assignments.
insert into public.role_assignments (company_id, membership_id, role, scope_type, status, valid_from)
select distinct m.company_id, m.id, r::text::public.app_role, 'company'::public.role_scope,
  case when m.active then 'active' else 'revoked' end::public.grant_status, m.created_at
from public.company_memberships m
cross join lateral unnest(m.roles) as r;

-- -----------------------------------------------------------------------------
-- 8. Retirada de políticas, funciones y columnas del modelo anterior
-- -----------------------------------------------------------------------------

drop policy "companies_select" on public.companies;
drop policy "companies_insert_global_admin" on public.companies;
drop policy "companies_update_global_admin" on public.companies;
drop policy "profiles_select" on public.profiles;
drop policy "memberships_select" on public.company_memberships;
drop policy "memberships_insert" on public.company_memberships;
drop policy "memberships_update" on public.company_memberships;
drop policy "manager_assignments_select" on public.manager_assignments;
drop policy "manager_assignments_insert" on public.manager_assignments;
drop policy "manager_assignments_delete" on public.manager_assignments;
drop policy "audit_log_select" on public.audit_log;
drop policy "company_logos_select" on storage.objects;
drop policy "company_logos_insert" on storage.objects;
drop policy "company_logos_update" on storage.objects;
drop policy "company_logos_delete" on storage.objects;

drop function private.has_company_role(uuid, public.company_role[]);
drop function private.is_hr_of_user(uuid);

drop index if exists public.company_memberships_user_idx;
alter table public.company_memberships
  drop column roles,
  drop column active,
  drop column start_date,
  drop column end_date;
alter table public.companies drop column active;

drop type public.company_role;

create index company_memberships_user_idx on public.company_memberships (user_id, status);
create index company_memberships_company_idx on public.company_memberships (company_id, status);

-- -----------------------------------------------------------------------------
-- 9. Funciones de autorización
-- -----------------------------------------------------------------------------

-- Membresía vigente del usuario actual en una empresa activa de un grupo activo.
create or replace function private.current_membership_id(p_company uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.company_memberships m
  join public.companies c on c.id = m.company_id
  join public.groups g on g.id = c.group_id
  where m.company_id = p_company
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and private.is_active_window(m.valid_from, m.valid_to)
    and c.status = 'active'
    and g.status = 'active'
  limit 1;
$$;

create or replace function private.is_company_member(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_membership_id(target_company) is not null;
$$;

create or replace function private.is_group_admin(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_admins ga
    join public.groups g on g.id = ga.group_id
    where ga.group_id = p_group
      and ga.user_id = (select auth.uid())
      and ga.status = 'active'
      and private.is_active_window(ga.valid_from, ga.valid_to)
      and g.status = 'active'
  );
$$;

-- Incluye empresas inactivas: la administración de grupo debe poder reactivarlas.
create or replace function private.is_group_admin_of_company(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.companies c
    where c.id = p_company and private.is_group_admin(c.group_id)
  );
$$;

-- ¿Tiene p_user una membresía vigente en alguna empresa activa del grupo?
create or replace function private.user_has_current_membership_in_group(p_user uuid, p_group uuid)
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
    where c.group_id = p_group
      and m.user_id = p_user
      and m.status = 'active'
      and private.is_active_window(m.valid_from, m.valid_to)
      and c.status = 'active'
  );
$$;

create or replace function private.has_current_membership_in_group(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_has_current_membership_in_group((select auth.uid()), p_group);
$$;

-- Matriz rol -> permisos (ver docs/PERMISOS.md). Inmutable y sin acceso a datos.
create or replace function private.role_has_permission(p_role public.app_role, p_permission private.app_permission)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'company_admin' then true
    when 'hr' then p_permission in (
      'members.read', 'members.manage', 'roles.manage', 'employees.read', 'employees.manage',
      'terms.read', 'terms.manage', 'assignments.manage'
    )
    when 'auditor' then p_permission in ('members.read', 'employees.read', 'terms.read', 'audit.read')
    when 'accounting' then p_permission in ('employees.read')
    else false
  end;
$$;

-- ¿Tiene el usuario actual el permiso en la empresa y, opcionalmente, en el
-- ámbito (centro o equipo) del recurso? Un rol de ámbito empresa cubre todo;
-- un rol de centro o equipo solo cubre recursos de ese centro o equipo.
create or replace function private.has_permission(
  p_company uuid,
  p_permission private.app_permission,
  p_work_center uuid default null,
  p_team uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_company is not null and (
    private.is_global_admin()
    or private.is_group_admin_of_company(p_company)
    or exists (
      select 1
      from public.role_assignments ra
      where ra.company_id = p_company
        and ra.membership_id = private.current_membership_id(p_company)
        and ra.status = 'active'
        and private.is_active_window(ra.valid_from, ra.valid_to)
        and private.role_has_permission(ra.role, p_permission)
        and (
          ra.scope_type = 'company'
          or (ra.scope_type = 'work_center' and ra.work_center_id = p_work_center)
          or (ra.scope_type = 'team' and ra.team_id = p_team)
        )
    )
  );
$$;

-- ¿Tiene el usuario actual alguno de esos roles con ámbito de empresa?
create or replace function private.has_company_role(p_company uuid, p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.role_assignments ra
    where ra.company_id = p_company
      and ra.membership_id = private.current_membership_id(p_company)
      and ra.status = 'active'
      and private.is_active_window(ra.valid_from, ra.valid_to)
      and ra.scope_type = 'company'
      and ra.role = any (p_roles)
  );
$$;

-- Techo de privilegios: quién puede conceder o revocar cada rol.
create or replace function private.can_grant_role(p_company uuid, p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_global_admin()
    or private.is_group_admin_of_company(p_company)
    or private.has_company_role(p_company, array['company_admin']::public.app_role[])
    or (
      p_role in ('employee', 'manager')
      and private.has_company_role(p_company, array['hr']::public.app_role[])
    );
$$;

-- ¿Es esa membresía del usuario actual? (para impedir autoconcesiones)
create or replace function private.is_own_membership(p_membership uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_memberships m
    where m.id = p_membership and m.user_id = (select auth.uid())
  );
$$;

-- ¿Puede el usuario actual ver los datos de membresía de p_user en alguna empresa?
create or replace function private.can_read_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_memberships m
    where m.user_id = p_user
      and private.has_permission(m.company_id, 'members.read')
  );
$$;

-- Supervisión (versión transitoria sobre la estructura anterior de
-- manager_assignments; la migración de empleados la sustituye).
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
    join public.companies c on c.id = a.company_id
    where a.company_id = target_company
      and a.manager_user_id = (select auth.uid())
      and m.status = 'active'
      and private.is_active_window(m.valid_from, m.valid_to)
      and private.has_current_membership_in_group(c.group_id)
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
    join public.companies c on c.id = a.company_id
    where a.employee_membership_id = target_membership
      and a.manager_user_id = (select auth.uid())
      and private.has_current_membership_in_group(c.group_id)
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
    join public.companies c on c.id = a.company_id
    where m.user_id = target_user
      and a.manager_user_id = (select auth.uid())
      and private.has_current_membership_in_group(c.group_id)
  );
$$;

-- Solo la administración de grupo o de plataforma cambia el estado de una empresa.
create or replace function private.guard_company_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and (select auth.uid()) is not null
     and not (private.is_global_admin() or private.is_group_admin(old.group_id)) then
    raise exception 'Solo la administración del grupo puede cambiar el estado de una empresa'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Auditoría: grupo afectado
-- -----------------------------------------------------------------------------

alter table public.audit_log add column group_id uuid;
create index audit_log_group_idx on public.audit_log (group_id, occurred_at desc);

-- Argumentos: [0] columna con la empresa ('' si no aplica), [1] columna con el grupo.
-- Si no hay columna de grupo, se deduce de la empresa.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_column text := nullif(tg_argv[0], '');
  group_column text := nullif(tg_argv[1], '');
  row_data jsonb;
  company uuid;
  grp uuid;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if company_column is not null then
    company := (row_data ->> company_column)::uuid;
  end if;
  if group_column is not null then
    grp := (row_data ->> group_column)::uuid;
  elsif company is not null then
    select c.group_id into grp from public.companies c where c.id = company;
  end if;

  insert into public.audit_log (
    actor_id, company_id, group_id, table_name, record_id, action, old_data, new_data
  )
  values (
    (select auth.uid()),
    company,
    grp,
    tg_table_name,
    coalesce(row_data ->> 'id', row_data ->> 'user_id', ''),
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end;
$$;

-- Funciones nuevas: nadie salvo el propietario por defecto; solo las que usan
-- las políticas se conceden a authenticated y service_role. Las sustituidas
-- con create or replace conservan sus privilegios anteriores.
revoke all on function
  private.is_active_window(timestamptz, timestamptz),
  private.prevent_key_change(),
  private.set_granted_by(),
  private.current_membership_id(uuid),
  private.is_group_admin(uuid),
  private.is_group_admin_of_company(uuid),
  private.user_has_current_membership_in_group(uuid, uuid),
  private.has_current_membership_in_group(uuid),
  private.role_has_permission(public.app_role, private.app_permission),
  private.has_permission(uuid, private.app_permission, uuid, uuid),
  private.has_company_role(uuid, public.app_role[]),
  private.can_grant_role(uuid, public.app_role),
  private.is_own_membership(uuid),
  private.can_read_user(uuid),
  private.guard_company_update()
from public;

grant execute on function
  private.is_active_window(timestamptz, timestamptz),
  private.current_membership_id(uuid),
  private.is_group_admin(uuid),
  private.is_group_admin_of_company(uuid),
  private.user_has_current_membership_in_group(uuid, uuid),
  private.has_current_membership_in_group(uuid),
  private.role_has_permission(public.app_role, private.app_permission),
  private.has_permission(uuid, private.app_permission, uuid, uuid),
  private.has_company_role(uuid, public.app_role[]),
  private.can_grant_role(uuid, public.app_role),
  private.is_own_membership(uuid),
  private.can_read_user(uuid)
to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 11. Triggers
-- -----------------------------------------------------------------------------

create trigger groups_updated_at before update on public.groups
  for each row execute function private.set_updated_at();
create trigger group_admins_updated_at before update on public.group_admins
  for each row execute function private.set_updated_at();
create trigger work_centers_updated_at before update on public.work_centers
  for each row execute function private.set_updated_at();
create trigger teams_updated_at before update on public.teams
  for each row execute function private.set_updated_at();
create trigger role_assignments_updated_at before update on public.role_assignments
  for each row execute function private.set_updated_at();

create trigger companies_keys before update on public.companies
  for each row execute function private.prevent_key_change('id', 'group_id');
create trigger companies_guard before update on public.companies
  for each row execute function private.guard_company_update();
create trigger group_admins_keys before update on public.group_admins
  for each row execute function private.prevent_key_change('id', 'group_id', 'user_id');
create trigger work_centers_keys before update on public.work_centers
  for each row execute function private.prevent_key_change('id', 'company_id');
create trigger teams_keys before update on public.teams
  for each row execute function private.prevent_key_change('id', 'company_id');
create trigger company_memberships_keys before update on public.company_memberships
  for each row execute function private.prevent_key_change('id', 'company_id', 'user_id');
create trigger role_assignments_keys before update on public.role_assignments
  for each row execute function private.prevent_key_change(
    'id', 'company_id', 'membership_id', 'role', 'scope_type', 'work_center_id', 'team_id'
  );

create trigger group_admins_granted_by before insert or update on public.group_admins
  for each row execute function private.set_granted_by();
create trigger role_assignments_granted_by before insert or update on public.role_assignments
  for each row execute function private.set_granted_by();

drop trigger audit_companies on public.companies;
create trigger audit_companies after insert or update or delete on public.companies
  for each row execute function private.audit_row_change('id', 'group_id');
create trigger audit_groups after insert or update or delete on public.groups
  for each row execute function private.audit_row_change('', 'id');
create trigger audit_group_admins after insert or update or delete on public.group_admins
  for each row execute function private.audit_row_change('', 'group_id');
create trigger audit_work_centers after insert or update or delete on public.work_centers
  for each row execute function private.audit_row_change('company_id');
create trigger audit_teams after insert or update or delete on public.teams
  for each row execute function private.audit_row_change('company_id');
create trigger audit_role_assignments after insert or update or delete on public.role_assignments
  for each row execute function private.audit_row_change('company_id');

-- -----------------------------------------------------------------------------
-- 12. Privilegios (nada para anon; mínimos y por columna para authenticated)
-- -----------------------------------------------------------------------------

revoke all on public.groups, public.group_admins, public.work_centers, public.teams,
  public.role_assignments from anon, authenticated;
revoke all on public.companies, public.company_memberships from anon, authenticated;

grant select on public.groups to authenticated;
grant insert (name, slug, status) on public.groups to authenticated;
grant update (name, slug, status) on public.groups to authenticated;

grant select on public.group_admins to authenticated;
grant insert (group_id, user_id, valid_from, valid_to) on public.group_admins to authenticated;
grant update (status, valid_to) on public.group_admins to authenticated;

grant select on public.companies to authenticated;
grant insert (group_id, name, legal_name, tax_id, slug, primary_color, logo_path, timezone, status)
  on public.companies to authenticated;
grant update (name, legal_name, tax_id, primary_color, logo_path, timezone, status)
  on public.companies to authenticated;

grant select on public.work_centers to authenticated;
grant insert (company_id, name, code, address_line, city, postal_code, province, country_code,
  timezone, status) on public.work_centers to authenticated;
grant update (name, code, address_line, city, postal_code, province, country_code, timezone, status)
  on public.work_centers to authenticated;

grant select on public.teams to authenticated;
grant insert (company_id, work_center_id, name, status) on public.teams to authenticated;
grant update (work_center_id, name, status) on public.teams to authenticated;

grant select on public.company_memberships to authenticated;
grant insert (company_id, user_id, job_title, status, valid_from, valid_to)
  on public.company_memberships to authenticated;
grant update (job_title, status, valid_from, valid_to) on public.company_memberships to authenticated;

grant select on public.role_assignments to authenticated;
grant insert (company_id, membership_id, role, scope_type, work_center_id, team_id, valid_from,
  valid_to) on public.role_assignments to authenticated;
grant update (status, valid_to) on public.role_assignments to authenticated;

-- -----------------------------------------------------------------------------
-- 13. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.groups enable row level security;
alter table public.group_admins enable row level security;
alter table public.work_centers enable row level security;
alter table public.teams enable row level security;
alter table public.role_assignments enable row level security;

-- groups ---------------------------------------------------------------------
create policy "groups_select" on public.groups
  for select to authenticated
  using (
    private.is_global_admin()
    or private.is_group_admin(id)
    or private.has_current_membership_in_group(id)
  );

create policy "groups_insert" on public.groups
  for insert to authenticated
  with check (private.is_global_admin());

create policy "groups_update" on public.groups
  for update to authenticated
  using (private.is_global_admin())
  with check (private.is_global_admin());

-- group_admins ---------------------------------------------------------------
create policy "group_admins_select" on public.group_admins
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_global_admin()
    or private.is_group_admin(group_id)
  );

create policy "group_admins_insert" on public.group_admins
  for insert to authenticated
  with check (private.is_global_admin() and user_id <> (select auth.uid()));

create policy "group_admins_update" on public.group_admins
  for update to authenticated
  using (private.is_global_admin() and user_id <> (select auth.uid()))
  with check (private.is_global_admin() and user_id <> (select auth.uid()));

-- companies ------------------------------------------------------------------
create policy "companies_select" on public.companies
  for select to authenticated
  using (
    private.is_global_admin()
    or private.is_group_admin_of_company(id)
    or private.is_company_member(id)
    or private.manages_in_company(id)
  );

create policy "companies_insert" on public.companies
  for insert to authenticated
  with check (private.is_global_admin() or private.is_group_admin(group_id));

create policy "companies_update" on public.companies
  for update to authenticated
  using (private.has_permission(id, 'company.manage'))
  with check (private.has_permission(id, 'company.manage'));

-- profiles -------------------------------------------------------------------
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_global_admin()
    or private.can_read_user(id)
    or private.manages_user(id)
  );

-- work_centers / teams -------------------------------------------------------
create policy "work_centers_select" on public.work_centers
  for select to authenticated
  using (
    private.is_company_member(company_id)
    or private.has_permission(company_id, 'org.manage')
    or private.manages_in_company(company_id)
  );

create policy "work_centers_insert" on public.work_centers
  for insert to authenticated
  with check (private.has_permission(company_id, 'org.manage'));

create policy "work_centers_update" on public.work_centers
  for update to authenticated
  using (private.has_permission(company_id, 'org.manage'))
  with check (private.has_permission(company_id, 'org.manage'));

create policy "teams_select" on public.teams
  for select to authenticated
  using (
    private.is_company_member(company_id)
    or private.has_permission(company_id, 'org.manage')
    or private.manages_in_company(company_id)
  );

create policy "teams_insert" on public.teams
  for insert to authenticated
  with check (private.has_permission(company_id, 'org.manage'));

create policy "teams_update" on public.teams
  for update to authenticated
  using (private.has_permission(company_id, 'org.manage'))
  with check (private.has_permission(company_id, 'org.manage'));

-- company_memberships --------------------------------------------------------
-- Nadie crea ni modifica su propia membresía desde la API.
create policy "memberships_select" on public.company_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_permission(company_id, 'members.read')
    or private.manages_membership(id)
  );

create policy "memberships_insert" on public.company_memberships
  for insert to authenticated
  with check (
    private.has_permission(company_id, 'members.manage')
    and user_id <> (select auth.uid())
  );

create policy "memberships_update" on public.company_memberships
  for update to authenticated
  using (
    private.has_permission(company_id, 'members.manage')
    and user_id <> (select auth.uid())
  )
  with check (
    private.has_permission(company_id, 'members.manage')
    and user_id <> (select auth.uid())
  );

-- role_assignments -----------------------------------------------------------
-- Nadie se concede, amplía ni revoca roles a sí mismo; techo en can_grant_role().
create policy "role_assignments_select" on public.role_assignments
  for select to authenticated
  using (
    private.is_own_membership(membership_id)
    or private.has_permission(company_id, 'members.read')
  );

create policy "role_assignments_insert" on public.role_assignments
  for insert to authenticated
  with check (
    private.can_grant_role(company_id, role)
    and not private.is_own_membership(membership_id)
  );

create policy "role_assignments_update" on public.role_assignments
  for update to authenticated
  using (
    private.can_grant_role(company_id, role)
    and not private.is_own_membership(membership_id)
  )
  with check (
    private.can_grant_role(company_id, role)
    and not private.is_own_membership(membership_id)
  );

-- manager_assignments (estructura anterior; se rehace en la migración de empleados)
create policy "manager_assignments_select" on public.manager_assignments
  for select to authenticated
  using (
    manager_user_id = (select auth.uid())
    or private.has_permission(company_id, 'members.read')
    or private.is_own_membership(employee_membership_id)
  );

create policy "manager_assignments_insert" on public.manager_assignments
  for insert to authenticated
  with check (
    private.has_permission(company_id, 'assignments.manage')
    and manager_user_id <> (select auth.uid())
  );

create policy "manager_assignments_delete" on public.manager_assignments
  for delete to authenticated
  using (private.has_permission(company_id, 'assignments.manage'));

-- audit_log ------------------------------------------------------------------
create policy "audit_log_select" on public.audit_log
  for select to authenticated
  using (
    private.is_global_admin()
    or (group_id is not null and private.is_group_admin(group_id))
    or (company_id is not null and private.has_permission(company_id, 'audit.read'))
  );

-- storage: logotipos ---------------------------------------------------------
create policy "company_logos_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'company-logos'
    and (
      private.is_global_admin()
      or private.is_group_admin_of_company(private.object_company_id(name))
      or private.is_company_member(private.object_company_id(name))
      or private.manages_in_company(private.object_company_id(name))
    )
  );

create policy "company_logos_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'company-logos'
    and private.has_permission(private.object_company_id(name), 'company.manage')
  );

create policy "company_logos_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'company-logos'
    and private.has_permission(private.object_company_id(name), 'company.manage')
  )
  with check (
    bucket_id = 'company-logos'
    and private.has_permission(private.object_company_id(name), 'company.manage')
  );

create policy "company_logos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'company-logos'
    and private.has_permission(private.object_company_id(name), 'company.manage')
  );
