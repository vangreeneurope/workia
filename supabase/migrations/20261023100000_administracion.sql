-- =============================================================================
-- Módulo de administración: aprobadores por persona o equipo y tipo de
-- solicitud, suplencias temporales, bajas con fecha efectiva, auditoría
-- minimizada (audit_events) e importación atómica de empleados.
--
-- También separa la administración de plataforma de la de empresa: un
-- administrador de plataforma ya no obtiene permisos sobre datos de empresas.
--
-- Reversión: supabase/rollbacks/20261023100000_administracion.down.sql
-- Reglas de vigencia y bajas: docs/BASE_DATOS.md (sección "Vigencia y bajas").
-- Las funciones SECURITY DEFINER siguen las reglas de
-- 20261022100000_modelo_multiempresa.sql. Las funciones de public expuestas
-- por la API comprueban permisos de forma explícita al principio.
-- =============================================================================

-- Migración protegida: no puede haber asignaciones vigentes solapadas para el
-- mismo empleado (serían ambiguas con las nuevas reglas).
do $$
begin
  if exists (
    select 1
    from public.manager_assignments a
    join public.manager_assignments b
      on a.employee_id = b.employee_id and a.id < b.id
     and a.status = 'active' and b.status = 'active'
     and tstzrange(a.valid_from, a.valid_to, '[)') && tstzrange(b.valid_from, b.valid_to, '[)')
  ) then
    raise exception 'Hay asignaciones de manager vigentes solapadas para un mismo empleado: ciérralas antes de aplicar esta migración (docs/BASE_DATOS.md)';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------

create type public.approval_type as enum ('all', 'absences', 'expenses', 'time_corrections');
create type public.assignment_scope as enum ('employee', 'team');

-- -----------------------------------------------------------------------------
-- 2. Separación plataforma / empresa
-- -----------------------------------------------------------------------------

-- has_permission y can_grant_role dejan de conceder a la administración de plataforma.
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
    private.is_group_admin_of_company(p_company)
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

