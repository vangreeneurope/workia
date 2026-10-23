-- =============================================================================
-- Calendarios laborales, plantillas de turno versionadas y asignaciones.
--
-- Tiempo sin coma flotante: los tramos son minutos enteros desde la medianoche
-- local del día del turno (0..2880; >1440 = día siguiente). La zona horaria es
-- la del centro de trabajo (o la de la empresa); la conversión a UTC la hace el
-- resolvedor con las reglas de docs/HORARIOS.md.
--
-- Nada con efecto en el pasado: publicar, cerrar o cambiar festivos solo se
-- admite desde la "fecha abierta" (hoy en la zona de la empresa). Las versiones
-- publicadas son inmutables.
--
-- Reversión: supabase/rollbacks/20261024100000_calendarios_turnos.down.sql
-- Las funciones SECURITY DEFINER siguen las reglas de
-- 20261022100000_modelo_multiempresa.sql; las de public comprueban permisos al
-- principio y derivan la empresa de los datos, nunca del cliente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------

create type public.calendar_scope as enum ('national', 'regional', 'local', 'company');
create type public.shift_kind as enum ('continuous', 'split', 'night', 'flexible');
create type public.segment_kind as enum ('work', 'break');
create type public.schedule_status as enum ('draft', 'published', 'revoked');
create type public.shift_assignment_scope as enum ('exception', 'employee', 'team', 'contract');

-- La zona horaria de empresas y centros decide la conversión de los turnos a
-- instantes reales: solo se admiten nombres IANA que PostgreSQL conoce.
create or replace function private.is_valid_time_zone(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_name);
$$;

alter table public.companies
  add constraint companies_timezone_check check (private.is_valid_time_zone(timezone));
alter table public.work_centers
  add constraint work_centers_timezone_check check (private.is_valid_time_zone(timezone));

-- -----------------------------------------------------------------------------
-- 2. Permisos de horarios
-- -----------------------------------------------------------------------------

-- Matriz rol -> acción sobre horarios ('read' | 'manage'). Función aparte de
-- role_has_permission para no alterar el enum app_permission (ADR-030).
create or replace function private.role_has_schedule_permission(p_role public.app_role, p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'company_admin' then p_action in ('read', 'manage')
    when 'hr' then p_action in ('read', 'manage')
    when 'auditor' then p_action = 'read'
    else false
  end;
$$;

create or replace function private.has_schedule_permission(
  p_company uuid,
  p_action text,
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
        and private.role_has_schedule_permission(ra.role, p_action)
        and (
          ra.scope_type = 'company'
          or (ra.scope_type = 'work_center' and ra.work_center_id = p_work_center)
          or (ra.scope_type = 'team' and ra.team_id = p_team)
        )
    )
  );
$$;

create or replace function private.employee_schedule_permission(p_employee uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.has_schedule_permission(e.company_id, p_action, e.work_center_id, e.team_id)
    from public.employees e where e.id = p_employee
  ), false);
$$;

create or replace function private.team_schedule_permission(p_team uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.has_schedule_permission(t.company_id, p_action, t.work_center_id, t.id)
    from public.teams t where t.id = p_team
  ), false);
$$;

-- ¿Puede el usuario actual ver el horario de ese empleado? (él mismo, su
-- manager vigente o quien tenga permiso de lectura en su ámbito)
create or replace function private.can_read_employee_schedule(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_self_employee(p_employee)
    or private.manages_employee(p_employee)
    or private.employee_schedule_permission(p_employee, 'read');
$$;

create or replace function private.can_read_team_schedule(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.team_schedule_permission(p_team, 'read')
    or exists (
      select 1 from public.employees e
      where e.team_id = p_team
        and (private.is_self_employee(e.id) or private.manages_employee(e.id))
    );
$$;

-- Primer día que aún se puede planificar: hoy en la zona horaria de la empresa.
create or replace function private.planning_open_from(p_company uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone c.timezone)::date from public.companies c where c.id = p_company;
$$;

-- -----------------------------------------------------------------------------
-- 3. Calendarios laborales
-- -----------------------------------------------------------------------------

create table public.holiday_calendars (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete restrict,
  name                   text not null check (char_length(btrim(name)) between 2 and 120),
  scope                  public.calendar_scope not null,
  -- Código ISO 3166-2 para calendarios autonómicos o locales (p. ej. ES-MD).
  region_code            text check (region_code is null or region_code ~ '^ES(-[A-Z]{1,3})?$'),
  locality               text check (locality is null or char_length(locality) <= 120),
  applies_to_all_centers boolean not null default false,
  -- Fuente validada obligatoria (BOE, boletín autonómico, acuerdo, decisión de empresa).
  source_reference       text not null check (char_length(btrim(source_reference)) between 3 and 300),
  status                 public.entity_status not null default 'active',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id)
);

comment on table public.holiday_calendars is
  'Calendarios de festivos con su fuente. No se precargan festivos reales (docs/HORARIOS.md).';

-- Calendarios aplicados a centros concretos, con vigencia (no retroactiva).
create table public.work_center_holiday_calendars (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete restrict,
  work_center_id uuid not null,
  calendar_id    uuid not null,
  valid_from     date not null,
  valid_to       date check (valid_to is null or valid_to > valid_from),
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (work_center_id, company_id) references public.work_centers (id, company_id),
  foreign key (calendar_id, company_id) references public.holiday_calendars (id, company_id),
  constraint work_center_holiday_calendars_excl exclude using gist (
    work_center_id with =, calendar_id with =, daterange(valid_from, valid_to, '[)') with &&
  )
);

create index work_center_holiday_calendars_center_idx on public.work_center_holiday_calendars (work_center_id);

create table public.holidays (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  calendar_id  uuid not null,
  holiday_date date not null,
  name         text not null check (char_length(btrim(name)) between 2 and 120),
  status       public.entity_status not null default 'active',
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, calendar_id, holiday_date),
  foreign key (calendar_id, company_id) references public.holiday_calendars (id, company_id)
);

create index holidays_date_idx on public.holidays (company_id, holiday_date);

-- -----------------------------------------------------------------------------
-- 4. Plantillas de turno versionadas
-- -----------------------------------------------------------------------------

