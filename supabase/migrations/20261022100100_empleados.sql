-- =============================================================================
-- Empleados, condiciones laborales y asignaciones de manager con vigencia.
--
-- Añade: employees, employment_terms.
-- Cambia: manager_assignments pasa a referenciar employees (no membresías) y
--         gana estado y vigencia; company_memberships pierde job_title (pasa a
--         employment_terms).
--
-- Reversión: supabase/rollbacks/20261022100100_empleados.down.sql
-- Las funciones SECURITY DEFINER siguen las reglas descritas en
-- 20261022100000_modelo_multiempresa.sql.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

-- Migración destructiva protegida: si hay datos que no se pueden trasladar de
-- forma automática, se aborta en lugar de perderlos.
do $$
begin
  if exists (select 1 from public.manager_assignments) then
    raise exception 'manager_assignments tiene filas: crea los empleados y traslada las asignaciones antes de aplicar esta migración (docs/BASE_DATOS.md)';
  end if;
  if exists (select 1 from public.company_memberships where job_title is not null) then
    raise exception 'company_memberships.job_title tiene datos: trasládalos a employment_terms antes de aplicar esta migración (docs/BASE_DATOS.md)';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------

create type public.contract_type as enum (
  'permanent',          -- Indefinido
  'temporary',          -- Temporal
  'seasonal_permanent', -- Fijo discontinuo
  'internship',         -- Prácticas
  'training',           -- Formación
  'other'
);
create type public.working_time as enum ('full_time', 'part_time');
create type public.terms_status as enum ('draft', 'active', 'ended');

-- -----------------------------------------------------------------------------
-- 2. Empleados
-- -----------------------------------------------------------------------------

create table public.employees (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete restrict,
  -- Cuenta de acceso (opcional: puede existir el empleado antes de invitarle).
  membership_id  uuid,
  employee_code  text not null check (employee_code ~ '^[A-Za-z0-9._-]{1,32}$'),
  first_name     text not null check (char_length(btrim(first_name)) between 1 and 80),
  last_name      text not null check (char_length(btrim(last_name)) between 1 and 120),
  work_email     text check (work_email is null or work_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  work_center_id uuid,
  team_id        uuid,
  status         public.entity_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, employee_code),
  -- Por empresa y no global: evita deducir si una membresía de otra empresa
  -- ya tiene ficha (la clave foránea ya impide mezclar empresas).
  unique (company_id, membership_id),
  unique (id, company_id),
  foreign key (membership_id, company_id)
    references public.company_memberships (id, company_id) on delete restrict,
  foreign key (work_center_id, company_id) references public.work_centers (id, company_id),
  foreign key (team_id, company_id) references public.teams (id, company_id)
);

comment on table public.employees is 'Ficha laboral de una persona en una empresa (gestionada por RR. HH.).';

create index employees_company_idx on public.employees (company_id, status);
create index employees_work_center_idx on public.employees (company_id, work_center_id);
create index employees_team_idx on public.employees (company_id, team_id);

-- -----------------------------------------------------------------------------
-- 3. Condiciones laborales con vigencia
-- -----------------------------------------------------------------------------

create table public.employment_terms (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  employee_id   uuid not null,
  contract_type public.contract_type not null,
  working_time  public.working_time not null default 'full_time',
  -- Jornada ordinaria pactada en promedio semanal (máximo legal 40 h, art. 34 ET).
  weekly_hours  numeric(4, 2) not null check (weekly_hours > 0 and weekly_hours <= 40),
  job_title     text check (job_title is null or char_length(job_title) <= 120),
  -- Fechas de calendario; valid_to es exclusivo: [valid_from, valid_to).
  valid_from    date not null,
  valid_to      date check (valid_to is null or valid_to > valid_from),
  status        public.terms_status not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (employee_id, company_id)
    references public.employees (id, company_id) on delete restrict,
  -- Un empleado no puede tener dos condiciones activas que se solapen.
  constraint employment_terms_no_overlap exclude using gist (
    employee_id with =,
    daterange(valid_from, valid_to, '[)') with &&
  ) where (status = 'active')
);

comment on table public.employment_terms is 'Condiciones contractuales con vigencia. Los cambios crean filas nuevas.';

create index employment_terms_employee_idx on public.employment_terms (employee_id, status);
create index employment_terms_company_idx on public.employment_terms (company_id, status);

-- -----------------------------------------------------------------------------
-- 4. Asignaciones de manager sobre empleados, con estado y vigencia
-- -----------------------------------------------------------------------------