create or replace function private.can_grant_role(p_company uuid, p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_group_admin_of_company(p_company)
    or private.has_company_role(p_company, array['company_admin']::public.app_role[])
    or (
      p_role in ('employee', 'manager')
      and private.has_company_role(p_company, array['hr']::public.app_role[])
    );
$$;

drop policy "companies_insert" on public.companies;
create policy "companies_insert" on public.companies
  for insert to authenticated
  with check (private.is_group_admin(group_id));

-- La auditoría técnica con datos de empresa deja de ser visible para la plataforma.
drop policy "audit_log_select" on public.audit_log;
create policy "audit_log_select" on public.audit_log
  for select to authenticated
  using (
    (company_id is null and group_id is null and private.is_global_admin())
    or (group_id is not null and private.is_group_admin(group_id))
    or (company_id is not null and private.has_permission(company_id, 'audit.read'))
  );

-- -----------------------------------------------------------------------------
-- 3. Bajas con fecha efectiva
-- -----------------------------------------------------------------------------

alter table public.employees
  add column end_date date;

comment on column public.employees.end_date is
  'Último día de relación laboral (incluido). Desde el día siguiente no se admiten nuevas operaciones.';

-- ¿Está el empleado en activo ese día?
create or replace function private.employee_active_on(p_employee uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee and (e.end_date is null or p_day <= e.end_date)
  );
$$;

-- Primer instante (UTC) sin relación laboral: medianoche de Madrid del día siguiente a la baja.
create or replace function private.employment_end_instant(p_end_date date)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select ((p_end_date + 1)::timestamp at time zone 'Europe/Madrid');
$$;

-- Validaciones de negocio. Son triggers AFTER: se ejecutan cuando RLS ya ha
-- aceptado la fila, así que sus mensajes no revelan datos de otras empresas.
create or replace function private.check_terms_within_employment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_day date;
begin
  if new.status <> 'active' then
    return null;
  end if;
  select e.end_date into last_day from public.employees e where e.id = new.employee_id;
  if last_day is not null and (
    new.valid_from > last_day or new.valid_to is null or new.valid_to > last_day + 1
  ) then
    raise exception 'La persona causa baja el %: las condiciones no pueden ir más allá de esa fecha', last_day
      using errcode = 'check_violation', hint = 'Ajusta las fechas o reactiva a la persona.';
  end if;
  return null;
end;
$$;

create or replace function private.check_assignment_within_employment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_day date;
begin
  if new.status <> 'active' or new.scope_type <> 'employee' then
    return null;
  end if;
  select e.end_date into last_day from public.employees e where e.id = new.employee_id;
  if last_day is not null and (
    new.valid_from >= private.employment_end_instant(last_day)
    or new.valid_to is null
    or new.valid_to > private.employment_end_instant(last_day)
  ) then
    raise exception 'La persona causa baja el %: la asignación no puede ir más allá de esa fecha', last_day
      using errcode = 'check_violation', hint = 'Indica una fecha de fin igual o anterior a la baja.';
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Asignaciones de manager por persona o equipo y tipo de solicitud
-- -----------------------------------------------------------------------------

drop policy "manager_assignments_select" on public.manager_assignments;
drop policy "manager_assignments_insert" on public.manager_assignments;
drop policy "manager_assignments_update" on public.manager_assignments;
drop trigger manager_assignments_keys on public.manager_assignments;
drop index public.manager_assignments_active_uidx;

alter table public.manager_assignments
  add column scope_type public.assignment_scope not null default 'employee',
  add column team_id uuid,
  add column request_type public.approval_type not null default 'all',
  alter column employee_id drop not null,
  add constraint manager_assignments_team_fkey foreign key (team_id, company_id)
    references public.teams (id, company_id) on delete restrict,
  add constraint manager_assignments_scope_check check (
    (scope_type = 'employee' and employee_id is not null and team_id is null)
    or (scope_type = 'team' and team_id is not null and employee_id is null)
  ),
  -- Un único aprobador vigente por persona (o equipo) y tipo de solicitud.
  add constraint manager_assignments_employee_excl exclude using gist (
    company_id with =, employee_id with =, request_type with =,
    tstzrange(valid_from, valid_to, '[)') with &&
  ) where (status = 'active' and scope_type = 'employee'),
  add constraint manager_assignments_team_excl exclude using gist (
    company_id with =, team_id with =, request_type with =,
    tstzrange(valid_from, valid_to, '[)') with &&
  ) where (status = 'active' and scope_type = 'team');

create index manager_assignments_team_idx on public.manager_assignments (team_id, status);

create trigger manager_assignments_keys before update on public.manager_assignments
  for each row execute function private.prevent_key_change(
    'id', 'company_id', 'employee_id', 'team_id', 'scope_type', 'request_type', 'manager_user_id'
  );

create trigger manager_assignments_employment after insert or update on public.manager_assignments
  for each row execute function private.check_assignment_within_employment();

create trigger employment_terms_employment after insert or update on public.employment_terms
  for each row execute function private.check_terms_within_employment();

-- -----------------------------------------------------------------------------
-- 5. Suplencias temporales
-- -----------------------------------------------------------------------------

create table public.approver_substitutions (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete restrict,
  absent_user_id     uuid not null references public.profiles (id) on delete restrict,
  substitute_user_id uuid not null references public.profiles (id) on delete restrict,
  request_type       public.approval_type not null default 'all',
  reason             text not null check (char_length(btrim(reason)) between 5 and 500),
  status             public.grant_status not null default 'active',
  valid_from         timestamptz not null default now(),
  -- Las suplencias son temporales: fin obligatorio y como mucho un año.
  valid_to           timestamptz not null,
  granted_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint approver_substitutions_validity_check check (
    valid_to > valid_from and valid_to <= valid_from + interval '1 year'
  ),
  constraint approver_substitutions_distinct_check check (absent_user_id <> substitute_user_id),
  constraint approver_substitutions_excl exclude using gist (
    company_id with =, absent_user_id with =, request_type with =,
    tstzrange(valid_from, valid_to, '[)') with &&
  ) where (status = 'active')
);

comment on table public.approver_substitutions is 'Suplencias temporales de aprobadores, con motivo.';

create index approver_substitutions_company_idx on public.approver_substitutions (company_id, status);
create index approver_substitutions_substitute_idx on public.approver_substitutions (substitute_user_id, status);

-- -----------------------------------------------------------------------------
-- 6. Funciones de supervisión y resolución de aprobador
-- -----------------------------------------------------------------------------

-- ¿Cubre al empleado una asignación vigente de p_user en el instante p_at?
-- Interna (no se concede a authenticated): solo la usan otras funciones.
create or replace function private.user_manages_employee(p_user uuid, p_employee uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.manager_assignments a
    join public.employees e on e.id = p_employee and e.company_id = a.company_id
    join public.companies c on c.id = a.company_id
    where a.manager_user_id = p_user
      and a.status = 'active'
      and a.valid_from <= p_at and (a.valid_to is null or a.valid_to > p_at)
      and (
        (a.scope_type = 'employee' and a.employee_id = p_employee)
        or (a.scope_type = 'team' and a.team_id = e.team_id)
      )
      and c.status = 'active'
      and private.user_has_current_membership_in_group(p_user, c.group_id)
  );
$$;

-- Supervisión directa o como suplente vigente.
create or replace function private.manages_employee(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.user_manages_employee((select auth.uid()), p_employee, now())
    or exists (
      select 1
      from public.approver_substitutions s
      join public.employees e on e.id = p_employee and e.company_id = s.company_id
      join public.companies c on c.id = s.company_id
      where s.substitute_user_id = (select auth.uid())
        and s.status = 'active'
        and private.is_active_window(s.valid_from, s.valid_to)
        and private.has_current_membership_in_group(c.group_id)
        and private.user_manages_employee(s.absent_user_id, p_employee, now())
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
    select 1 from public.employees e
    where e.company_id = target_company and private.manages_employee(e.id)
  );
$$;

-- Permiso del usuario actual sobre un equipo (según su centro).
create or replace function private.team_permission(p_team uuid, p_permission private.app_permission)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.has_permission(t.company_id, p_permission, t.work_center_id, t.id)
    from public.teams t
    where t.id = p_team
  ), false);