create table public.shift_templates (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  code       text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name       text not null check (char_length(btrim(name)) between 2 and 120),
  status     public.entity_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (id, company_id)
);

create table public.shift_template_versions (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies (id) on delete restrict,
  template_id             uuid not null,
  version                 integer not null check (version >= 1),
  kind                    public.shift_kind not null,
  -- Horas objetivo del día en minutos enteros.
  target_minutes          integer not null check (target_minutes between 0 and 1440),
  tolerance_early_minutes integer not null default 0 check (tolerance_early_minutes between 0 and 240),
  tolerance_late_minutes  integer not null default 0 check (tolerance_late_minutes between 0 and 240),
  -- Jornada flexible: ventana en la que deben cumplirse las horas objetivo.
  flex_window_start       integer check (flex_window_start between 0 and 2879),
  flex_window_end         integer check (flex_window_end between 1 and 2880),
  status                  public.schedule_status not null default 'draft',
  valid_from              date,
  valid_to                date,
  published_by            uuid references public.profiles (id) on delete set null,
  published_at            timestamptz,
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (company_id, template_id, version),
  unique (id, company_id),
  foreign key (template_id, company_id) references public.shift_templates (id, company_id),
  constraint shift_template_versions_flex_check check (
    (kind = 'flexible' and flex_window_start is not null and flex_window_end > flex_window_start
      and flex_window_end - flex_window_start <= 1440)
    or (kind <> 'flexible' and flex_window_start is null and flex_window_end is null)
  ),
  constraint shift_template_versions_published_check check (
    status <> 'published'
    or (valid_from is not null and published_at is not null and (valid_to is null or valid_to > valid_from))
  ),
  -- Nunca dos versiones publicadas de la misma plantilla para el mismo día.
  constraint shift_template_versions_excl exclude using gist (
    template_id with =, daterange(valid_from, valid_to, '[)') with &&
  ) where (status = 'published')
);