drop policy "manager_assignments_select" on public.manager_assignments;
drop policy "manager_assignments_insert" on public.manager_assignments;
drop policy "manager_assignments_delete" on public.manager_assignments;
drop trigger manager_assignments_check on public.manager_assignments;
drop function private.check_manager_assignment();

alter table public.manager_assignments drop column employee_membership_id;
alter table public.manager_assignments rename column created_by to granted_by;
alter table public.manager_assignments
  add column employee_id uuid not null,
  add column status public.grant_status not null default 'active',
  add column valid_from timestamptz not null default now(),
  add column valid_to timestamptz,
  add column updated_at timestamptz not null default now(),
  add constraint manager_assignments_validity_check check (valid_to is null or valid_to > valid_from),
  add constraint manager_assignments_employee_fkey foreign key (employee_id, company_id)
    references public.employees (id, company_id) on delete restrict;

create unique index manager_assignments_active_uidx on public.manager_assignments
  (company_id, manager_user_id, employee_id) where status = 'active';
create index manager_assignments_employee_idx on public.manager_assignments (employee_id, status);

alter table public.company_memberships drop column job_title;

-- -----------------------------------------------------------------------------
-- 5. Funciones de autorización
-- -----------------------------------------------------------------------------

-- ¿Es ese empleado el usuario actual, con membresía vigente?
create or replace function private.is_self_employee(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee
      and e.membership_id is not null
      and e.membership_id = private.current_membership_id(e.company_id)
  );
$$;

-- ¿Está la ficha de ese empleado ligada a la cuenta p_user? (sin mirar vigencia)
create or replace function private.employee_belongs_to_user(p_user uuid, p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    join public.company_memberships m on m.id = e.membership_id
    where e.id = p_employee and m.user_id = p_user
  );
$$;

-- Permiso del usuario actual sobre un empleado, según su centro y equipo.
create or replace function private.employee_permission(
  p_employee uuid,
  p_permission private.app_permission
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.has_permission(e.company_id, p_permission, e.work_center_id, e.team_id)
    from public.employees e
    where e.id = p_employee
  ), false);
$$;

-- ¿Puede p_user ser manager en esa empresa? Debe tener una membresía vigente
-- en alguna empresa del mismo grupo (la supervisión no cruza grupos).
create or replace function private.is_eligible_manager(p_user uuid, p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.companies c
    where c.id = p_company
      and private.user_has_current_membership_in_group(p_user, c.group_id)
  );
$$;

-- ¿Cubre al empleado una asignación vigente del usuario actual?
create or replace function private.manages_employee(p_employee uuid)
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
    where a.employee_id = p_employee
      and a.manager_user_id = (select auth.uid())
      and a.status = 'active'
      and private.is_active_window(a.valid_from, a.valid_to)
      and c.status = 'active'
      and private.has_current_membership_in_group(c.group_id)
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
    select 1 from public.manager_assignments a
    where a.company_id = target_company
      and a.manager_user_id = (select auth.uid())
      and private.manages_employee(a.employee_id)
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
    select 1 from public.employees e
    where e.membership_id = target_membership
      and private.manages_employee(e.id)
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
    from public.employees e
    join public.company_memberships m on m.id = e.membership_id
    where m.user_id = target_user
      and private.manages_employee(e.id)
  );
$$;

revoke all on function
  private.is_self_employee(uuid),
  private.employee_belongs_to_user(uuid, uuid),
  private.employee_permission(uuid, private.app_permission),
  private.is_eligible_manager(uuid, uuid),
  private.manages_employee(uuid)
from public;

grant execute on function
  private.is_self_employee(uuid),
  private.employee_belongs_to_user(uuid, uuid),
  private.employee_permission(uuid, private.app_permission),
  private.is_eligible_manager(uuid, uuid),
  private.manages_employee(uuid)
to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Triggers
-- -----------------------------------------------------------------------------

create trigger employees_updated_at before update on public.employees
  for each row execute function private.set_updated_at();
create trigger employment_terms_updated_at before update on public.employment_terms
  for each row execute function private.set_updated_at();
create trigger manager_assignments_updated_at before update on public.manager_assignments
  for each row execute function private.set_updated_at();

create trigger employees_keys before update on public.employees
  for each row execute function private.prevent_key_change('id', 'company_id');
create trigger employment_terms_keys before update on public.employment_terms
  for each row execute function private.prevent_key_change('id', 'company_id', 'employee_id');