$$;

create or replace function private.assignment_permission(
  p_employee uuid,
  p_team uuid,
  p_permission private.app_permission
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_employee is not null then private.employee_permission(p_employee, p_permission)
    else private.team_permission(p_team, p_permission)
  end;
$$;

-- Resuelve el aprobador de un empleado para un tipo de solicitud en un instante.
-- Precedencia: persona+tipo > persona+todas > equipo+tipo > equipo+todas; después,
-- suplencia vigente del aprobador (tipo concreto > todas). Devuelve una fila o
-- lanza un error con código APROBADOR_* y una pista accionable.
create or replace function private.resolve_approver_internal(
  p_employee uuid,
  p_type public.approval_type,
  p_at timestamptz
)
returns table (approver_user_id uuid, manager_user_id uuid, assignment_id uuid, substitution_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  emp record;
  best_rank int;
  managers uuid[];
  chosen_assignment uuid;
  chosen_manager uuid;
  sub record;
  approver uuid;
  employee_user uuid;
begin
  select e.id, e.company_id, e.team_id, e.end_date, c.group_id
    into emp
  from public.employees e
  join public.companies c on c.id = e.company_id
  where e.id = p_employee;

  if emp.end_date is not null and (p_at at time zone 'Europe/Madrid')::date > emp.end_date then
    raise exception 'APROBADOR_EMPLEADO_DE_BAJA: la persona causó baja el %', emp.end_date
      using errcode = 'P0001', hint = 'No se admiten solicitudes posteriores a la baja.';
  end if;

  with candidates as (
    select a.id, a.manager_user_id,
      case
        when a.scope_type = 'employee' and a.request_type = p_type then 1
        when a.scope_type = 'employee' then 2
        when a.request_type = p_type then 3
        else 4
      end as rank
    from public.manager_assignments a
    where a.company_id = emp.company_id
      and a.status = 'active'
      and a.valid_from <= p_at and (a.valid_to is null or a.valid_to > p_at)
      and a.request_type in (p_type, 'all')
      and (
        (a.scope_type = 'employee' and a.employee_id = emp.id)
        or (a.scope_type = 'team' and emp.team_id is not null and a.team_id = emp.team_id)
      )
  )
  select min(rank) into best_rank from candidates;

  if best_rank is null then
    raise exception 'APROBADOR_NO_ASIGNADO: no hay ningún manager vigente para este tipo de solicitud'
      using errcode = 'P0001',
        hint = 'Asigna un manager a la persona o a su equipo en Administración > Aprobadores.';
  end if;

  select array_agg(distinct x.manager_user_id), min(x.id::text)::uuid
    into managers, chosen_assignment
  from (
    select a.id, a.manager_user_id,
      case
        when a.scope_type = 'employee' and a.request_type = p_type then 1
        when a.scope_type = 'employee' then 2
        when a.request_type = p_type then 3
        else 4
      end as rank
    from public.manager_assignments a
    where a.company_id = emp.company_id
      and a.status = 'active'
      and a.valid_from <= p_at and (a.valid_to is null or a.valid_to > p_at)
      and a.request_type in (p_type, 'all')
      and (
        (a.scope_type = 'employee' and a.employee_id = emp.id)
        or (a.scope_type = 'team' and emp.team_id is not null and a.team_id = emp.team_id)
      )
  ) x
  where x.rank = best_rank;

  if cardinality(managers) > 1 then
    raise exception 'APROBADOR_AMBIGUO: hay % managers con la misma prioridad', cardinality(managers)
      using errcode = 'P0001', hint = 'Cierra una de las asignaciones solapadas.';
  end if;
  chosen_manager := managers[1];

  if not private.user_has_current_membership_in_group(chosen_manager, emp.group_id) then
    raise exception 'APROBADOR_INACTIVO: el manager asignado ya no tiene una cuenta vigente en el grupo'
      using errcode = 'P0001', hint = 'Asigna otro manager o registra una suplencia.';
  end if;

  approver := chosen_manager;
  select s.id, s.substitute_user_id into sub
  from public.approver_substitutions s
  where s.company_id = emp.company_id
    and s.absent_user_id = chosen_manager
    and s.status = 'active'
    and s.valid_from <= p_at and s.valid_to > p_at
    and s.request_type in (p_type, 'all')
  order by (s.request_type = p_type) desc
  limit 1;

  if sub.id is not null then
    if not private.user_has_current_membership_in_group(sub.substitute_user_id, emp.group_id) then
      raise exception 'APROBADOR_INACTIVO: la persona suplente ya no tiene una cuenta vigente en el grupo'
        using errcode = 'P0001', hint = 'Revisa la suplencia.';
    end if;
    approver := sub.substitute_user_id;
  end if;

  select m.user_id into employee_user
  from public.employees e
  join public.company_memberships m on m.id = e.membership_id
  where e.id = emp.id;

  if approver = employee_user then
    raise exception 'APROBADOR_AUTOAPROBACION: la persona sería su propia aprobadora'
      using errcode = 'P0001', hint = 'Asigna a esta persona un manager específico.';
  end if;

  return query select approver, chosen_manager, chosen_assignment, sub.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Auditoría minimizada
-- -----------------------------------------------------------------------------

create table public.audit_events (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  actor_id       uuid,
  company_id     uuid,
  group_id       uuid,
  entity         text not null,
  entity_id      text,
  action         text not null check (action in (
    'create', 'update', 'deactivate', 'reactivate', 'terminate', 'export', 'import'
  )),
  changed_fields text[] not null default '{}',
  before         jsonb,
  after          jsonb
);

comment on table public.audit_events is
  'Auditoría de cambios sensibles: solo campos cambiados y datos personales enmascarados.';

create index audit_events_company_idx on public.audit_events (company_id, occurred_at desc);
create index audit_events_entity_idx on public.audit_events (entity, entity_id);

create trigger audit_events_immutable before update or delete on public.audit_events
  for each row execute function private.prevent_mutation();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function private.prevent_mutation();

-- Sustituye valores personales por una marca: se sabe que cambiaron, no a qué.
create or replace function private.minimize_audit_data(p_data jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(
    key,
    case
      when key in ('first_name', 'last_name', 'full_name', 'email', 'work_email', 'phone',
                   'tax_id', 'reason', 'address_line')
        and value <> 'null'::jsonb then to_jsonb('[dato personal]'::text)
      else value
    end
  ), '{}'::jsonb)
  from jsonb_each(p_data);
$$;

-- Argumentos: [0] columna con la empresa ('' si no aplica), [1] columna con el grupo.
create or replace function private.audit_event_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_column text := nullif(tg_argv[0], '');
  group_column text := nullif(tg_argv[1], '');
  old_data jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  new_data jsonb := to_jsonb(new);
  ignored text[] := array['created_at', 'updated_at', 'granted_by'];
  changed text[];
  event_action text;
  company uuid;
  grp uuid;
begin
  if tg_op = 'INSERT' then
    select coalesce(array_agg(key order by key), '{}') into changed
    from jsonb_each(new_data) where key <> all (ignored) and value <> 'null'::jsonb;
    event_action := 'create';
  else
    select coalesce(array_agg(key order by key), '{}') into changed
    from jsonb_each(new_data) n
    where n.key <> all (ignored) and n.value is distinct from old_data -> n.key;
    if cardinality(changed) = 0 then
      return null;
    end if;
    event_action := case
      when 'end_date' = any (changed) and new_data ->> 'end_date' is not null then 'terminate'
      when 'end_date' = any (changed) then 'reactivate'
      when 'status' = any (changed) and new_data ->> 'status' = 'active' then 'reactivate'
      when 'status' = any (changed) then 'deactivate'
      else 'update'
    end;
  end if;

  if company_column is not null then
    company := (new_data ->> company_column)::uuid;
  end if;
  if group_column is not null then
    grp := (new_data ->> group_column)::uuid;
  elsif company is not null then
    select c.group_id into grp from public.companies c where c.id = company;
  end if;

  insert into public.audit_events (
    actor_id, company_id, group_id, entity, entity_id, action, changed_fields, before, after
  )
  values (
    (select auth.uid()), company, grp, tg_table_name, new_data ->> 'id', event_action, changed,
    case when tg_op = 'UPDATE' then private.minimize_audit_data(
      (select jsonb_object_agg(key, value) from jsonb_each(old_data) where key = any (changed))
    ) end,
    private.minimize_audit_data(
      (select jsonb_object_agg(key, value) from jsonb_each(new_data) where key = any (changed))
    )
  );
  return null;
end;
$$;

create trigger audit_events_companies after insert or update on public.companies
  for each row execute function private.audit_event_row('id', 'group_id');
create trigger audit_events_group_admins after insert or update on public.group_admins
  for each row execute function private.audit_event_row('', 'group_id');
create trigger audit_events_work_centers after insert or update on public.work_centers
  for each row execute function private.audit_event_row('company_id');
create trigger audit_events_teams after insert or update on public.teams
  for each row execute function private.audit_event_row('company_id');
create trigger audit_events_company_memberships after insert or update on public.company_memberships
  for each row execute function private.audit_event_row('company_id');
create trigger audit_events_role_assignments after insert or update on public.role_assignments
  for each row execute function private.audit_event_row('company_id');
create trigger audit_events_employees after insert or update on public.employees
  for each row execute function private.audit_event_row('company_id');
create trigger audit_events_employment_terms after insert or update on public.employment_terms
  for each row execute function private.audit_event_row('company_id');
create trigger audit_events_manager_assignments after insert or update on public.manager_assignments
  for each row execute function private.audit_event_row('company_id');
create trigger audit_events_approver_substitutions after insert or update on public.approver_substitutions
  for each row execute function private.audit_event_row('company_id');

create trigger audit_approver_substitutions after insert or update or delete on public.approver_substitutions
  for each row execute function private.audit_row_change('company_id');
create trigger approver_substitutions_updated_at before update on public.approver_substitutions
  for each row execute function private.set_updated_at();
create trigger approver_substitutions_keys before update on public.approver_substitutions
  for each row execute function private.prevent_key_change(
    'id', 'company_id', 'absent_user_id', 'substitute_user_id', 'request_type', 'reason'
  );
create trigger approver_substitutions_granted_by before insert or update on public.approver_substitutions
  for each row execute function private.set_granted_by();

-- -----------------------------------------------------------------------------
-- 8. Funciones expuestas por la API (RPC)
-- -----------------------------------------------------------------------------

-- Permisos del propio usuario en una empresa (para adaptar la interfaz).
create or replace function public.my_company_permissions(p_company uuid)
returns table (permission text, scope_type text, work_center_id uuid, team_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p::text, 'company', null::uuid, null::uuid
  from unnest(enum_range(null::private.app_permission)) as p
  where private.is_group_admin_of_company(p_company)
  union
  select p::text, ra.scope_type::text, ra.work_center_id, ra.team_id
  from public.role_assignments ra
  cross join unnest(enum_range(null::private.app_permission)) as p
  where ra.company_id = p_company
    and ra.membership_id = private.current_membership_id(p_company)
    and ra.status = 'active'
    and private.is_active_window(ra.valid_from, ra.valid_to)
    and private.role_has_permission(ra.role, p);
$$;

-- Aprobador de un empleado. Solo para quien puede ver a ese empleado.
create or replace function public.resolve_approver(
  p_employee uuid,
  p_type public.approval_type default 'all',
  p_at timestamptz default now()
)
returns table (approver_user_id uuid, manager_user_id uuid, assignment_id uuid, substitution_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    private.is_self_employee(p_employee)
    or private.employee_permission(p_employee, 'employees.read')
    or private.manages_employee(p_employee)
  ) then
    raise exception 'Empleado no encontrado' using errcode = 'P0002';
  end if;
  return query select * from private.resolve_approver_internal(p_employee, p_type, p_at);
end;
$$;

-- Baja con fecha efectiva (último día incluido). Atómica: cierra condiciones,
-- asignaciones, roles y membresía. No borra nada.
create or replace function public.terminate_employee(p_employee uuid, p_last_day date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  emp record;
  boundary timestamptz := private.employment_end_instant(p_last_day);
  person uuid;
begin
  select e.id, e.company_id, e.membership_id, e.end_date into emp
  from public.employees e where e.id = p_employee;

  if emp.id is null or not private.employee_permission(p_employee, 'employees.manage') then
    raise exception 'Empleado no encontrado' using errcode = 'P0002';
  end if;
  if private.employee_belongs_to_user((select auth.uid()), p_employee) then
    raise exception 'No puedes tramitar tu propia baja' using errcode = '42501';
  end if;
  if emp.end_date is not null then
    raise exception 'La persona ya tiene una baja el %', emp.end_date
      using errcode = 'P0001', hint = 'Reactívala antes de registrar otra baja.';
  end if;

  select m.user_id into person from public.company_memberships m where m.id = emp.membership_id;

  -- Techo de privilegios: solo quien puede conceder company_admin da de baja a un administrador.
  if person is not null and exists (
    select 1 from public.role_assignments ra
    where ra.membership_id = emp.membership_id and ra.role = 'company_admin'
      and ra.status = 'active' and private.is_active_window(ra.valid_from, ra.valid_to)
  ) and not private.can_grant_role(emp.company_id, 'company_admin') then
    raise exception 'Solo la administración de la empresa puede dar de baja a un administrador'
      using errcode = '42501';
  end if;

  update public.employees set end_date = p_last_day where id = p_employee;

  -- Condiciones: se cierran en la baja; las que empezaban después se anulan.
  update public.employment_terms set status = 'ended'
  where employee_id = p_employee and status = 'active' and valid_from > p_last_day;
  update public.employment_terms set valid_to = p_last_day + 1
  where employee_id = p_employee and status = 'active'
    and (valid_to is null or valid_to > p_last_day + 1);

  -- Asignaciones donde la persona es supervisada.
  update public.manager_assignments set status = 'revoked'
  where employee_id = p_employee and status = 'active' and valid_from >= boundary;
  update public.manager_assignments set valid_to = boundary
  where employee_id = p_employee and status = 'active' and (valid_to is null or valid_to > boundary);

  if person is not null then
    -- Asignaciones y suplencias en esta empresa donde la persona aprueba.
    update public.manager_assignments set status = 'revoked'
    where company_id = emp.company_id and manager_user_id = person
      and status = 'active' and valid_from >= boundary;
    update public.manager_assignments set valid_to = boundary
    where company_id = emp.company_id and manager_user_id = person
      and status = 'active' and (valid_to is null or valid_to > boundary);
    update public.approver_substitutions set status = 'revoked'
    where company_id = emp.company_id and substitute_user_id = person
      and status = 'active' and valid_to > boundary;

    -- Roles y cuenta de esta empresa.
    update public.role_assignments set status = 'revoked'
    where membership_id = emp.membership_id and status = 'active' and valid_from >= boundary;
    update public.role_assignments set valid_to = boundary
    where membership_id = emp.membership_id and status = 'active'
      and (valid_to is null or valid_to > boundary);
    update public.company_memberships set valid_to = boundary
    where id = emp.membership_id and valid_from < boundary
      and (valid_to is null or valid_to > boundary);
  end if;
end;
$$;

-- Reactivación tras una baja: la ficha y la cuenta vuelven a estar vigentes.
-- Las condiciones, roles y asignaciones se registran de nuevo de forma explícita.
create or replace function public.reactivate_employee(p_employee uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  emp record;
begin
  select e.id, e.membership_id, e.end_date into emp from public.employees e where e.id = p_employee;
  if emp.id is null or not private.employee_permission(p_employee, 'employees.manage') then
    raise exception 'Empleado no encontrado' using errcode = 'P0002';
  end if;
  if private.employee_belongs_to_user((select auth.uid()), p_employee) then
    raise exception 'No puedes reactivarte a ti mismo' using errcode = '42501';
  end if;
  if emp.end_date is null then
    raise exception 'La persona no tiene ninguna baja registrada' using errcode = 'P0001';
  end if;

  update public.employees set end_date = null, status = 'active' where id = p_employee;
  if emp.membership_id is not null then
    update public.company_memberships set valid_to = null, status = 'active'
    where id = emp.membership_id;
  end if;
end;
$$;

-- Registro de exportaciones e importaciones (sin datos personales).
create or replace function public.log_admin_event(
  p_company uuid,
  p_action text,
  p_entity text,
  p_rows integer,
  p_filters jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_action not in ('export', 'import') or p_entity not in ('employees') then
    raise exception 'Evento no admitido' using errcode = '22023';
  end if;
  if not private.has_permission(
    p_company,
    case when p_action = 'export' then 'employees.read' else 'employees.manage' end::private.app_permission
  ) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  insert into public.audit_events (actor_id, company_id, group_id, entity, action, after)
  select (select auth.uid()), p_company, c.group_id, p_entity, p_action,
    jsonb_build_object('rows', greatest(coalesce(p_rows, 0), 0), 'filters', coalesce((
      select jsonb_object_agg(key, value) from jsonb_each(coalesce(p_filters, '{}'::jsonb))
      where key in ('status', 'situation', 'work_center_id', 'team_id', 'format')
    ), '{}'::jsonb))
  from public.companies c where c.id = p_company;
end;
$$;

-- Importación atómica de empleados (y sus condiciones iniciales). SECURITY
-- INVOKER: cada inserción pasa por RLS como si la hiciera el propio usuario.
-- Si una fila falla, no se escribe ninguna.
create or replace function public.import_employees(p_company uuid, p_rows jsonb)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  r jsonb;
  idx integer := 0;
  wc uuid;
  tm uuid;
  emp_id uuid;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No hay filas que importar' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 1000 then
    raise exception 'Máximo 1000 filas por importación' using errcode = '22023';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    idx := idx + 1;
    begin
      wc := null;
      tm := null;
      if coalesce(r ->> 'work_center_code', '') <> '' then
        select w.id into wc from public.work_centers w
        where w.company_id = p_company and w.code = r ->> 'work_center_code';
        if wc is null then
          raise exception 'el centro % no existe', r ->> 'work_center_code';
        end if;
      end if;
      if coalesce(r ->> 'team_name', '') <> '' then
        select t.id into tm from public.teams t
        where t.company_id = p_company and t.name = r ->> 'team_name';
        if tm is null then
          raise exception 'el equipo % no existe', r ->> 'team_name';
        end if;
      end if;

      insert into public.employees (company_id, employee_code, first_name, last_name, work_email,
        work_center_id, team_id)
      values (p_company, r ->> 'employee_code', r ->> 'first_name', r ->> 'last_name',
        nullif(r ->> 'work_email', ''), wc, tm)
      returning id into emp_id;

      if coalesce(r ->> 'contract_type', '') <> '' then
        insert into public.employment_terms (company_id, employee_id, contract_type, working_time,
          weekly_hours, job_title, valid_from)
        values (p_company, emp_id, (r ->> 'contract_type')::public.contract_type,
          coalesce(nullif(r ->> 'working_time', ''), 'full_time')::public.working_time,
          (r ->> 'weekly_hours')::numeric, nullif(r ->> 'job_title', ''),
          (r ->> 'valid_from')::date);
      end if;
    exception when others then
      raise exception 'Fila %: %', idx, sqlerrm using errcode = sqlstate;
    end;
  end loop;
  return idx;
end;
$$;

-- Cambio de condiciones con fecha de efecto, atómico: cierra las vigentes en
-- esa fecha y abre las nuevas. SECURITY INVOKER: RLS decide si se puede.
create or replace function public.change_employment_terms(
  p_employee uuid,
  p_effective date,
  p_contract_type public.contract_type,
  p_working_time public.working_time,
  p_weekly_hours numeric,
  p_job_title text default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  company uuid;
  new_id uuid;
begin
  select e.company_id into company from public.employees e where e.id = p_employee;
  if company is null then
    raise exception 'Empleado no encontrado' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.employment_terms t
    where t.employee_id = p_employee and t.status = 'active' and t.valid_from >= p_effective
  ) then
    raise exception 'Ya hay condiciones que empiezan el % o después', p_effective
      using errcode = 'P0001', hint = 'Elige una fecha de efecto posterior o corrige esas condiciones.';
  end if;

  update public.employment_terms set valid_to = p_effective
  where employee_id = p_employee and status = 'active'
    and valid_from < p_effective and (valid_to is null or valid_to > p_effective);

  insert into public.employment_terms (company_id, employee_id, contract_type, working_time,
    weekly_hours, job_title, valid_from)
  values (company, p_employee, p_contract_type, p_working_time, p_weekly_hours,
    nullif(btrim(p_job_title), ''), p_effective)
  returning id into new_id;
  return new_id;
end;
$$;

-- Busca por correo a una persona con cuenta vigente en el mismo grupo, para
-- nombrarla manager o suplente aunque sea de otra empresa. Solo para quien
-- gestiona asignaciones o membresías; nunca devuelve personas de otro grupo.
create or replace function public.find_group_user_by_email(p_company uuid, p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  join public.companies c on c.id = p_company
  where (
      private.has_permission(p_company, 'assignments.manage')
      or private.has_permission(p_company, 'members.manage')
    )
    and lower(p.email) = lower(btrim(p_email))
    and private.user_has_current_membership_in_group(p.id, c.group_id)
  limit 1;
$$;

-- Nombre visible de personas del grupo (managers y suplentes de otras empresas).
create or replace function public.group_user_labels(p_company uuid, p_users uuid[])
returns table (user_id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name
  from public.profiles p
  join public.companies c on c.id = p_company
  where p.id = any (p_users)
    and (
      private.has_permission(p_company, 'members.read')
      or private.has_permission(p_company, 'employees.read')
      or private.has_permission(p_company, 'assignments.manage')
    )
    and private.user_has_current_membership_in_group(p.id, c.group_id)
  limit 500;
$$;

-- -----------------------------------------------------------------------------
-- 9. Privilegios
-- -----------------------------------------------------------------------------

revoke all on function
  private.employee_active_on(uuid, date),
  private.employment_end_instant(date),
  private.check_terms_within_employment(),
  private.check_assignment_within_employment(),
  private.user_manages_employee(uuid, uuid, timestamptz),
  private.team_permission(uuid, private.app_permission),
  private.assignment_permission(uuid, uuid, private.app_permission),
  private.resolve_approver_internal(uuid, public.approval_type, timestamptz),
  private.minimize_audit_data(jsonb),
  private.audit_event_row()
from public;

grant execute on function
  private.employee_active_on(uuid, date),
  private.employment_end_instant(date),
  private.team_permission(uuid, private.app_permission),
  private.assignment_permission(uuid, uuid, private.app_permission)
to authenticated, service_role;

revoke all on function
  public.my_company_permissions(uuid),
  public.resolve_approver(uuid, public.approval_type, timestamptz),
  public.terminate_employee(uuid, date),
  public.reactivate_employee(uuid),
  public.log_admin_event(uuid, text, text, integer, jsonb),
  public.import_employees(uuid, jsonb),
  public.find_group_user_by_email(uuid, text),
  public.group_user_labels(uuid, uuid[]),
  public.change_employment_terms(uuid, date, public.contract_type, public.working_time, numeric, text)
from public, anon;

grant execute on function
  public.my_company_permissions(uuid),
  public.resolve_approver(uuid, public.approval_type, timestamptz),
  public.terminate_employee(uuid, date),
  public.reactivate_employee(uuid),
  public.log_admin_event(uuid, text, text, integer, jsonb),
  public.import_employees(uuid, jsonb),
  public.find_group_user_by_email(uuid, text),
  public.group_user_labels(uuid, uuid[]),
  public.change_employment_terms(uuid, date, public.contract_type, public.working_time, numeric, text)
to authenticated, service_role;

revoke all on public.approver_substitutions, public.audit_events from anon, authenticated;

grant select on public.approver_substitutions to authenticated;
grant insert (company_id, absent_user_id, substitute_user_id, request_type, reason, valid_from,
  valid_to) on public.approver_substitutions to authenticated;
grant update (status, valid_to) on public.approver_substitutions to authenticated;

grant select on public.audit_events to authenticated;

grant insert (scope_type, team_id, request_type) on public.manager_assignments to authenticated;

-- -----------------------------------------------------------------------------
-- 10. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.approver_substitutions enable row level security;
alter table public.audit_events enable row level security;

create policy "manager_assignments_select" on public.manager_assignments
  for select to authenticated
  using (
    manager_user_id = (select auth.uid())
    or (employee_id is not null and private.is_self_employee(employee_id))
    or private.assignment_permission(employee_id, team_id, 'employees.read')
  );

create policy "manager_assignments_insert" on public.manager_assignments
  for insert to authenticated
  with check (
    private.assignment_permission(employee_id, team_id, 'assignments.manage')
    and manager_user_id <> (select auth.uid())
    and (employee_id is null or not private.employee_belongs_to_user(manager_user_id, employee_id))
    and private.is_eligible_manager(manager_user_id, company_id)
  );

create policy "manager_assignments_update" on public.manager_assignments
  for update to authenticated
  using (
    private.assignment_permission(employee_id, team_id, 'assignments.manage')
    and manager_user_id <> (select auth.uid())
  )
  with check (
    private.assignment_permission(employee_id, team_id, 'assignments.manage')
    and manager_user_id <> (select auth.uid())
  );

create policy "approver_substitutions_select" on public.approver_substitutions
  for select to authenticated
  using (
    absent_user_id = (select auth.uid())
    or substitute_user_id = (select auth.uid())
    or private.has_permission(company_id, 'members.read')
  );

create policy "approver_substitutions_insert" on public.approver_substitutions
  for insert to authenticated
  with check (
    private.has_permission(company_id, 'assignments.manage')
    and absent_user_id <> (select auth.uid())
    and substitute_user_id <> (select auth.uid())
    and private.is_eligible_manager(substitute_user_id, company_id)
  );

create policy "approver_substitutions_update" on public.approver_substitutions
  for update to authenticated
  using (
    private.has_permission(company_id, 'assignments.manage')
    and absent_user_id <> (select auth.uid())
    and substitute_user_id <> (select auth.uid())
  )
  with check (
    private.has_permission(company_id, 'assignments.manage')
    and absent_user_id <> (select auth.uid())
    and substitute_user_id <> (select auth.uid())
  );

create policy "audit_events_select" on public.audit_events
  for select to authenticated
  using (
    (company_id is not null and private.has_permission(company_id, 'audit.read'))
    or (company_id is null and group_id is not null and private.is_group_admin(group_id))
  );