create table public.shift_template_segments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  version_id   uuid not null,
  position     smallint not null check (position between 1 and 20),
  start_minute integer not null check (start_minute between 0 and 2879),
  end_minute   integer not null check (end_minute between 1 and 2880),
  kind         public.segment_kind not null default 'work',
  paid         boolean not null default true,
  constraint shift_template_segments_order_check check (end_minute > start_minute),
  constraint shift_template_segments_paid_check check (kind = 'break' or paid),
  unique (version_id, position),
  foreign key (version_id, company_id)
    references public.shift_template_versions (id, company_id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- 5. Asignaciones de turno con vigencia y recurrencia
-- -----------------------------------------------------------------------------

alter table public.employment_terms
  add constraint employment_terms_id_company_employee_key unique (id, company_id, employee_id);

create table public.shift_assignments (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete restrict,
  scope_type          public.shift_assignment_scope not null,
  employee_id         uuid,
  team_id             uuid,
  employment_terms_id uuid,
  valid_from          date not null,
  valid_to            date check (valid_to is null or valid_to > valid_from),
  -- Recurrencia: ciclo de N días anclado en anchor_date (7 = semanal).
  cycle_days          smallint not null default 7 check (cycle_days between 1 and 56),
  anchor_date         date not null,
  status              public.schedule_status not null default 'draft',
  note                text check (note is null or char_length(note) <= 300),
  created_by          uuid references public.profiles (id) on delete set null,
  published_by        uuid references public.profiles (id) on delete set null,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, company_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (team_id, company_id) references public.teams (id, company_id),
  foreign key (employment_terms_id, company_id, employee_id)
    references public.employment_terms (id, company_id, employee_id),
  constraint shift_assignments_scope_check check (
    (scope_type in ('exception', 'employee') and employee_id is not null and team_id is null
      and employment_terms_id is null)
    or (scope_type = 'team' and team_id is not null and employee_id is null and employment_terms_id is null)
    or (scope_type = 'contract' and employment_terms_id is not null and employee_id is not null
      and team_id is null)
  ),
  -- Una excepción es puntual: fin obligatorio y como mucho 31 días.
  constraint shift_assignments_exception_check check (
    scope_type <> 'exception' or (valid_to is not null and valid_to - valid_from <= 31)
  ),
  constraint shift_assignments_published_check check (status <> 'published' or published_at is not null),
  -- Un único horario publicado por nivel de precedencia y sujeto para cada día.
  constraint shift_assignments_exception_excl exclude using gist (
    employee_id with =, daterange(valid_from, valid_to, '[)') with &&
  ) where (status = 'published' and scope_type = 'exception'),
  constraint shift_assignments_employee_excl exclude using gist (
    employee_id with =, daterange(valid_from, valid_to, '[)') with &&
  ) where (status = 'published' and scope_type = 'employee'),
  constraint shift_assignments_team_excl exclude using gist (
    team_id with =, daterange(valid_from, valid_to, '[)') with &&
  ) where (status = 'published' and scope_type = 'team'),
  constraint shift_assignments_contract_excl exclude using gist (
    employment_terms_id with =, daterange(valid_from, valid_to, '[)') with &&
  ) where (status = 'published' and scope_type = 'contract')
);

create index shift_assignments_employee_idx on public.shift_assignments (employee_id, status);
create index shift_assignments_team_idx on public.shift_assignments (team_id, status);
create index shift_assignments_company_idx on public.shift_assignments (company_id, status, valid_from);

-- Plantilla de cada día del ciclo; template_id null = descanso.
create table public.shift_assignment_days (
  assignment_id uuid not null,
  company_id    uuid not null references public.companies (id) on delete restrict,
  day_index     smallint not null check (day_index between 0 and 55),
  template_id   uuid,
  primary key (assignment_id, day_index),
  foreign key (assignment_id, company_id)
    references public.shift_assignments (id, company_id) on delete cascade,
  foreign key (template_id, company_id) references public.shift_templates (id, company_id)
);

-- -----------------------------------------------------------------------------
-- 6. Ausencias aprobadas (punto de integración con el módulo de ausencias)
-- -----------------------------------------------------------------------------

create table public.leave_periods (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  employee_id uuid not null,
  starts_on   date not null,
  ends_on     date not null, -- incluido
  status      text not null default 'approved' check (status in ('approved', 'cancelled')),
  created_at  timestamptz not null default now(),
  constraint leave_periods_dates_check check (ends_on >= starts_on),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);

comment on table public.leave_periods is
  'Ausencias aprobadas. Hoy solo la usa la detección de conflictos; la rellenará el módulo de ausencias.';

create index leave_periods_employee_idx on public.leave_periods (employee_id, starts_on);

-- -----------------------------------------------------------------------------
-- 7. Eventos de cambio (bandeja de salida de notificaciones)
-- -----------------------------------------------------------------------------

create table public.schedule_events (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.companies (id) on delete restrict,
  employee_id  uuid not null,
  event_type   text not null check (event_type in (
    'shift_assignment_published', 'shift_assignment_changed', 'shift_template_published'
  )),
  -- Sin datos personales: ids, fechas y versión.
  payload      jsonb not null default '{}'::jsonb,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  -- Lo marcará el futuro proveedor de notificaciones (con service_role).
  delivered_at timestamptz,
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);

create index schedule_events_employee_idx on public.schedule_events (employee_id, created_at desc);
create index schedule_events_pending_idx on public.schedule_events (created_at) where delivered_at is null;

-- -----------------------------------------------------------------------------
-- 8. Reglas de integridad
-- -----------------------------------------------------------------------------

-- Validación de una versión de plantilla. Devuelve la lista de problemas (vacía
-- si es válida). Reglas idénticas a src/features/schedules/template-rules.ts.
create or replace function private.template_version_problems(p_version uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v record;
  problems text[] := '{}';
  work_count integer;
  first_start integer;
  last_end integer;
  first_work integer;
  last_work integer;
  computed integer;
  has_gap boolean;
begin
  select * into v from public.shift_template_versions where id = p_version;

  select count(*) filter (where kind = 'work'), min(start_minute), max(end_minute),
    min(start_minute) filter (where kind = 'work'), max(end_minute) filter (where kind = 'work'),
    coalesce(sum(end_minute - start_minute) filter (where kind = 'work' or paid), 0)
  into work_count, first_start, last_end, first_work, last_work, computed
  from public.shift_template_segments where version_id = p_version;

  if v.kind <> 'flexible' and work_count = 0 then
    problems := problems || 'Añade al menos un tramo de trabajo.';
  end if;
  if exists (
    select 1 from public.shift_template_segments a
    join public.shift_template_segments b
      on a.version_id = b.version_id and a.id <> b.id
     and a.start_minute < b.end_minute and b.start_minute < a.end_minute
    where a.version_id = p_version
  ) then
    problems := problems || 'Hay tramos que se solapan.';
  end if;
  if first_start is not null and first_start >= 1440 then
    problems := problems || 'El turno debe empezar en su propio día (antes de las 24:00).';
  end if;
  if first_start is not null and last_end - first_start > 1440 then
    problems := problems || 'Un turno no puede durar más de 24 horas.';
  end if;
  if exists (
    select 1 from public.shift_template_segments
    where version_id = p_version and kind = 'break'
      and (first_work is null or start_minute < first_work or end_minute > last_work)
  ) then
    problems := problems || 'Las pausas deben quedar dentro de la jornada.';
  end if;

  -- Huecos sin cubrir entre el primer y el último tramo de trabajo.
  select exists (
    select 1 from (
      select end_minute,
        lead(start_minute) over (order by start_minute) as next_start
      from public.shift_template_segments where version_id = p_version
    ) s where s.next_start is not null and s.next_start > s.end_minute
  ) into has_gap;

  if v.kind = 'flexible' then
    if v.target_minutes > v.flex_window_end - v.flex_window_start then
      problems := problems || 'Las horas objetivo no caben en la ventana flexible.';
    end if;
    if exists (
      select 1 from public.shift_template_segments
      where version_id = p_version
        and (start_minute < v.flex_window_start or end_minute > v.flex_window_end)
    ) then
      problems := problems || 'La presencia obligatoria debe estar dentro de la ventana flexible.';
    end if;
  else
    if v.target_minutes <> computed then
      problems := problems || format('Las horas objetivo (%s min) no coinciden con los tramos (%s min).',
        v.target_minutes, computed);
    end if;
    if v.kind = 'continuous' and has_gap then
      problems := problems || 'Una jornada continua no puede tener huecos entre tramos.';
    end if;
    if v.kind = 'split' and (work_count < 2 or not has_gap) then
      problems := problems || 'Una jornada partida necesita dos tramos de trabajo con un hueco entre ellos.';
    end if;
    if v.kind = 'night' and not exists (
      select 1 from public.shift_template_segments
      where version_id = p_version and kind = 'work'
        and (start_minute < 360 or end_minute > 1320)
    ) then
      problems := problems || 'Una jornada nocturna debe incluir trabajo entre las 22:00 y las 06:00.';
    end if;
  end if;
  return problems;
end;
$$;

-- Versiones publicadas y sus tramos son inmutables (salvo cerrar su vigencia
-- desde la fecha abierta, que solo hace publish_shift_template_version).
create or replace function private.guard_template_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'Una versión publicada no se puede borrar' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status = 'published' then
    if (to_jsonb(new) - 'valid_to' - 'updated_at') <> (to_jsonb(old) - 'valid_to' - 'updated_at') then
      raise exception 'Una versión publicada no se modifica: crea una versión nueva'
        using errcode = '42501';
    end if;
    if new.valid_to is distinct from old.valid_to
       and (new.valid_to is null or new.valid_to < private.planning_open_from(old.company_id)) then
      raise exception 'No se puede cerrar una versión con efecto en el pasado' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.guard_template_segment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  version_status public.schedule_status;
begin
  select status into version_status from public.shift_template_versions
  where id = coalesce(new.version_id, old.version_id);
  if version_status = 'published' then
    raise exception 'Los tramos de una versión publicada no se modifican' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- Asignaciones publicadas: solo cambian estado (revocar) y fin, nunca hacia el pasado.
create or replace function private.guard_shift_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  open_from date := private.planning_open_from(old.company_id);
begin
  if old.status = 'draft' then
    return new;
  end if;
  if (to_jsonb(new) - 'valid_to' - 'status' - 'updated_at')
     <> (to_jsonb(old) - 'valid_to' - 'status' - 'updated_at') then
    raise exception 'Una asignación publicada no se modifica: ciérrala y crea otra' using errcode = '42501';
  end if;
  if new.valid_to is distinct from old.valid_to
     and (new.valid_to is null or new.valid_to < open_from) then
    raise exception 'No se puede acortar una asignación hacia el pasado (primer día abierto: %)', open_from
      using errcode = '42501';
  end if;
  if new.status = 'revoked' and old.status = 'published' and old.valid_from < open_from then
    raise exception 'Una asignación ya iniciada no se revoca: ciérrala desde hoy' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function private.guard_assignment_day()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  assignment_status public.schedule_status;
begin
  select status into assignment_status from public.shift_assignments
  where id = coalesce(new.assignment_id, old.assignment_id);
  if assignment_status is distinct from 'draft' then
    raise exception 'Los días de una asignación publicada no se modifican' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- Festivos: nada con fecha pasada ni cambios de aplicación retroactivos.
create or replace function private.guard_holiday()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  open_from date := private.planning_open_from(new.company_id);
begin
  if tg_op = 'INSERT' and new.holiday_date < open_from then
    raise exception 'No se registran festivos en fechas pasadas (primer día abierto: %)', open_from
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.holiday_date < open_from
     and (new.status, new.name) is distinct from (old.status, old.name) then
    raise exception 'Un festivo pasado no se modifica' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function private.guard_calendar_link()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  open_from date := private.planning_open_from(new.company_id);
begin
  if tg_op = 'INSERT' and new.valid_from < open_from then
    raise exception 'Un calendario se aplica a un centro desde hoy o una fecha futura' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.valid_to is distinct from old.valid_to
     and (new.valid_to is null or new.valid_to < open_from) then
    raise exception 'No se puede retirar un calendario con efecto en el pasado' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Destinatarios, conflictos y publicación
-- -----------------------------------------------------------------------------

-- Empleados afectados por una asignación (la persona o los miembros del equipo).
create or replace function private.assignment_recipients(p_assignment uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(a.employee_id, e.id)
  from public.shift_assignments a
  left join public.employees e on a.scope_type = 'team' and e.team_id = a.team_id
  where a.id = p_assignment
    and (a.employee_id is not null or e.id is not null);
$$;

-- Conflictos de una asignación antes de publicarla. 'error' bloquea; 'warning'
-- exige confirmación explícita. Agrupados por persona y tipo, sin nombres.
create or replace function private.assignment_conflicts_internal(p_assignment uuid)
returns table (severity text, code text, employee_code text, first_day date, last_day date, days integer, message text)
language sql
stable
security definer
set search_path = ''
as $$
  with a as (
    select * from public.shift_assignments where id = p_assignment
  ),
  horizon as (
    select greatest(a.valid_from, private.planning_open_from(a.company_id)) as from_day,
      least(coalesce(a.valid_to - 1, a.valid_from + 365), a.valid_from + 400) as to_day
    from a
  ),
  work_days as (
    select d::date as day
    from a
    cross join horizon
    cross join generate_series(horizon.from_day, horizon.to_day, interval '1 day') d
    join public.shift_assignment_days sd
      on sd.assignment_id = a.id
     and sd.day_index = ((((d::date - a.anchor_date) % a.cycle_days) + a.cycle_days) % a.cycle_days)
    where sd.template_id is not null
  ),
  people as (
    select e.id, e.employee_code, e.end_date
    from public.employees e
    where e.id in (select private.assignment_recipients(p_assignment))
  ),
  overlapping as (
    select 'error'::text as severity, 'OVERLAP'::text as code, null::text as employee_code,
      greatest(o.valid_from, a.valid_from) as first_day,
      least(coalesce(o.valid_to, 'infinity'::date), coalesce(a.valid_to, 'infinity'::date)) - 1 as last_day,
      null::integer as days,
      'Ya hay un horario publicado del mismo nivel para esas fechas: ciérralo antes de publicar.'::text as message
    from a
    join public.shift_assignments o
      on o.id <> a.id and o.status = 'published' and o.scope_type = a.scope_type
     and o.employee_id is not distinct from a.employee_id
     and o.team_id is not distinct from a.team_id
     and o.employment_terms_id is not distinct from a.employment_terms_id
     and daterange(o.valid_from, o.valid_to, '[)') && daterange(a.valid_from, a.valid_to, '[)')
  ),
  missing_versions as (
    select 'error'::text, 'TEMPLATE_WITHOUT_VERSION'::text, null::text,
      min(w.day), max(w.day), count(*)::integer,
      format('La plantilla %s no tiene una versión publicada para algunos días.', t.code)
    from a
    cross join work_days w
    join public.shift_assignment_days sd
      on sd.assignment_id = a.id
     and sd.day_index = ((((w.day - a.anchor_date) % a.cycle_days) + a.cycle_days) % a.cycle_days)
    join public.shift_templates t on t.id = sd.template_id
    where not exists (
      select 1 from public.shift_template_versions v
      where v.template_id = sd.template_id and v.status = 'published'
        and v.valid_from <= w.day and (v.valid_to is null or v.valid_to > w.day)
    )
    group by t.code
  ),
  absences as (
    select 'warning'::text, 'ABSENCE'::text, p.employee_code,
      min(w.day), max(w.day), count(*)::integer,
      'Hay ausencias aprobadas en días con turno asignado.'::text
    from people p
    cross join work_days w
    where exists (
      select 1 from public.leave_periods l
      where l.employee_id = p.id and l.status = 'approved'
        and w.day between l.starts_on and l.ends_on
    )
    group by p.employee_code
  ),
  terminated as (
    select 'warning'::text, 'AFTER_TERMINATION'::text, p.employee_code,
      min(w.day), max(w.day), count(*)::integer,
      'La persona causa baja antes de algunos días con turno.'::text
    from people p
    cross join work_days w
    where p.end_date is not null and w.day > p.end_date
    group by p.employee_code
  ),
  no_contract as (
    select 'warning'::text, 'NO_CONTRACT'::text, p.employee_code,
      min(w.day), max(w.day), count(*)::integer,
      'Hay días con turno sin condiciones de empleo vigentes.'::text
    from people p
    cross join work_days w
    where (p.end_date is null or w.day <= p.end_date)
      and not exists (
        select 1 from public.employment_terms t
        where t.employee_id = p.id and t.status = 'active'
          and t.valid_from <= w.day and (t.valid_to is null or t.valid_to > w.day)
      )
    group by p.employee_code
  )
  select * from overlapping
  union all select * from missing_versions
  union all select * from absences
  union all select * from terminated
  union all select * from no_contract;
$$;

create or replace function public.shift_assignment_conflicts(p_assignment uuid)
returns table (severity text, code text, employee_code text, first_day date, last_day date, days integer, message text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a record;
begin
  select * into a from public.shift_assignments where id = p_assignment;
  if a.id is null or not (
    case when a.scope_type = 'team' then private.team_schedule_permission(a.team_id, 'manage')
         else private.employee_schedule_permission(a.employee_id, 'manage') end
  ) then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;
  return query select * from private.assignment_conflicts_internal(p_assignment);
end;
$$;

-- Guarda (crea o reemplaza) un borrador de asignación con sus días de ciclo.
create or replace function public.save_shift_assignment(
  p_scope public.shift_assignment_scope,
  p_valid_from date,
  p_cycle_days smallint,
  p_days uuid[],
  p_id uuid default null,
  p_employee uuid default null,
  p_team uuid default null,
  p_terms uuid default null,
  p_valid_to date default null,
  p_anchor date default null,
  p_note text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  company uuid;
  employee uuid := p_employee;
  allowed boolean;
  saved uuid;
begin
  if p_scope = 'team' then
    select t.company_id into company from public.teams t where t.id = p_team;
    allowed := private.team_schedule_permission(p_team, 'manage');
  else
    if p_scope = 'contract' then
      select t.employee_id into employee from public.employment_terms t where t.id = p_terms;
    end if;
    select e.company_id into company from public.employees e where e.id = employee;
    allowed := private.employee_schedule_permission(employee, 'manage');
  end if;
  if company is null or not coalesce(allowed, false) then
    raise exception 'No encontrado o sin permiso' using errcode = 'P0002';
  end if;
  if p_valid_from < private.planning_open_from(company) then
    raise exception 'Un horario nuevo empieza hoy o en una fecha futura' using errcode = '22023',
      hint = 'Los periodos pasados no se recalculan.';
  end if;
  if coalesce(array_length(p_days, 1), 0) <> p_cycle_days then
    raise exception 'Indica la plantilla (o descanso) de cada uno de los % días del ciclo', p_cycle_days
      using errcode = '22023';
  end if;

  if p_id is not null then
    if not exists (
      select 1 from public.shift_assignments
      where id = p_id and company_id = company and status = 'draft'
    ) then
      raise exception 'Solo se editan borradores de la misma empresa' using errcode = '42501';
    end if;
    update public.shift_assignments set
      scope_type = p_scope,
      employee_id = case when p_scope = 'team' then null else employee end,
      team_id = case when p_scope = 'team' then p_team end,
      employment_terms_id = case when p_scope = 'contract' then p_terms end,
      valid_from = p_valid_from, valid_to = p_valid_to, cycle_days = p_cycle_days,
      anchor_date = coalesce(p_anchor, p_valid_from), note = nullif(btrim(p_note), '')
    where id = p_id;
    delete from public.shift_assignment_days where assignment_id = p_id;
    saved := p_id;
  else
    insert into public.shift_assignments (company_id, scope_type, employee_id, team_id,
      employment_terms_id, valid_from, valid_to, cycle_days, anchor_date, note, created_by)
    values (company, p_scope,
      case when p_scope = 'team' then null else employee end,
      case when p_scope = 'team' then p_team end,
      case when p_scope = 'contract' then p_terms end,
      p_valid_from, p_valid_to, p_cycle_days, coalesce(p_anchor, p_valid_from),
      nullif(btrim(p_note), ''), (select auth.uid()))
    returning id into saved;
  end if;

  insert into public.shift_assignment_days (assignment_id, company_id, day_index, template_id)
  select saved, company, (i - 1)::smallint, p_days[i]
  from generate_subscripts(p_days, 1) as i;
  return saved;
end;
$$;

-- Publica una asignación: bloquea con errores y exige aceptar los avisos.
-- Registra quién publica y crea un evento por cada persona afectada.
create or replace function public.publish_shift_assignment(p_id uuid, p_accept_warnings boolean default false)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a record;
  errors integer;
  warnings integer;
  notified integer;
begin
  select * into a from public.shift_assignments where id = p_id;
  if a.id is null or not (
    case when a.scope_type = 'team' then private.team_schedule_permission(a.team_id, 'manage')
         else private.employee_schedule_permission(a.employee_id, 'manage') end
  ) then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;
  if a.status <> 'draft' then
    raise exception 'Solo se publican borradores' using errcode = 'P0001';
  end if;
  if a.valid_from < private.planning_open_from(a.company_id) then
    raise exception 'La fecha de inicio ya ha pasado: ajústala antes de publicar' using errcode = 'P0001';
  end if;

  select count(*) filter (where c.severity = 'error'), count(*) filter (where c.severity = 'warning')
    into errors, warnings
  from private.assignment_conflicts_internal(p_id) c;
  if errors > 0 then
    raise exception 'Hay % conflicto(s) que impiden publicar', errors
      using errcode = 'P0001', hint = 'Revisa la lista de conflictos.';
  end if;
  if warnings > 0 and not p_accept_warnings then
    raise exception 'Hay % aviso(s): revísalos y confirma la publicación', warnings
      using errcode = 'P0001', hint = 'Marca la confirmación de avisos.';
  end if;

  update public.shift_assignments
  set status = 'published', published_by = (select auth.uid()), published_at = now()
  where id = p_id;

  insert into public.schedule_events (company_id, employee_id, event_type, payload, created_by)
  select a.company_id, r, 'shift_assignment_published',
    jsonb_build_object('assignment_id', p_id, 'scope', a.scope_type,
      'valid_from', a.valid_from, 'valid_to', a.valid_to),
    (select auth.uid())
  from private.assignment_recipients(p_id) as r;
  get diagnostics notified = row_count;
  return notified;
end;
$$;

-- Cierra una asignación publicada (último día incluido) o descarta un borrador.
-- Si aún no había empezado, se revoca. Notifica a las personas afectadas.
create or replace function public.close_shift_assignment(p_id uuid, p_last_day date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a record;
begin
  select * into a from public.shift_assignments where id = p_id;
  if a.id is null or not (
    case when a.scope_type = 'team' then private.team_schedule_permission(a.team_id, 'manage')
         else private.employee_schedule_permission(a.employee_id, 'manage') end
  ) then
    raise exception 'Asignación no encontrada' using errcode = 'P0002';
  end if;

  if a.status = 'draft' then
    update public.shift_assignments set status = 'revoked' where id = p_id;
    return;
  end if;
  if a.status <> 'published' then
    raise exception 'La asignación ya está revocada' using errcode = 'P0001';
  end if;

  if p_last_day + 1 <= a.valid_from then
    update public.shift_assignments set status = 'revoked' where id = p_id;
  else
    update public.shift_assignments set valid_to = p_last_day + 1
    where id = p_id and (valid_to is null or valid_to > p_last_day + 1);
  end if;

  insert into public.schedule_events (company_id, employee_id, event_type, payload, created_by)
  select a.company_id, r, 'shift_assignment_changed',
    jsonb_build_object('assignment_id', p_id, 'last_day', p_last_day),
    (select auth.uid())
  from private.assignment_recipients(p_id) as r;
end;
$$;

-- Crea o reemplaza el borrador de una versión de plantilla con sus tramos.
create or replace function public.save_shift_template_draft(
  p_template uuid,
  p_kind public.shift_kind,
  p_target_minutes integer,
  p_tolerance_early integer,
  p_tolerance_late integer,
  p_segments jsonb,
  p_flex_start integer default null,
  p_flex_end integer default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  company uuid;
  draft uuid;
  next_version integer;
begin
  select t.company_id into company from public.shift_templates t where t.id = p_template;
  if company is null or not private.has_schedule_permission(company, 'manage') then
    raise exception 'Plantilla no encontrada' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_segments) <> 'array' or jsonb_array_length(p_segments) > 20 then
    raise exception 'Tramos no válidos (máximo 20)' using errcode = '22023';
  end if;

  select id into draft from public.shift_template_versions
  where template_id = p_template and status = 'draft'
  order by version desc limit 1;

  if draft is null then
    select coalesce(max(version), 0) + 1 into next_version
    from public.shift_template_versions where template_id = p_template;
    insert into public.shift_template_versions (company_id, template_id, version, kind, target_minutes,
      tolerance_early_minutes, tolerance_late_minutes, flex_window_start, flex_window_end, created_by)
    values (company, p_template, next_version, p_kind, p_target_minutes, p_tolerance_early,
      p_tolerance_late, p_flex_start, p_flex_end, (select auth.uid()))
    returning id into draft;
  else
    update public.shift_template_versions set kind = p_kind, target_minutes = p_target_minutes,
      tolerance_early_minutes = p_tolerance_early, tolerance_late_minutes = p_tolerance_late,
      flex_window_start = p_flex_start, flex_window_end = p_flex_end
    where id = draft;
    delete from public.shift_template_segments where version_id = draft;
  end if;

  insert into public.shift_template_segments (company_id, version_id, position, start_minute,
    end_minute, kind, paid)
  select company, draft, (s.ord)::smallint, (s.value ->> 'start_minute')::integer,
    (s.value ->> 'end_minute')::integer, (s.value ->> 'kind')::public.segment_kind,
    coalesce((s.value ->> 'paid')::boolean, true)
  from jsonb_array_elements(p_segments) with ordinality as s(value, ord);
  return draft;
end;
$$;

-- Publica la versión borrador desde una fecha (hoy o futura). Cierra la versión
-- anterior en esa fecha; los días pasados conservan la versión que tenían.
create or replace function public.publish_shift_template_version(p_version uuid, p_valid_from date)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v record;
  problems text[];
  notified integer;
begin
  select * into v from public.shift_template_versions where id = p_version;
  if v.id is null or not private.has_schedule_permission(v.company_id, 'manage') then
    raise exception 'Versión no encontrada' using errcode = 'P0002';
  end if;
  if v.status <> 'draft' then
    raise exception 'Solo se publican borradores' using errcode = 'P0001';
  end if;
  if p_valid_from < private.planning_open_from(v.company_id) then
    raise exception 'Una versión se publica con efecto desde hoy o una fecha futura' using errcode = 'P0001',
      hint = 'Los periodos pasados no se recalculan.';
  end if;
  problems := private.template_version_problems(p_version);
  if cardinality(problems) > 0 then
    raise exception 'La plantilla no es válida: %', array_to_string(problems, ' ') using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.shift_template_versions
    where template_id = v.template_id and status = 'published' and valid_from >= p_valid_from
  ) then
    raise exception 'Ya hay una versión publicada que empieza el % o después', p_valid_from
      using errcode = 'P0001';
  end if;

  update public.shift_template_versions set valid_to = p_valid_from
  where template_id = v.template_id and status = 'published'
    and (valid_to is null or valid_to > p_valid_from);

  update public.shift_template_versions
  set status = 'published', valid_from = p_valid_from, published_by = (select auth.uid()),
    published_at = now()
  where id = p_version;

  insert into public.schedule_events (company_id, employee_id, event_type, payload, created_by)
  select distinct v.company_id, r.employee_id, 'shift_template_published',
    jsonb_build_object('template_id', v.template_id, 'version', v.version, 'valid_from', p_valid_from),
    (select auth.uid())
  from public.shift_assignments a
  join public.shift_assignment_days d on d.assignment_id = a.id and d.template_id = v.template_id
  cross join lateral private.assignment_recipients(a.id) as r(employee_id)
  where a.status = 'published' and (a.valid_to is null or a.valid_to > p_valid_from);
  get diagnostics notified = row_count;
  return notified;
end;
$$;

-- Accesos de horarios del propio usuario (para adaptar la interfaz).
create or replace function public.my_schedule_access(p_company uuid)
returns table (action text, scope_type text, work_center_id uuid, team_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select a, 'company', null::uuid, null::uuid
  from unnest(array['read', 'manage']) as a
  where private.is_group_admin_of_company(p_company)
  union
  select a, ra.scope_type::text, ra.work_center_id, ra.team_id
  from public.role_assignments ra
  cross join unnest(array['read', 'manage']) as a
  where ra.company_id = p_company
    and ra.membership_id = private.current_membership_id(p_company)
    and ra.status = 'active'
    and private.is_active_window(ra.valid_from, ra.valid_to)
    and private.role_has_schedule_permission(ra.role, a);
$$;

-- -----------------------------------------------------------------------------
-- 10. Auditoría: la publicación es una acción propia
-- -----------------------------------------------------------------------------

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (action in (
  'create', 'update', 'deactivate', 'reactivate', 'terminate', 'export', 'import', 'publish'
));

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
      when 'status' = any (changed) and new_data ->> 'status' = 'published' then 'publish'
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

-- -----------------------------------------------------------------------------
-- 11. Triggers
-- -----------------------------------------------------------------------------

create trigger holiday_calendars_updated_at before update on public.holiday_calendars
  for each row execute function private.set_updated_at();
create trigger work_center_holiday_calendars_updated_at before update on public.work_center_holiday_calendars
  for each row execute function private.set_updated_at();
create trigger holidays_updated_at before update on public.holidays
  for each row execute function private.set_updated_at();
create trigger shift_templates_updated_at before update on public.shift_templates
  for each row execute function private.set_updated_at();
create trigger shift_template_versions_updated_at before update on public.shift_template_versions
  for each row execute function private.set_updated_at();
create trigger shift_assignments_updated_at before update on public.shift_assignments
  for each row execute function private.set_updated_at();

create trigger holiday_calendars_keys before update on public.holiday_calendars
  for each row execute function private.prevent_key_change('id', 'company_id', 'applies_to_all_centers');
create trigger work_center_holiday_calendars_keys before update on public.work_center_holiday_calendars
  for each row execute function private.prevent_key_change(
    'id', 'company_id', 'work_center_id', 'calendar_id', 'valid_from'
  );
create trigger holidays_keys before update on public.holidays
  for each row execute function private.prevent_key_change('id', 'company_id', 'calendar_id', 'holiday_date');
create trigger shift_templates_keys before update on public.shift_templates
  for each row execute function private.prevent_key_change('id', 'company_id', 'code');
create trigger shift_template_versions_keys before update on public.shift_template_versions
  for each row execute function private.prevent_key_change('id', 'company_id', 'template_id', 'version');
create trigger shift_assignments_keys before update on public.shift_assignments
  for each row execute function private.prevent_key_change('id', 'company_id');

create trigger shift_template_versions_guard before update or delete on public.shift_template_versions
  for each row execute function private.guard_template_version();
create trigger shift_template_segments_guard before insert or update or delete on public.shift_template_segments
  for each row execute function private.guard_template_segment();
create trigger shift_assignments_guard before update on public.shift_assignments
  for each row execute function private.guard_shift_assignment();
create trigger shift_assignment_days_guard before insert or update or delete on public.shift_assignment_days
  for each row execute function private.guard_assignment_day();
create trigger holidays_guard before insert or update on public.holidays
  for each row execute function private.guard_holiday();
create trigger work_center_holiday_calendars_guard before insert or update on public.work_center_holiday_calendars
  for each row execute function private.guard_calendar_link();

create trigger schedule_events_immutable before update or delete on public.schedule_events
  for each row when (pg_trigger_depth() = 0 and current_user <> 'service_role')
  execute function private.prevent_mutation();

create trigger audit_events_holiday_calendars after insert or update on public.holiday_calendars
  for each row execute function private.audit_event_row('company_id');
create trigger audit_events_holidays after insert or update on public.holidays
  for each row execute function private.audit_event_row('company_id');
create trigger audit_events_work_center_holiday_calendars after insert or update on public.work_center_holiday_calendars
  for each row execute function private.audit_event_row('company_id');
create trigger audit_events_shift_templates after insert or update on public.shift_templates
  for each row execute function private.audit_event_row('company_id');
create trigger audit_events_shift_template_versions after insert or update on public.shift_template_versions
  for each row execute function private.audit_event_row('company_id');
create trigger audit_events_shift_assignments after insert or update on public.shift_assignments
  for each row execute function private.audit_event_row('company_id');

-- -----------------------------------------------------------------------------
-- 12. Privilegios
-- -----------------------------------------------------------------------------

revoke all on function
  private.is_valid_time_zone(text),
  private.role_has_schedule_permission(public.app_role, text),
  private.has_schedule_permission(uuid, text, uuid, uuid),
  private.employee_schedule_permission(uuid, text),
  private.team_schedule_permission(uuid, text),
  private.can_read_employee_schedule(uuid),
  private.can_read_team_schedule(uuid),
  private.planning_open_from(uuid),
  private.template_version_problems(uuid),
  private.guard_template_version(),
  private.guard_template_segment(),
  private.guard_shift_assignment(),
  private.guard_assignment_day(),
  private.guard_holiday(),
  private.guard_calendar_link(),
  private.assignment_recipients(uuid),
  private.assignment_conflicts_internal(uuid)
from public;

grant execute on function
  private.is_valid_time_zone(text),
  private.role_has_schedule_permission(public.app_role, text),
  private.has_schedule_permission(uuid, text, uuid, uuid),
  private.employee_schedule_permission(uuid, text),
  private.team_schedule_permission(uuid, text),
  private.can_read_employee_schedule(uuid),
  private.can_read_team_schedule(uuid),
  private.planning_open_from(uuid)
to authenticated, service_role;

revoke all on function
  public.shift_assignment_conflicts(uuid),
  public.save_shift_assignment(public.shift_assignment_scope, date, smallint, uuid[], uuid, uuid, uuid, uuid, date, date, text),
  public.publish_shift_assignment(uuid, boolean),
  public.close_shift_assignment(uuid, date),
  public.save_shift_template_draft(uuid, public.shift_kind, integer, integer, integer, jsonb, integer, integer),
  public.publish_shift_template_version(uuid, date),
  public.my_schedule_access(uuid)
from public, anon;

grant execute on function
  public.shift_assignment_conflicts(uuid),
  public.save_shift_assignment(public.shift_assignment_scope, date, smallint, uuid[], uuid, uuid, uuid, uuid, date, date, text),
  public.publish_shift_assignment(uuid, boolean),
  public.close_shift_assignment(uuid, date),
  public.save_shift_template_draft(uuid, public.shift_kind, integer, integer, integer, jsonb, integer, integer),
  public.publish_shift_template_version(uuid, date),
  public.my_schedule_access(uuid)
to authenticated, service_role;

revoke all on public.holiday_calendars, public.work_center_holiday_calendars, public.holidays,
  public.shift_templates, public.shift_template_versions, public.shift_template_segments,
  public.shift_assignments, public.shift_assignment_days, public.leave_periods,
  public.schedule_events
from anon, authenticated;

grant select on public.holiday_calendars, public.work_center_holiday_calendars, public.holidays,
  public.shift_templates, public.shift_template_versions, public.shift_template_segments,
  public.shift_assignments, public.shift_assignment_days, public.leave_periods,
  public.schedule_events
to authenticated;

-- Calendarios y plantillas (sin versiones): CRUD directo con RLS.
grant insert (company_id, name, scope, region_code, locality, applies_to_all_centers, source_reference)
  on public.holiday_calendars to authenticated;
grant update (name, region_code, locality, source_reference, status) on public.holiday_calendars to authenticated;
grant insert (company_id, work_center_id, calendar_id, valid_from) on public.work_center_holiday_calendars to authenticated;
grant update (valid_to) on public.work_center_holiday_calendars to authenticated;
grant insert (company_id, calendar_id, holiday_date, name) on public.holidays to authenticated;
grant update (name, status) on public.holidays to authenticated;
grant insert (company_id, code, name) on public.shift_templates to authenticated;
grant update (name, status) on public.shift_templates to authenticated;
-- Versiones, tramos, asignaciones y eventos: solo mediante las funciones anteriores.

-- -----------------------------------------------------------------------------
-- 13. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.holiday_calendars enable row level security;
alter table public.work_center_holiday_calendars enable row level security;
alter table public.holidays enable row level security;
alter table public.shift_templates enable row level security;
alter table public.shift_template_versions enable row level security;
alter table public.shift_template_segments enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.shift_assignment_days enable row level security;
alter table public.leave_periods enable row level security;
alter table public.schedule_events enable row level security;

-- Calendarios y plantillas: visibles para la empresa; gestión con permiso de empresa.
create policy "holiday_calendars_select" on public.holiday_calendars
  for select to authenticated
  using (private.is_company_member(company_id) or private.has_schedule_permission(company_id, 'read')
    or private.manages_in_company(company_id));
create policy "holiday_calendars_insert" on public.holiday_calendars
  for insert to authenticated with check (private.has_schedule_permission(company_id, 'manage'));
create policy "holiday_calendars_update" on public.holiday_calendars
  for update to authenticated
  using (private.has_schedule_permission(company_id, 'manage'))
  with check (private.has_schedule_permission(company_id, 'manage'));

create policy "work_center_holiday_calendars_select" on public.work_center_holiday_calendars
  for select to authenticated
  using (private.is_company_member(company_id) or private.has_schedule_permission(company_id, 'read')
    or private.manages_in_company(company_id));
create policy "work_center_holiday_calendars_insert" on public.work_center_holiday_calendars
  for insert to authenticated with check (private.has_schedule_permission(company_id, 'manage'));
create policy "work_center_holiday_calendars_update" on public.work_center_holiday_calendars
  for update to authenticated
  using (private.has_schedule_permission(company_id, 'manage'))
  with check (private.has_schedule_permission(company_id, 'manage'));

create policy "holidays_select" on public.holidays
  for select to authenticated
  using (private.is_company_member(company_id) or private.has_schedule_permission(company_id, 'read')
    or private.manages_in_company(company_id));
create policy "holidays_insert" on public.holidays
  for insert to authenticated with check (private.has_schedule_permission(company_id, 'manage'));
create policy "holidays_update" on public.holidays
  for update to authenticated
  using (private.has_schedule_permission(company_id, 'manage'))
  with check (private.has_schedule_permission(company_id, 'manage'));

create policy "shift_templates_select" on public.shift_templates
  for select to authenticated
  using (private.is_company_member(company_id) or private.has_schedule_permission(company_id, 'read')
    or private.manages_in_company(company_id));
create policy "shift_templates_insert" on public.shift_templates
  for insert to authenticated with check (private.has_schedule_permission(company_id, 'manage'));
create policy "shift_templates_update" on public.shift_templates
  for update to authenticated
  using (private.has_schedule_permission(company_id, 'manage'))
  with check (private.has_schedule_permission(company_id, 'manage'));

-- Borradores de versión: solo quien gestiona; publicadas: toda la empresa.
create policy "shift_template_versions_select" on public.shift_template_versions
  for select to authenticated
  using (
    private.has_schedule_permission(company_id, 'manage')
    or (status = 'published' and (private.is_company_member(company_id)
      or private.has_schedule_permission(company_id, 'read') or private.manages_in_company(company_id)))
  );
create policy "shift_template_segments_select" on public.shift_template_segments
  for select to authenticated
  using (exists (select 1 from public.shift_template_versions v where v.id = version_id));

-- Asignaciones: la persona, su manager vigente o quien tenga lectura en su ámbito.
-- Los borradores solo los ve quien gestiona.
create policy "shift_assignments_select" on public.shift_assignments
  for select to authenticated
  using (
    case when scope_type = 'team'
      then private.team_schedule_permission(team_id, 'manage')
        or (status = 'published' and private.can_read_team_schedule(team_id))
      else private.employee_schedule_permission(employee_id, 'manage')
        or (status = 'published' and private.can_read_employee_schedule(employee_id))
    end
  );
create policy "shift_assignment_days_select" on public.shift_assignment_days
  for select to authenticated
  using (exists (select 1 from public.shift_assignments a where a.id = assignment_id));

create policy "leave_periods_select" on public.leave_periods
  for select to authenticated
  using (private.can_read_employee_schedule(employee_id));

create policy "schedule_events_select" on public.schedule_events
  for select to authenticated
  using (private.is_self_employee(employee_id) or private.employee_schedule_permission(employee_id, 'read'));