create trigger manager_assignments_keys before update on public.manager_assignments
  for each row execute function private.prevent_key_change(
    'id', 'company_id', 'employee_id', 'manager_user_id'
  );

create trigger manager_assignments_granted_by before insert or update on public.manager_assignments
  for each row execute function private.set_granted_by();

create trigger audit_employees after insert or update or delete on public.employees
  for each row execute function private.audit_row_change('company_id');
create trigger audit_employment_terms after insert or update or delete on public.employment_terms
  for each row execute function private.audit_row_change('company_id');

-- -----------------------------------------------------------------------------
-- 7. Privilegios
-- -----------------------------------------------------------------------------

revoke all on public.employees, public.employment_terms, public.manager_assignments
  from anon, authenticated;

grant select on public.employees to authenticated;
grant insert (company_id, membership_id, employee_code, first_name, last_name, work_email,
  work_center_id, team_id, status) on public.employees to authenticated;
grant update (membership_id, employee_code, first_name, last_name, work_email, work_center_id,
  team_id, status) on public.employees to authenticated;

grant select on public.employment_terms to authenticated;
grant insert (company_id, employee_id, contract_type, working_time, weekly_hours, job_title,
  valid_from, valid_to, status) on public.employment_terms to authenticated;
grant update (status, valid_to) on public.employment_terms to authenticated;

grant select on public.manager_assignments to authenticated;
grant insert (company_id, employee_id, manager_user_id, valid_from, valid_to)
  on public.manager_assignments to authenticated;
grant update (status, valid_to) on public.manager_assignments to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.employees enable row level security;
alter table public.employment_terms enable row level security;

-- employees ------------------------------------------------------------------
create policy "employees_select" on public.employees
  for select to authenticated
  using (
    private.is_self_employee(id)
    or private.has_permission(company_id, 'employees.read', work_center_id, team_id)
    or private.manages_employee(id)
  );

create policy "employees_insert" on public.employees
  for insert to authenticated
  with check (
    private.has_permission(company_id, 'employees.manage', work_center_id, team_id)
    and (membership_id is null or not private.is_own_membership(membership_id))
  );

create policy "employees_update" on public.employees
  for update to authenticated
  using (
    private.has_permission(company_id, 'employees.manage', work_center_id, team_id)
    and (membership_id is null or not private.is_own_membership(membership_id))
  )
  with check (
    private.has_permission(company_id, 'employees.manage', work_center_id, team_id)
    and (membership_id is null or not private.is_own_membership(membership_id))
  );

-- employment_terms -----------------------------------------------------------
create policy "employment_terms_select" on public.employment_terms
  for select to authenticated
  using (
    private.is_self_employee(employee_id)
    or private.employee_permission(employee_id, 'terms.read')
    or private.manages_employee(employee_id)
  );

create policy "employment_terms_insert" on public.employment_terms
  for insert to authenticated
  with check (
    private.employee_permission(employee_id, 'terms.manage')
    and not private.employee_belongs_to_user((select auth.uid()), employee_id)
  );

create policy "employment_terms_update" on public.employment_terms
  for update to authenticated
  using (
    private.employee_permission(employee_id, 'terms.manage')
    and not private.employee_belongs_to_user((select auth.uid()), employee_id)
  )
  with check (
    private.employee_permission(employee_id, 'terms.manage')
    and not private.employee_belongs_to_user((select auth.uid()), employee_id)
  );

-- manager_assignments --------------------------------------------------------
-- Nadie se asigna a sí mismo como manager ni supervisa su propia ficha.
create policy "manager_assignments_select" on public.manager_assignments
  for select to authenticated
  using (
    manager_user_id = (select auth.uid())
    or private.is_self_employee(employee_id)
    or private.employee_permission(employee_id, 'employees.read')
  );

create policy "manager_assignments_insert" on public.manager_assignments
  for insert to authenticated
  with check (
    private.employee_permission(employee_id, 'assignments.manage')
    and manager_user_id <> (select auth.uid())
    and not private.employee_belongs_to_user(manager_user_id, employee_id)
    and private.is_eligible_manager(manager_user_id, company_id)
  );

create policy "manager_assignments_update" on public.manager_assignments
  for update to authenticated
  using (
    private.employee_permission(employee_id, 'assignments.manage')
    and manager_user_id <> (select auth.uid())
  )
  with check (
    private.employee_permission(employee_id, 'assignments.manage')
    and manager_user_id <> (select auth.uid())
  );
