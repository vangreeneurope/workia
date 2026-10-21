-- =============================================================================
-- Control horario: fichajes inmutables, jornadas recalculadas, incidencias,
-- correcciones con ajustes auditados, terminal compartido con PIN y avisos.
--
-- Principios (docs/CONTROL_HORARIO.md):
--  - La hora oficial es la del servidor (now()); la del dispositivo solo se declara.
--  - Los fichajes (punches) no se modifican ni se borran: una corrección aprobada
--    crea un ajuste (time_adjustments) con antes, después, motivo y decisión.
--  - Idempotencia: misma clave = mismo fichaje. Las operaciones de una persona se
--    serializan con un bloqueo consultivo por empleado.
--  - Ubicación puntual solo si la política lo pide; selfie solo con la política
--    activada, en bucket privado y sin biometría.
--  - Ningún PIN, coordenada ni foto se escribe en registros (audit_log incluido).
--
-- Reversión: supabase/rollbacks/20261025100000_control_horario.down.sql
-- =============================================================================

-- pgcrypto (ya instalada en Supabase en el esquema extensions): hash de PIN
-- (bcrypt) y tokens aleatorios de terminal.
create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------

create type public.punch_kind as enum ('start', 'break_start', 'break_end', 'end');
create type public.punch_source as enum ('mobile', 'web', 'kiosk');
create type public.location_status as enum ('not_requested', 'granted', 'denied', 'unavailable', 'timeout');
create type public.location_mode as enum ('off', 'optional', 'required');
create type public.time_entry_status as enum ('open', 'on_break', 'closed', 'incomplete');
create type public.time_incident_kind as enum (
  'start_out_of_tolerance', 'end_out_of_tolerance', 'unplanned_work', 'missing_end',
  'open_entry', 'overlap', 'location_unavailable', 'device_time_mismatch'
);
create type public.time_incident_status as enum ('open', 'resolved', 'dismissed');
create type public.correction_action as enum ('add', 'change', 'void');
create type public.correction_status as enum ('pending', 'approved', 'rejected', 'cancelled');

-- -----------------------------------------------------------------------------
-- 2. Permisos de control horario (ADR-035)
-- -----------------------------------------------------------------------------

-- 'read': consultar registros, incidencias y correcciones del ámbito.
-- 'manage': además decidir correcciones, resolver incidencias, políticas y terminales.
create or replace function private.role_has_time_permission(p_role public.app_role, p_action text)
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

create or replace function private.has_time_permission(
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
        and private.role_has_time_permission(ra.role, p_action)
        and (
          ra.scope_type = 'company'
          or (ra.scope_type = 'work_center' and ra.work_center_id = p_work_center)
          or (ra.scope_type = 'team' and ra.team_id = p_team)
        )
    )
  );
$$;

create or replace function private.employee_time_permission(p_employee uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.has_time_permission(e.company_id, p_action, e.work_center_id, e.team_id)
    from public.employees e where e.id = p_employee
  ), false);
$$;

-- La persona, su manager vigente o quien tenga lectura en su ámbito.
create or replace function private.can_read_employee_time(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_self_employee(p_employee)
    or private.manages_employee(p_employee)
    or private.employee_time_permission(p_employee, 'read');
$$;

-- ¿Puede el usuario actual decidir correcciones de esa persona? Gestión en su
-- ámbito o ser su aprobador efectivo de correcciones de fichaje. Nunca la propia.
create or replace function private.can_decide_time_corrections(p_employee uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  approver uuid;
begin
  if private.is_self_employee(p_employee) then
    return false;
  end if;
  if private.employee_time_permission(p_employee, 'manage') then
    return true;
  end if;
  begin
    select r.approver_user_id into approver
    from private.resolve_approver_internal(p_employee, 'time_corrections', now()) r;
  exception when others then
    return false;
  end;
  return approver is not null and approver = (select auth.uid());
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Zona horaria y horario planificado en SQL
-- -----------------------------------------------------------------------------

create or replace function private.employee_time_zone(p_employee uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(w.timezone, c.timezone)
  from public.employees e
  join public.companies c on c.id = e.company_id
  left join public.work_centers w on w.id = e.work_center_id
  where e.id = p_employee;
$$;

-- Hora local -> instante con las reglas de docs/HORARIOS.md: hora inexistente con
-- el desfase anterior (PostgreSQL ya lo hace así); hora repetida, la primera vez.
create or replace function private.local_to_utc(p_tz text, p_date date, p_minute integer)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  local_ts timestamp := p_date + make_interval(mins => p_minute);
  candidate timestamptz := local_ts at time zone p_tz;
begin
  if ((candidate - interval '1 hour') at time zone p_tz) = local_ts then
    return candidate - interval '1 hour';
  end if;
  return candidate;
end;
$$;

-- Horario planificado de una persona para un día (misma precedencia que
-- src/features/schedules/resolver.ts). Diferencia deliberada: una ausencia
-- aprobada devuelve 'absence', porque aquí solo sirve para detectar incidencias.
create or replace function private.planned_shift(p_employee uuid, p_date date)
returns table (
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  tolerance_early integer,
  tolerance_late integer,
  kind public.shift_kind,
  flex_starts_at timestamptz,
  flex_ends_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  emp record;
  tz text;
  terms uuid;
  a record;
  tpl uuid;
  v record;
  first_min integer;
  last_min integer;
begin
  select e.id, e.company_id, e.team_id, e.work_center_id, e.end_date into emp
  from public.employees e where e.id = p_employee;
  if emp.id is null then
    return;
  end if;
  tz := private.employee_time_zone(p_employee);

  if emp.end_date is not null and p_date > emp.end_date then
    return query select 'no_contract'::text, null::timestamptz, null::timestamptz, 0, 0,
      null::public.shift_kind, null::timestamptz, null::timestamptz;
    return;
  end if;
  select t.id into terms from public.employment_terms t
  where t.employee_id = p_employee and t.status = 'active'
    and t.valid_from <= p_date and (t.valid_to is null or t.valid_to > p_date)
  order by t.valid_from desc limit 1;
  if terms is null then
    return query select 'no_contract'::text, null::timestamptz, null::timestamptz, 0, 0,
      null::public.shift_kind, null::timestamptz, null::timestamptz;
    return;
  end if;
  if exists (
    select 1 from public.leave_periods l
    where l.employee_id = p_employee and l.status = 'approved'
      and p_date between l.starts_on and l.ends_on
  ) then
    return query select 'absence'::text, null::timestamptz, null::timestamptz, 0, 0,
      null::public.shift_kind, null::timestamptz, null::timestamptz;
    return;
  end if;

  select * into a from public.shift_assignments s
  where s.employee_id = p_employee and s.scope_type = 'exception' and s.status = 'published'
    and s.valid_from <= p_date and (s.valid_to is null or s.valid_to > p_date)
  order by s.valid_from desc, s.id limit 1;

  if a.id is null and exists (
    select 1 from public.holidays h
    join public.holiday_calendars hc on hc.id = h.calendar_id
    where h.holiday_date = p_date and h.status = 'active' and hc.status = 'active'
      and hc.company_id = emp.company_id
      and (
        hc.applies_to_all_centers
        or exists (
          select 1 from public.work_center_holiday_calendars l
          where l.calendar_id = hc.id and l.work_center_id = emp.work_center_id
            and l.valid_from <= p_date and (l.valid_to is null or l.valid_to > p_date)
        )
      )
  ) then
    return query select 'holiday'::text, null::timestamptz, null::timestamptz, 0, 0,
      null::public.shift_kind, null::timestamptz, null::timestamptz;
    return;
  end if;

  if a.id is null then
    select * into a from public.shift_assignments s
    where s.status = 'published'
      and s.valid_from <= p_date and (s.valid_to is null or s.valid_to > p_date)
      and (
        (s.scope_type = 'employee' and s.employee_id = p_employee)
        or (s.scope_type = 'team' and s.team_id = emp.team_id)
        or (s.scope_type = 'contract' and s.employment_terms_id = terms)
      )
    order by case s.scope_type when 'employee' then 1 when 'team' then 2 else 3 end,
      s.valid_from desc, s.id
    limit 1;
  end if;
  if a.id is null then
    return query select 'unassigned'::text, null::timestamptz, null::timestamptz, 0, 0,
      null::public.shift_kind, null::timestamptz, null::timestamptz;
    return;
  end if;

  select d.template_id into tpl from public.shift_assignment_days d
  where d.assignment_id = a.id
    and d.day_index = ((((p_date - a.anchor_date) % a.cycle_days) + a.cycle_days) % a.cycle_days);
  if tpl is null then
    return query select 'rest'::text, null::timestamptz, null::timestamptz, 0, 0,
      null::public.shift_kind, null::timestamptz, null::timestamptz;
    return;
  end if;

  select * into v from public.shift_template_versions sv
  where sv.template_id = tpl and sv.status = 'published'
    and sv.valid_from <= p_date and (sv.valid_to is null or sv.valid_to > p_date);
  if v.id is null then
    return query select 'unassigned'::text, null::timestamptz, null::timestamptz, 0, 0,
      null::public.shift_kind, null::timestamptz, null::timestamptz;
    return;
  end if;

  select min(sg.start_minute), max(sg.end_minute) into first_min, last_min
  from public.shift_template_segments sg where sg.version_id = v.id and sg.kind = 'work';

  return query select 'work'::text,
    case when first_min is not null then private.local_to_utc(tz, p_date, first_min) end,
    case when last_min is not null then private.local_to_utc(tz, p_date, last_min) end,
    v.tolerance_early_minutes, v.tolerance_late_minutes, v.kind,
    case when v.flex_window_start is not null then private.local_to_utc(tz, p_date, v.flex_window_start) end,
    case when v.flex_window_end is not null then private.local_to_utc(tz, p_date, v.flex_window_end) end;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Políticas de fichaje
-- -----------------------------------------------------------------------------

create table public.time_tracking_policies (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  -- null = política por defecto de la empresa; si no, la de un centro.
  work_center_id  uuid,
  location_mode   public.location_mode not null default 'off',
  -- Texto que se muestra ANTES de pedir la ubicación (art. 90 LOPDGDD).
  location_notice text check (location_notice is null or char_length(location_notice) <= 1000),
  -- Interruptor (feature flag) de la selfie opcional.
  selfie_enabled  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, company_id),
  foreign key (work_center_id, company_id) references public.work_centers (id, company_id),
  constraint time_tracking_policies_notice_check check (
    location_mode = 'off' or char_length(btrim(coalesce(location_notice, ''))) >= 20
  )
);

create unique index time_tracking_policies_company_key
  on public.time_tracking_policies (company_id) where work_center_id is null;
create unique index time_tracking_policies_center_key
  on public.time_tracking_policies (company_id, work_center_id) where work_center_id is not null;

-- Política efectiva de una persona: la de su centro, si no la de la empresa, si
-- no la más restrictiva (sin ubicación ni selfie).
create or replace function private.effective_time_policy(p_employee uuid)
returns table (location_mode public.location_mode, location_notice text, selfie_enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.location_mode, 'off'::public.location_mode), p.location_notice,
    coalesce(p.selfie_enabled, false)
  from public.employees e
  left join lateral (
    select tp.location_mode, tp.location_notice, tp.selfie_enabled
    from public.time_tracking_policies tp
    where tp.company_id = e.company_id
      and (tp.work_center_id = e.work_center_id or tp.work_center_id is null)
    order by tp.work_center_id nulls last
    limit 1
  ) p on true
  where e.id = p_employee;
$$;

-- -----------------------------------------------------------------------------
-- 5. Jornadas, fichajes, correcciones, ajustes e incidencias
-- -----------------------------------------------------------------------------

-- Jornada: se abre con 'start' y su fecha es el día local del inicio (un turno de
-- noche pertenece al día en que empieza). Se recalcula siempre desde los fichajes
-- y los ajustes aprobados; nadie la escribe directamente.
create table public.time_entries (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  employee_id     uuid not null,
  work_date       date not null,
  time_zone       text not null check (private.is_valid_time_zone(time_zone)),
  status          public.time_entry_status not null default 'open',
  started_at      timestamptz,
  ended_at        timestamptz,
  worked_seconds  integer not null default 0 check (worked_seconds >= 0),
  break_seconds   integer not null default 0 check (break_seconds >= 0),
  -- Se cerró sin salida porque la persona empezó otra jornada (olvido).
  closed_incomplete_at timestamptz,
  recalculated_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, company_id),
  unique (id, company_id, employee_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  constraint time_entries_order_check check (ended_at is null or started_at is null or ended_at >= started_at)
);

-- Como mucho una jornada abierta por persona.
create unique index time_entries_one_open
  on public.time_entries (employee_id) where status in ('open', 'on_break');
create index time_entries_company_date_idx on public.time_entries (company_id, work_date);
create index time_entries_employee_date_idx on public.time_entries (employee_id, work_date);

-- Terminales compartidos (antes de punches por la clave foránea).
create table public.kiosk_devices (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete restrict,
  work_center_id uuid not null,
  name           text not null check (char_length(btrim(name)) between 2 and 80),
  -- Huella SHA-256 del token: el token en claro solo se muestra al darlo de alta.
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status         public.entity_status not null default 'active',
  blocked_until  timestamptz,
  last_used_at   timestamptz,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, name),
  foreign key (work_center_id, company_id) references public.work_centers (id, company_id)
);

-- Fichaje original. Inmutable: solo se puede retirar la foto al caducar.
create table public.punches (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  employee_id     uuid not null,
  time_entry_id   uuid not null,
  kind            public.punch_kind not null,
  -- Hora oficial (servidor) y hora declarada por el dispositivo.
  server_at       timestamptz not null default now(),
  device_at       timestamptz,
  time_zone       text not null,
  source          public.punch_source not null,
  -- Identificador aleatorio generado en el dispositivo (seudónimo, no huella).
  device_id       uuid,
  kiosk_device_id uuid,
  idempotency_key uuid not null,
  location_status public.location_status not null default 'not_requested',
  latitude        numeric(9, 6) check (latitude between -90 and 90),
  longitude       numeric(9, 6) check (longitude between -180 and 180),
  accuracy_m      integer check (accuracy_m between 0 and 100000),
  selfie_path     text,
  selfie_purged_at timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (id, company_id),
  unique (id, company_id, employee_id),
  unique (company_id, employee_id, idempotency_key),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (time_entry_id, company_id, employee_id)
    references public.time_entries (id, company_id, employee_id),
  foreign key (kiosk_device_id, company_id) references public.kiosk_devices (id, company_id),
  constraint punches_location_check check (
    (latitude is null and longitude is null and accuracy_m is null)
    or (location_status = 'granted' and latitude is not null and longitude is not null)
  ),
  constraint punches_kiosk_check check ((source = 'kiosk') = (kiosk_device_id is not null))
);

create index punches_entry_idx on public.punches (time_entry_id, server_at);
create index punches_employee_idx on public.punches (employee_id, server_at desc);

-- Solicitud de corrección (de la persona o de RR. HH. en su nombre).
create table public.time_correction_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  employee_id   uuid not null,
  time_entry_id uuid,
  action        public.correction_action not null,
  punch_id      uuid,
  kind          public.punch_kind,
  proposed_at   timestamptz,
  reason        text not null check (char_length(btrim(reason)) between 5 and 500),
  status        public.correction_status not null default 'pending',
  requested_by  uuid references public.profiles (id) on delete set null,
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, company_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (time_entry_id, company_id, employee_id)
    references public.time_entries (id, company_id, employee_id),
  foreign key (punch_id, company_id, employee_id) references public.punches (id, company_id, employee_id),
  constraint time_correction_requests_shape_check check (
    (action = 'add' and kind is not null and proposed_at is not null and punch_id is null)
    or (action = 'change' and punch_id is not null and proposed_at is not null and kind is null)
    or (action = 'void' and punch_id is not null and proposed_at is null and kind is null)
  )
);

create index time_correction_requests_employee_idx on public.time_correction_requests (employee_id, status);
create index time_correction_requests_company_idx on public.time_correction_requests (company_id, status);

-- Ajuste aprobado: no edita el fichaje original, lo complementa. Inmutable.
create table public.time_adjustments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  employee_id   uuid not null,
  time_entry_id uuid not null,
  request_id    uuid not null unique,
  action        public.correction_action not null,
  punch_id      uuid,
  kind          public.punch_kind,
  effective_at  timestamptz,
  -- Antes y después de la jornada (fichajes efectivos y totales).
  before        jsonb not null,
  after         jsonb not null,
  reason        text not null,
  decision      text not null default 'approved' check (decision = 'approved'),
  decision_note text,
  requested_by  uuid references public.profiles (id) on delete set null,
  decided_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (id, company_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (time_entry_id, company_id, employee_id)
    references public.time_entries (id, company_id, employee_id),
  foreign key (request_id, company_id) references public.time_correction_requests (id, company_id),
  foreign key (punch_id, company_id, employee_id) references public.punches (id, company_id, employee_id)
);

create index time_adjustments_entry_idx on public.time_adjustments (time_entry_id, created_at);

create table public.time_incidents (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  employee_id     uuid not null,
  time_entry_id   uuid not null,
  punch_id        uuid,
  work_date       date not null,
  kind            public.time_incident_kind not null,
  -- Clave de deduplicación dentro de la jornada (tipo y, si aplica, fichaje).
  dedupe_key      text not null,
  -- Sin datos personales ni coordenadas: minutos de desviación, estado del plan…
  detail          jsonb not null default '{}'::jsonb,
  status          public.time_incident_status not null default 'open',
  detected_at     timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles (id) on delete set null,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  updated_at      timestamptz not null default now(),
  unique (id, company_id),
  unique (time_entry_id, dedupe_key),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (time_entry_id, company_id, employee_id)
    references public.time_entries (id, company_id, employee_id),
  foreign key (punch_id, company_id, employee_id) references public.punches (id, company_id, employee_id)
);

create index time_incidents_company_idx on public.time_incidents (company_id, status, work_date);
create index time_incidents_employee_idx on public.time_incidents (employee_id, work_date);

-- PIN del terminal: solo el hash (bcrypt). Sin acceso desde la API.
create table public.kiosk_pins (
  employee_id     uuid primary key,
  company_id      uuid not null references public.companies (id) on delete restrict,
  pin_hash        text,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now(),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);

-- Intentos en el terminal para limitar la frecuencia (sin PIN ni código tecleado).
create table public.kiosk_attempts (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies (id) on delete restrict,
  device_id   uuid not null,
  employee_id uuid,
  success     boolean not null,
  created_at  timestamptz not null default now(),
  foreign key (device_id, company_id) references public.kiosk_devices (id, company_id)
);

create index kiosk_attempts_device_idx on public.kiosk_attempts (device_id, created_at desc);

-- Eventos de trabajo: recordatorios y avisos pendientes de un futuro adaptador.
create table public.work_events (
  id           bigint generated always as identity primary key,
  company_id   uuid not null references public.companies (id) on delete restrict,
  employee_id  uuid not null,
  event_type   text not null check (event_type in (
    'reminder_open_entry', 'reminder_missing_start', 'incident_detected', 'correction_decided'
  )),
  dedupe_key   text not null,
  payload      jsonb not null default '{}'::jsonb,
  due_at       timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,
  unique (employee_id, dedupe_key),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);

create index work_events_pending_idx on public.work_events (due_at) where delivered_at is null;

-- -----------------------------------------------------------------------------
-- 6. Máquina de estados y recálculo
-- -----------------------------------------------------------------------------

-- Estado siguiente de una jornada tras un fichaje, o null si la transición es
-- imposible. Misma tabla que src/features/time-tracking/state-machine.ts.
create or replace function private.punch_transition(p_state public.time_entry_status, p_kind public.punch_kind)
returns public.time_entry_status
language sql
immutable
set search_path = ''
as $$
  select case
    when p_state is null and p_kind = 'start' then 'open'::public.time_entry_status
    when p_state = 'open' and p_kind = 'break_start' then 'on_break'
    when p_state = 'open' and p_kind = 'end' then 'closed'
    when p_state = 'on_break' and p_kind = 'break_end' then 'open'
    else null
  end;
$$;

-- Fichajes efectivos de una jornada: originales no anulados ni cambiados, más
-- los añadidos o cambiados por ajustes aprobados.
create or replace function private.effective_punches(p_entry uuid)
returns table (punch_id uuid, kind public.punch_kind, occurred_at timestamptz, origin text)
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    select p.id, p.kind, p.server_at, 'punch'::text
    from public.punches p
    where p.time_entry_id = p_entry
      and not exists (
        select 1 from public.time_adjustments a
        where a.time_entry_id = p_entry and a.punch_id = p.id and a.action in ('change', 'void')
      )
    union all
    select coalesce(a.punch_id, a.id),
      coalesce(a.kind, (select p.kind from public.punches p where p.id = a.punch_id)),
      a.effective_at, 'adjustment'
    from public.time_adjustments a
    where a.time_entry_id = p_entry and a.action in ('add', 'change')
  ) e (punch_id, kind, occurred_at, origin)
  order by e.occurred_at,
    case e.kind when 'start' then 1 when 'break_end' then 2 when 'break_start' then 3 else 4 end;
$$;

-- Resumen de la jornada para guardar en los ajustes (antes / después).
create or replace function private.time_entry_snapshot(p_entry uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', e.status,
    'started_at', e.started_at,
    'ended_at', e.ended_at,
    'worked_seconds', e.worked_seconds,
    'break_seconds', e.break_seconds,
    'punches', coalesce((
      select jsonb_agg(jsonb_build_object('kind', p.kind, 'at', p.occurred_at, 'origin', p.origin) order by p.occurred_at)
      from private.effective_punches(p_entry) p
    ), '[]'::jsonb)
  )
  from public.time_entries e where e.id = p_entry;
$$;

-- Crea o reabre una incidencia detectada automáticamente (sin duplicados).
create or replace function private.upsert_incident(
  p_entry public.time_entries,
  p_kind public.time_incident_kind,
  p_key text,
  p_detail jsonb,
  p_punch uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  created boolean;
begin
  insert into public.time_incidents (company_id, employee_id, time_entry_id, punch_id, work_date,
    kind, dedupe_key, detail)
  values (p_entry.company_id, p_entry.employee_id, p_entry.id, p_punch, p_entry.work_date, p_kind,
    p_key, p_detail)
  on conflict (time_entry_id, dedupe_key) do nothing
  returning true into created;
  if created then
    insert into public.work_events (company_id, employee_id, event_type, dedupe_key, payload)
    values (p_entry.company_id, p_entry.employee_id, 'incident_detected',
      'incident:' || p_entry.id || ':' || p_key,
      jsonb_build_object('work_date', p_entry.work_date, 'kind', p_kind))
    on conflict (employee_id, dedupe_key) do nothing;
  else
    -- Reaparece una incidencia que el sistema había dado por resuelta.
    update public.time_incidents set status = 'open', resolved_at = null, detail = p_detail
    where time_entry_id = p_entry.id and dedupe_key = p_key and status = 'resolved' and resolved_by is null;
  end if;
end;
$$;

-- Recalcula una jornada desde sus fichajes efectivos y sincroniza sus
-- incidencias automáticas. Lanza error si la secuencia es imposible (la
-- transacción que lo provocó se deshace entera: la jornada no se corrompe).
create or replace function private.recalculate_time_entry(p_entry uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.time_entries;
  p record;
  state public.time_entry_status := null;
  first_start timestamptz;
  last_end timestamptz;
  worked bigint := 0;
  breaks bigint := 0;
  segment_from timestamptz;
  break_from timestamptz;
  plan record;
  policy record;
  keys text[] := '{}';
  deviation integer;
  stale_hours constant integer := 16;
begin
  select * into e from public.time_entries where id = p_entry for update;

  for p in select * from private.effective_punches(p_entry) loop
    state := private.punch_transition(state, p.kind);
    if state is null then
      raise exception 'Secuencia de fichajes imposible: % no puede ir después del estado anterior', p.kind
        using errcode = 'P0001';
    end if;
    case p.kind
      when 'start' then first_start := p.occurred_at; segment_from := p.occurred_at;
      when 'break_start' then
        worked := worked + extract(epoch from p.occurred_at - segment_from)::bigint; break_from := p.occurred_at;
      when 'break_end' then
        breaks := breaks + extract(epoch from p.occurred_at - break_from)::bigint; segment_from := p.occurred_at;
      when 'end' then
        worked := worked + extract(epoch from p.occurred_at - segment_from)::bigint; last_end := p.occurred_at;
    end case;
  end loop;

  update public.time_entries set
    status = case
      when state is null then 'incomplete'
      when state = 'closed' then 'closed'
      when closed_incomplete_at is not null then 'incomplete'
      else state
    end,
    started_at = first_start,
    ended_at = last_end,
    worked_seconds = greatest(worked, 0),
    break_seconds = greatest(breaks, 0),
    recalculated_at = now()
  where id = p_entry
  returning * into e;

  -- Incidencias automáticas -------------------------------------------------
  select * into plan from private.planned_shift(e.employee_id, e.work_date) limit 1;

  if plan.status in ('rest', 'holiday', 'absence', 'no_contract') then
    keys := array_append(keys, 'unplanned_work'::text);
    perform private.upsert_incident(e, 'unplanned_work', 'unplanned_work',
      jsonb_build_object('planned', plan.status));
  elsif plan.status = 'work' and plan.kind = 'flexible' then
    if first_start is not null and plan.flex_starts_at is not null and first_start < plan.flex_starts_at then
      keys := array_append(keys, 'start_out_of_tolerance'::text);
      perform private.upsert_incident(e, 'start_out_of_tolerance', 'start_out_of_tolerance',
        jsonb_build_object('minutes', (extract(epoch from first_start - plan.flex_starts_at) / 60)::integer,
          'flexible', true));
    end if;
    if last_end is not null and plan.flex_ends_at is not null and last_end > plan.flex_ends_at then
      keys := array_append(keys, 'end_out_of_tolerance'::text);
      perform private.upsert_incident(e, 'end_out_of_tolerance', 'end_out_of_tolerance',
        jsonb_build_object('minutes', (extract(epoch from last_end - plan.flex_ends_at) / 60)::integer,
          'flexible', true));
    end if;
  elsif plan.status = 'work' then
    if first_start is not null and plan.starts_at is not null then
      deviation := (extract(epoch from first_start - plan.starts_at) / 60)::integer;
      if deviation < -plan.tolerance_early or deviation > plan.tolerance_late then
        keys := array_append(keys, 'start_out_of_tolerance'::text);
        perform private.upsert_incident(e, 'start_out_of_tolerance', 'start_out_of_tolerance',
          jsonb_build_object('minutes', deviation));
      end if;
    end if;
    if last_end is not null and plan.ends_at is not null then
      deviation := (extract(epoch from last_end - plan.ends_at) / 60)::integer;
      if deviation < -plan.tolerance_early or deviation > plan.tolerance_late then
        keys := array_append(keys, 'end_out_of_tolerance'::text);
        perform private.upsert_incident(e, 'end_out_of_tolerance', 'end_out_of_tolerance',
          jsonb_build_object('minutes', deviation));
      end if;
    end if;
  end if;

  if e.status = 'incomplete' then
    keys := array_append(keys, 'missing_end'::text);
    perform private.upsert_incident(e, 'missing_end', 'missing_end', '{}'::jsonb);
  end if;

  if e.status in ('open', 'on_break') and e.started_at < now() - make_interval(hours => stale_hours) then
    keys := array_append(keys, 'open_entry'::text);
    perform private.upsert_incident(e, 'open_entry', 'open_entry',
      jsonb_build_object('hours', stale_hours));
  end if;

  -- Solapes con otras jornadas de la misma persona.
  for p in
    select o.id from public.time_entries o
    where o.employee_id = e.employee_id and o.id <> e.id and o.started_at is not null
      and e.started_at is not null
      and tstzrange(o.started_at, coalesce(o.ended_at, o.started_at + interval '1 second'), '[)')
       && tstzrange(e.started_at, coalesce(e.ended_at, e.started_at + interval '1 second'), '[)')
  loop
    keys := array_append(keys, ('overlap:' || p.id)::text);
    perform private.upsert_incident(e, 'overlap', 'overlap:' || p.id,
      jsonb_build_object('other_entry', p.id));
  end loop;

  -- Por fichaje: ubicación exigida y no obtenida; hora del dispositivo muy distinta.
  select * into policy from private.effective_time_policy(e.employee_id);
  for p in select * from public.punches where time_entry_id = e.id loop
    if policy.location_mode = 'required' and p.source <> 'kiosk' and p.location_status <> 'granted' then
      keys := array_append(keys, ('location_unavailable:' || p.id)::text);
      perform private.upsert_incident(e, 'location_unavailable', 'location_unavailable:' || p.id,
        jsonb_build_object('location_status', p.location_status), p.id);
    end if;
    if p.device_at is not null and abs(extract(epoch from p.server_at - p.device_at)) > 300 then
      keys := array_append(keys, ('device_time_mismatch:' || p.id)::text);
      perform private.upsert_incident(e, 'device_time_mismatch', 'device_time_mismatch:' || p.id,
        jsonb_build_object('minutes', (extract(epoch from p.server_at - p.device_at) / 60)::integer), p.id);
    end if;
  end loop;

  -- Las que ya no aplican se dan por resueltas automáticamente.
  update public.time_incidents
  set status = 'resolved', resolved_at = now(), resolution_note = 'Resuelta al recalcular la jornada'
  where time_entry_id = e.id and status = 'open' and not (dedupe_key = any (keys));
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Registro de fichajes
-- -----------------------------------------------------------------------------

-- Núcleo común (app y terminal). Serializa por persona, aplica idempotencia y la
-- máquina de estados, y recalcula la jornada en la misma transacción.
create or replace function private.insert_punch(
  p_employee uuid,
  p_kind public.punch_kind,
  p_idempotency_key uuid,
  p_source public.punch_source,
  p_device_at timestamptz,
  p_device_id uuid,
  p_kiosk_device uuid,
  p_location_status public.location_status,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m integer,
  p_selfie_path text,
  -- Solo para pruebas desde SQL: las funciones públicas usan siempre now().
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  emp record;
  tz text;
  existing public.punches;
  current_entry public.time_entries;
  next_state public.time_entry_status;
  entry_id uuid;
  punch_id uuid;
  now_at timestamptz := p_now;
  stale_hours constant integer := 16;
begin
  select e.id, e.company_id, e.end_date into emp from public.employees e where e.id = p_employee;
  if emp.id is null then
    raise exception 'Empleado no encontrado' using errcode = 'P0002';
  end if;
  tz := private.employee_time_zone(p_employee);
  if emp.end_date is not null and (now_at at time zone tz)::date > emp.end_date then
    raise exception 'La relación laboral ha terminado: no se pueden registrar fichajes' using errcode = 'P0001';
  end if;

  -- Un fichaje a la vez por persona (doble toque, reintentos y terminal a la vez).
  perform pg_advisory_xact_lock(hashtextextended('punch:' || p_employee::text, 0));

  select * into existing from public.punches
  where company_id = emp.company_id and employee_id = p_employee and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.kind <> p_kind then
      raise exception 'Esa clave ya se usó para otro fichaje' using errcode = '22023';
    end if;
    return jsonb_build_object('punch_id', existing.id, 'time_entry_id', existing.time_entry_id,
      'server_at', existing.server_at, 'kind', existing.kind, 'duplicate', true,
      'status', (select status from public.time_entries where id = existing.time_entry_id));
  end if;

  select * into current_entry from public.time_entries
  where employee_id = p_employee and status in ('open', 'on_break')
  for update;

  -- Olvido: una jornada abierta hace más de 16 h se cierra como incompleta al
  -- empezar otra. No se inventa la hora de salida: queda una incidencia.
  if current_entry.id is not null and p_kind = 'start'
     and current_entry.started_at < now_at - make_interval(hours => stale_hours) then
    update public.time_entries set status = 'incomplete', closed_incomplete_at = now_at
    where id = current_entry.id;
    perform private.recalculate_time_entry(current_entry.id);
    current_entry := null;
  end if;

  next_state := private.punch_transition(current_entry.status, p_kind);
  if next_state is null then
    raise exception '%', case
      when current_entry.id is null then 'No hay ninguna jornada abierta: empieza la jornada primero'
      when p_kind = 'start' then 'Ya tienes una jornada abierta'
      when current_entry.status = 'on_break' then 'Estás en pausa: reanuda antes de esta acción'
      else 'No estás en pausa'
    end using errcode = 'P0001', hint = 'TRANSICION_NO_VALIDA';
  end if;

  if current_entry.id is null then
    insert into public.time_entries (company_id, employee_id, work_date, time_zone, status, started_at)
    values (emp.company_id, p_employee, (now_at at time zone tz)::date, tz, 'open', now_at)
    returning id into entry_id;
  else
    entry_id := current_entry.id;
  end if;

  insert into public.punches (company_id, employee_id, time_entry_id, kind, server_at, device_at,
    time_zone, source, device_id, kiosk_device_id, idempotency_key, location_status, latitude,
    longitude, accuracy_m, selfie_path, created_by)
  values (emp.company_id, p_employee, entry_id, p_kind, now_at, p_device_at, tz, p_source, p_device_id,
    p_kiosk_device, p_idempotency_key, p_location_status, p_latitude, p_longitude, p_accuracy_m,
    p_selfie_path, (select auth.uid()))
  returning id into punch_id;

  perform private.recalculate_time_entry(entry_id);

  return jsonb_build_object('punch_id', punch_id, 'time_entry_id', entry_id, 'server_at', now_at,
    'kind', p_kind, 'duplicate', false,
    'status', (select status from public.time_entries where id = entry_id));
end;
$$;

-- Fichaje desde la aplicación (móvil o web) de la propia persona.
create or replace function public.record_punch(
  p_company uuid,
  p_kind public.punch_kind,
  p_idempotency_key uuid,
  p_source public.punch_source,
  p_device_at timestamptz default null,
  p_device_id uuid default null,
  p_location_status public.location_status default 'not_requested',
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_accuracy_m integer default null,
  p_selfie_path text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  employee uuid;
  policy record;
begin
  select e.id into employee from public.employees e
  where e.company_id = p_company and e.membership_id is not null
    and e.membership_id = private.current_membership_id(p_company);
  if employee is null then
    raise exception 'No tienes ficha de empleado en esta empresa' using errcode = 'P0002';
  end if;
  if p_source not in ('mobile', 'web') then
    raise exception 'Origen no válido' using errcode = '22023';
  end if;

  select * into policy from private.effective_time_policy(employee);
  -- Sin ubicación si la política no la usa: no se guarda nada aunque llegue.
  if policy.location_mode = 'off' then
    p_location_status := 'not_requested';
    p_latitude := null; p_longitude := null; p_accuracy_m := null;
  elsif p_location_status <> 'granted' then
    p_latitude := null; p_longitude := null; p_accuracy_m := null;
  elsif p_latitude is null or p_longitude is null then
    raise exception 'Ubicación incompleta' using errcode = '22023';
  end if;

  if p_selfie_path is not null then
    if not policy.selfie_enabled then
      raise exception 'La selfie no está activada en tu empresa' using errcode = '22023';
    end if;
    if p_selfie_path <> format('%s/%s/%s.jpg', p_company, employee, p_idempotency_key)
       or not exists (select 1 from storage.objects o where o.bucket_id = 'punch-selfies' and o.name = p_selfie_path) then
      raise exception 'Foto no válida' using errcode = '22023';
    end if;
  end if;

  return private.insert_punch(employee, p_kind, p_idempotency_key, p_source, p_device_at, p_device_id,
    null, p_location_status, p_latitude, p_longitude, p_accuracy_m, p_selfie_path);
end;
$$;

-- Estado actual y política para la pantalla de fichaje.
create or replace function public.my_time_status(p_company uuid)
returns table (
  employee_id uuid,
  time_zone text,
  entry_id uuid,
  entry_status public.time_entry_status,
  started_at timestamptz,
  location_mode public.location_mode,
  location_notice text,
  selfie_enabled boolean,
  has_kiosk_pin boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, private.employee_time_zone(e.id), t.id, t.status, t.started_at,
    p.location_mode, p.location_notice, p.selfie_enabled,
    exists (select 1 from public.kiosk_pins k where k.employee_id = e.id and k.pin_hash is not null)
  from public.employees e
  cross join lateral private.effective_time_policy(e.id) p
  left join public.time_entries t on t.employee_id = e.id and t.status in ('open', 'on_break')
  where e.company_id = p_company and e.membership_id is not null
    and e.membership_id = private.current_membership_id(p_company);
$$;

-- Accesos de control horario del propio usuario (para adaptar la interfaz).
create or replace function public.my_time_access(p_company uuid)
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
    and private.role_has_time_permission(ra.role, a);
$$;

-- -----------------------------------------------------------------------------
-- 8. Terminal compartido (ADR-036)
-- -----------------------------------------------------------------------------

create or replace function private.token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- Alta de un terminal: devuelve el token en claro UNA sola vez.
create or replace function public.register_kiosk_device(p_work_center uuid, p_name text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  company uuid;
  token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  select w.company_id into company from public.work_centers w where w.id = p_work_center;
  if company is null or not private.has_time_permission(company, 'manage', p_work_center) then
    raise exception 'Centro no encontrado' using errcode = 'P0002';
  end if;
  insert into public.kiosk_devices (company_id, work_center_id, name, token_hash, created_by)
  values (company, p_work_center, btrim(p_name), private.token_hash(token), (select auth.uid()));
  return token;
end;
$$;

-- Comprobación del token al activar el terminal (sin datos de personas).
create or replace function public.kiosk_device_info(p_token text)
returns table (device_name text, work_center_name text, company_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.name, w.name, c.name
  from public.kiosk_devices d
  join public.work_centers w on w.id = d.work_center_id
  join public.companies c on c.id = d.company_id
  where d.token_hash = private.token_hash(p_token) and d.status = 'active' and c.status = 'active';
$$;

-- El PIN lo define cada persona; nadie más lo conoce.
create or replace function public.set_my_kiosk_pin(p_company uuid, p_pin text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  employee uuid;
begin
  select e.id into employee from public.employees e
  where e.company_id = p_company and e.membership_id is not null
    and e.membership_id = private.current_membership_id(p_company);
  if employee is null then
    raise exception 'No tienes ficha de empleado en esta empresa' using errcode = 'P0002';
  end if;
  if p_pin !~ '^[0-9]{6}$' then
    raise exception 'El PIN debe tener 6 cifras' using errcode = '22023';
  end if;
  if p_pin ~ '^(.)\1{5}$' or position(p_pin in '0123456789') > 0 or position(p_pin in '9876543210') > 0 then
    raise exception 'Elige un PIN menos predecible (sin cifras repetidas ni consecutivas)' using errcode = '22023';
  end if;
  insert into public.kiosk_pins (employee_id, company_id, pin_hash, failed_attempts, locked_until, updated_at)
  values (employee, p_company, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), 0, null, now())
  on conflict (employee_id) do update
    set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, updated_at = now();
end;
$$;

-- RR. HH. puede anular un PIN (olvido o sospecha); la persona define uno nuevo.
create or replace function public.reset_kiosk_pin(p_employee uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.employee_time_permission(p_employee, 'manage') or private.is_self_employee(p_employee) then
    raise exception 'Empleado no encontrado' using errcode = 'P0002';
  end if;
  update public.kiosk_pins set pin_hash = null, failed_attempts = 0, locked_until = null, updated_at = now()
  where employee_id = p_employee;
end;
$$;

-- Fichaje en el terminal. Accesible sin sesión: la identidad es el token del
-- dispositivo + código de empleado + PIN. No lanza errores de autenticación para
-- que los contadores de intentos se guarden. Nunca devuelve datos de la persona.
create or replace function public.kiosk_punch(
  p_token text,
  p_employee_code text,
  p_pin text,
  p_kind public.punch_kind,
  p_idempotency_key uuid,
  p_device_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  device public.kiosk_devices;
  employee uuid;
  pin public.kiosk_pins;
  ok boolean;
  recent_failures integer;
  result jsonb;
  device_limit constant integer := 20;   -- fallos por terminal en 10 minutos
  employee_limit constant integer := 5;  -- fallos seguidos por persona
begin
  select * into device from public.kiosk_devices
  where token_hash = private.token_hash(p_token) and status = 'active';
  if device.id is null then
    return jsonb_build_object('status', 'device_invalid');
  end if;
  if device.blocked_until is not null and device.blocked_until > now() then
    return jsonb_build_object('status', 'device_blocked', 'retry_after', device.blocked_until);
  end if;
  select count(*) into recent_failures from public.kiosk_attempts
  where device_id = device.id and not success and created_at > now() - interval '10 minutes';
  if recent_failures >= device_limit then
    update public.kiosk_devices set blocked_until = now() + interval '10 minutes' where id = device.id;
    return jsonb_build_object('status', 'device_blocked', 'retry_after', now() + interval '10 minutes');
  end if;

  select e.id into employee from public.employees e
  where e.company_id = device.company_id and e.employee_code = upper(btrim(coalesce(p_employee_code, '')));
  select * into pin from public.kiosk_pins where employee_id = employee;

  if pin.employee_id is not null and pin.locked_until is not null and pin.locked_until > now() then
    insert into public.kiosk_attempts (company_id, device_id, employee_id, success)
    values (device.company_id, device.id, employee, false);
    return jsonb_build_object('status', 'locked', 'retry_after', pin.locked_until);
  end if;

  -- Mismo coste tanto si el código existe como si no (sin pistas por tiempo).
  ok := coalesce(p_pin, '') ~ '^[0-9]{6}$'
    and extensions.crypt(coalesce(p_pin, ''), coalesce(pin.pin_hash, extensions.gen_salt('bf', 8)))
        = pin.pin_hash;

  if not coalesce(ok, false) then
    insert into public.kiosk_attempts (company_id, device_id, employee_id, success)
    values (device.company_id, device.id, employee, false);
    if pin.employee_id is not null then
      update public.kiosk_pins set
        failed_attempts = case when failed_attempts + 1 >= employee_limit then 0 else failed_attempts + 1 end,
        locked_until = case when failed_attempts + 1 >= employee_limit
          then now() + interval '15 minutes' else locked_until end
      where employee_id = pin.employee_id;
    end if;
    return jsonb_build_object('status', 'invalid');
  end if;

  update public.kiosk_pins set failed_attempts = 0, locked_until = null where employee_id = employee;
  update public.kiosk_devices set last_used_at = now() where id = device.id;
  insert into public.kiosk_attempts (company_id, device_id, employee_id, success)
  values (device.company_id, device.id, employee, true);

  begin
    result := private.insert_punch(employee, p_kind, p_idempotency_key, 'kiosk', p_device_at, null,
      device.id, 'not_requested', null, null, null, null);
  exception when others then
    return jsonb_build_object('status', 'rejected', 'message', sqlerrm);
  end;
  return jsonb_build_object('status', 'ok', 'kind', result ->> 'kind', 'server_at', result ->> 'server_at',
    'duplicate', (result ->> 'duplicate')::boolean, 'time_zone', private.employee_time_zone(employee));
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Correcciones e incidencias
-- -----------------------------------------------------------------------------

create or replace function public.request_time_correction(
  p_employee uuid,
  p_action public.correction_action,
  p_reason text,
  p_entry uuid default null,
  p_punch uuid default null,
  p_kind public.punch_kind default null,
  p_proposed_at timestamptz default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  emp record;
  request uuid;
begin
  select e.id, e.company_id into emp from public.employees e where e.id = p_employee;
  if emp.id is null or not (private.is_self_employee(p_employee)
     or private.employee_time_permission(p_employee, 'manage')) then
    raise exception 'Empleado no encontrado' using errcode = 'P0002';
  end if;
  if p_punch is not null then
    select p.time_entry_id into p_entry from public.punches p
    where p.id = p_punch and p.employee_id = p_employee;
    if p_entry is null then
      raise exception 'Fichaje no encontrado' using errcode = 'P0002';
    end if;
  end if;
  if p_entry is not null and not exists (
    select 1 from public.time_entries t where t.id = p_entry and t.employee_id = p_employee
  ) then
    raise exception 'Jornada no encontrada' using errcode = 'P0002';
  end if;
  if p_proposed_at is not null and p_proposed_at > now() then
    raise exception 'No se pueden proponer horas futuras' using errcode = '22023';
  end if;
  if p_action = 'add' and p_entry is null and p_kind <> 'start' then
    raise exception 'Para una jornada sin fichajes, empieza proponiendo la entrada' using errcode = '22023';
  end if;

  insert into public.time_correction_requests (company_id, employee_id, time_entry_id, action, punch_id,
    kind, proposed_at, reason, requested_by)
  values (emp.company_id, p_employee, p_entry, p_action, p_punch, p_kind, p_proposed_at,
    btrim(p_reason), (select auth.uid()))
  returning id into request;
  return request;
end;
$$;

create or replace function public.cancel_time_correction(p_request uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.time_correction_requests set status = 'cancelled'
  where id = p_request and status = 'pending'
    and (requested_by = (select auth.uid()) or private.is_self_employee(employee_id));
  if not found then
    raise exception 'Solicitud no encontrada o ya decidida' using errcode = 'P0002';
  end if;
end;
$$;

-- Decide una corrección. Aprobar crea un ajuste (antes, después, motivo,
-- decisión) y recalcula la jornada; si el resultado fuera imposible, se rechaza
-- la operación entera y no cambia nada.
create or replace function public.decide_time_correction(p_request uuid, p_approve boolean, p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.time_correction_requests;
  entry_id uuid;
  tz text;
  before_snapshot jsonb;
  adjustment uuid;
begin
  select * into r from public.time_correction_requests where id = p_request for update;
  if r.id is null or not private.can_decide_time_corrections(r.employee_id) then
    raise exception 'Solicitud no encontrada' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'La solicitud ya está decidida' using errcode = 'P0001';
  end if;
  if r.requested_by = (select auth.uid()) then
    raise exception 'Quien solicita una corrección no puede aprobarla' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('punch:' || r.employee_id::text, 0));

  if p_approve and r.punch_id is not null and exists (
    select 1 from public.time_adjustments a where a.punch_id = r.punch_id and a.action in ('change', 'void')
  ) then
    raise exception 'Ese fichaje ya se corrigió: solicita la corrección sobre su valor actual' using errcode = 'P0001';
  end if;

  if not p_approve then
    update public.time_correction_requests
    set status = 'rejected', decided_by = (select auth.uid()), decided_at = now(),
      decision_note = nullif(btrim(p_note), '')
    where id = r.id;
    insert into public.work_events (company_id, employee_id, event_type, dedupe_key, payload)
    values (r.company_id, r.employee_id, 'correction_decided', 'correction:' || r.id,
      jsonb_build_object('request_id', r.id, 'decision', 'rejected'));
    return null;
  end if;

  entry_id := r.time_entry_id;
  if entry_id is null then
    -- Jornada que no llegó a abrirse: se crea a partir de la entrada propuesta.
    tz := private.employee_time_zone(r.employee_id);
    -- Queda incompleta hasta que también se apruebe su salida.
    insert into public.time_entries (company_id, employee_id, work_date, time_zone, status, started_at,
      closed_incomplete_at)
    values (r.company_id, r.employee_id, (r.proposed_at at time zone tz)::date, tz, 'incomplete',
      r.proposed_at, now())
    returning id into entry_id;
    before_snapshot := jsonb_build_object('status', null, 'punches', '[]'::jsonb);
  else
    before_snapshot := private.time_entry_snapshot(entry_id);
  end if;

  insert into public.time_adjustments (company_id, employee_id, time_entry_id, request_id, action, punch_id,
    kind, effective_at, before, after, reason, decision_note, requested_by, decided_by)
  values (r.company_id, r.employee_id, entry_id, r.id, r.action, r.punch_id, r.kind, r.proposed_at,
    before_snapshot, '{}'::jsonb, r.reason, nullif(btrim(p_note), ''), r.requested_by, (select auth.uid()))
  returning id into adjustment;

  perform private.recalculate_time_entry(entry_id);

  -- El "después" se fija en la misma transacción; después el ajuste es inmutable.
  update public.time_adjustments set after = private.time_entry_snapshot(entry_id) where id = adjustment;

  update public.time_correction_requests
  set status = 'approved', decided_by = (select auth.uid()), decided_at = now(),
    decision_note = nullif(btrim(p_note), ''), time_entry_id = entry_id
  where id = r.id;
  insert into public.work_events (company_id, employee_id, event_type, dedupe_key, payload)
  values (r.company_id, r.employee_id, 'correction_decided', 'correction:' || r.id,
    jsonb_build_object('request_id', r.id, 'decision', 'approved'));
  return adjustment;
end;
$$;

create or replace function public.resolve_time_incident(
  p_incident uuid,
  p_status public.time_incident_status,
  p_note text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  i public.time_incidents;
begin
  select * into i from public.time_incidents where id = p_incident for update;
  if i.id is null or not (private.employee_time_permission(i.employee_id, 'manage')
     or (private.manages_employee(i.employee_id) and not private.is_self_employee(i.employee_id))) then
    raise exception 'Incidencia no encontrada' using errcode = 'P0002';
  end if;
  if p_status not in ('resolved', 'dismissed') or i.status <> 'open' then
    raise exception 'Solo se resuelven o descartan incidencias abiertas' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Explica brevemente la resolución' using errcode = '22023';
  end if;
  update public.time_incidents
  set status = p_status, resolved_at = now(), resolved_by = (select auth.uid()),
    resolution_note = btrim(p_note)
  where id = i.id;
end;
$$;

-- Tarea periódica (cron con service_role): jornadas abiertas demasiado tiempo y
-- recordatorios de salida o de entrada olvidada. Idempotente.
create or replace function public.generate_time_reminders(p_now timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t record;
  e record;
  plan record;
  created integer := 0;
  n integer;
begin
  for t in select id, employee_id, company_id, work_date, started_at from public.time_entries
           where status in ('open', 'on_break') loop
    perform private.recalculate_time_entry(t.id);
    select * into plan from private.planned_shift(t.employee_id, t.work_date) limit 1;
    if (plan.ends_at is not null and p_now > plan.ends_at + make_interval(mins => plan.tolerance_late + 30))
       or t.started_at < p_now - interval '12 hours' then
      insert into public.work_events (company_id, employee_id, event_type, dedupe_key, payload)
      values (t.company_id, t.employee_id, 'reminder_open_entry', 'open:' || t.id,
        jsonb_build_object('work_date', t.work_date))
      on conflict (employee_id, dedupe_key) do nothing;
      get diagnostics n = row_count;
      created := created + n;
    end if;
  end loop;

  -- Entrada olvidada: turno planificado que empezó hace más de 30 min sin jornada.
  for e in select em.id, em.company_id, private.employee_time_zone(em.id) as tz
           from public.employees em where em.end_date is null or em.end_date >= (p_now at time zone 'UTC')::date - 1 loop
    select * into plan from private.planned_shift(e.id, (p_now at time zone e.tz)::date) limit 1;
    if plan.status = 'work' and plan.starts_at is not null
       and p_now between plan.starts_at + interval '30 minutes' and coalesce(plan.ends_at, plan.starts_at + interval '8 hours')
       and not exists (
         select 1 from public.time_entries te
         where te.employee_id = e.id and te.work_date = (p_now at time zone e.tz)::date
       ) then
      insert into public.work_events (company_id, employee_id, event_type, dedupe_key, payload)
      values (e.company_id, e.id, 'reminder_missing_start', 'start:' || (p_now at time zone e.tz)::date,
        jsonb_build_object('work_date', (p_now at time zone e.tz)::date))
      on conflict (employee_id, dedupe_key) do nothing;
      get diagnostics n = row_count;
      created := created + n;
    end if;
  end loop;
  return created;
end;
$$;

-- Selfies caducadas (30 días, ADR-037). El borrado del archivo lo hace la tarea
-- programada con la API de Storage y después marca el fichaje.
create or replace function public.expired_punch_selfies(p_limit integer default 500)
returns table (punch_id uuid, selfie_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.selfie_path from public.punches p
  where p.selfie_path is not null and p.server_at < now() - interval '30 days'
  order by p.server_at limit greatest(1, least(p_limit, 5000));
$$;

create or replace function public.mark_punch_selfie_purged(p_punch uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.punches set selfie_path = null, selfie_purged_at = now()
  where id = p_punch and selfie_path is not null and server_at < now() - interval '30 days';
$$;

-- -----------------------------------------------------------------------------
-- 10. Integridad: inmutabilidad y claves
-- -----------------------------------------------------------------------------

-- Los fichajes no cambian. Única excepción: retirar la foto caducada.
create or replace function private.guard_punch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'selfie_path' - 'selfie_purged_at') = (to_jsonb(old) - 'selfie_path' - 'selfie_purged_at')
     and old.selfie_path is not null and new.selfie_path is null and new.selfie_purged_at is not null then
    return new;
  end if;
  raise exception 'Los fichajes son inmutables: solicita una corrección' using errcode = '42501';
end;
$$;

-- Solicitudes: solo cambian de estado (y la jornada al aprobarse sin jornada previa).
create or replace function private.guard_correction_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending' then
    raise exception 'Una solicitud decidida no se modifica' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'status' - 'decided_by' - 'decided_at' - 'decision_note' - 'time_entry_id' - 'updated_at')
     <> (to_jsonb(old) - 'status' - 'decided_by' - 'decided_at' - 'decision_note' - 'time_entry_id' - 'updated_at') then
    raise exception 'Solo cambia la decisión de una solicitud' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Ajustes: el "después" se escribe una sola vez, en la transacción de aprobación.
create or replace function private.guard_adjustment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.after = '{}'::jsonb
     and (to_jsonb(new) - 'after') = (to_jsonb(old) - 'after') then
    return new;
  end if;
  raise exception 'Los ajustes son inmutables' using errcode = '42501';
end;
$$;

create or replace function private.guard_incident()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status' - 'resolved_at' - 'resolved_by' - 'resolution_note' - 'detail' - 'updated_at')
     <> (to_jsonb(old) - 'status' - 'resolved_at' - 'resolved_by' - 'resolution_note' - 'detail' - 'updated_at') then
    raise exception 'Solo cambia el estado de una incidencia' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger punches_guard before update or delete on public.punches
  for each row execute function private.guard_punch();
create trigger time_adjustments_guard before update or delete on public.time_adjustments
  for each row execute function private.guard_adjustment();
create trigger time_correction_requests_guard before update on public.time_correction_requests
  for each row execute function private.guard_correction_request();
create trigger time_incidents_guard before update on public.time_incidents
  for each row execute function private.guard_incident();
create trigger time_entries_no_delete before delete on public.time_entries
  for each row execute function private.prevent_mutation();
create trigger time_correction_requests_no_delete before delete on public.time_correction_requests
  for each row execute function private.prevent_mutation();
create trigger time_incidents_no_delete before delete on public.time_incidents
  for each row execute function private.prevent_mutation();
create trigger work_events_immutable before update or delete on public.work_events
  for each row when (current_user <> 'service_role') execute function private.prevent_mutation();

create trigger time_tracking_policies_updated_at before update on public.time_tracking_policies
  for each row execute function private.set_updated_at();
create trigger kiosk_devices_updated_at before update on public.kiosk_devices
  for each row execute function private.set_updated_at();
create trigger time_entries_updated_at before update on public.time_entries
  for each row execute function private.set_updated_at();
create trigger time_correction_requests_updated_at before update on public.time_correction_requests
  for each row execute function private.set_updated_at();
create trigger time_incidents_updated_at before update on public.time_incidents
  for each row execute function private.set_updated_at();

create trigger time_tracking_policies_keys before update on public.time_tracking_policies
  for each row execute function private.prevent_key_change('id', 'company_id', 'work_center_id');
create trigger kiosk_devices_keys before update on public.kiosk_devices
  for each row execute function private.prevent_key_change('id', 'company_id', 'work_center_id', 'token_hash');
create trigger time_entries_keys before update on public.time_entries
  for each row execute function private.prevent_key_change('id', 'company_id', 'employee_id', 'work_date');
create trigger time_correction_requests_keys before update on public.time_correction_requests
  for each row execute function private.prevent_key_change('id', 'company_id', 'employee_id');
create trigger time_incidents_keys before update on public.time_incidents
  for each row execute function private.prevent_key_change('id', 'company_id', 'employee_id', 'time_entry_id');

-- Auditoría completa (audit_log). Fichajes y jornadas no se auditan aquí: son
-- el propio registro inmutable y llevan coordenadas que no deben duplicarse.
create trigger audit_time_tracking_policies after insert or update on public.time_tracking_policies
  for each row execute function private.audit_row_change('company_id');
-- Del terminal se auditan altas, nombre y estado (no cada uso ni los bloqueos).
create trigger audit_kiosk_devices after insert or update of name, status on public.kiosk_devices
  for each row execute function private.audit_row_change('company_id');
create trigger audit_time_correction_requests after insert or update on public.time_correction_requests
  for each row execute function private.audit_row_change('company_id');
create trigger audit_time_adjustments after insert or update on public.time_adjustments
  for each row execute function private.audit_row_change('company_id');
create trigger audit_time_incidents after update on public.time_incidents
  for each row execute function private.audit_row_change('company_id');

-- -----------------------------------------------------------------------------
-- 11. Storage: selfies (bucket privado, solo JPEG sin metadatos, 2 MB)
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('punch-selfies', 'punch-selfies', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

-- Ruta: <company_id>/<employee_id>/<clave de idempotencia>.jpg
create or replace function private.object_employee_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  second_segment text := split_part(object_name, '/', 2);
begin
  if second_segment ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return second_segment::uuid;
  end if;
  return null;
end;
$$;

create policy "punch_selfies_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'punch-selfies'
    and private.can_read_employee_time(private.object_employee_id(name))
    and exists (
      select 1 from public.employees e
      where e.id = private.object_employee_id(name) and e.company_id = private.object_company_id(name)
    )
  );

create policy "punch_selfies_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'punch-selfies'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
    and private.is_self_employee(private.object_employee_id(name))
    and exists (
      select 1 from public.employees e
      cross join lateral private.effective_time_policy(e.id) p
      where e.id = private.object_employee_id(name) and e.company_id = private.object_company_id(name)
        and p.selfie_enabled
    )
  );

-- -----------------------------------------------------------------------------
-- 12. Privilegios
-- -----------------------------------------------------------------------------

revoke all on function
  private.role_has_time_permission(public.app_role, text),
  private.has_time_permission(uuid, text, uuid, uuid),
  private.employee_time_permission(uuid, text),
  private.can_read_employee_time(uuid),
  private.can_decide_time_corrections(uuid),
  private.employee_time_zone(uuid),
  private.local_to_utc(text, date, integer),
  private.planned_shift(uuid, date),
  private.effective_time_policy(uuid),
  private.punch_transition(public.time_entry_status, public.punch_kind),
  private.effective_punches(uuid),
  private.time_entry_snapshot(uuid),
  private.upsert_incident(public.time_entries, public.time_incident_kind, text, jsonb, uuid),
  private.recalculate_time_entry(uuid),
  private.insert_punch(uuid, public.punch_kind, uuid, public.punch_source, timestamptz, uuid, uuid,
    public.location_status, numeric, numeric, integer, text, timestamptz),
  private.token_hash(text),
  private.object_employee_id(text),
  private.guard_punch(),
  private.guard_correction_request(),
  private.guard_adjustment(),
  private.guard_incident()
from public;

-- Funciones usadas por políticas RLS y de Storage.
grant execute on function
  private.role_has_time_permission(public.app_role, text),
  private.has_time_permission(uuid, text, uuid, uuid),
  private.employee_time_permission(uuid, text),
  private.can_read_employee_time(uuid),
  private.can_decide_time_corrections(uuid),
  private.effective_time_policy(uuid),
  private.object_employee_id(text)
to authenticated, service_role;

revoke all on function
  public.record_punch(uuid, public.punch_kind, uuid, public.punch_source, timestamptz, uuid,
    public.location_status, numeric, numeric, integer, text),
  public.my_time_status(uuid),
  public.my_time_access(uuid),
  public.register_kiosk_device(uuid, text),
  public.kiosk_device_info(text),
  public.set_my_kiosk_pin(uuid, text),
  public.reset_kiosk_pin(uuid),
  public.kiosk_punch(text, text, text, public.punch_kind, uuid, timestamptz),
  public.request_time_correction(uuid, public.correction_action, text, uuid, uuid, public.punch_kind, timestamptz),
  public.cancel_time_correction(uuid),
  public.decide_time_correction(uuid, boolean, text),
  public.resolve_time_incident(uuid, public.time_incident_status, text),
  public.generate_time_reminders(timestamptz),
  public.expired_punch_selfies(integer),
  public.mark_punch_selfie_purged(uuid)
from public, anon;

grant execute on function
  public.record_punch(uuid, public.punch_kind, uuid, public.punch_source, timestamptz, uuid,
    public.location_status, numeric, numeric, integer, text),
  public.my_time_status(uuid),
  public.my_time_access(uuid),
  public.register_kiosk_device(uuid, text),
  public.set_my_kiosk_pin(uuid, text),
  public.reset_kiosk_pin(uuid),
  public.request_time_correction(uuid, public.correction_action, text, uuid, uuid, public.punch_kind, timestamptz),
  public.cancel_time_correction(uuid),
  public.decide_time_correction(uuid, boolean, text),
  public.resolve_time_incident(uuid, public.time_incident_status, text)
to authenticated, service_role;

-- Terminal: únicas funciones accesibles sin sesión (ADR-036).
grant execute on function
  public.kiosk_device_info(text),
  public.kiosk_punch(text, text, text, public.punch_kind, uuid, timestamptz)
to anon, authenticated, service_role;

-- Tareas programadas: solo con la clave de servicio (Supabase concede por
-- defecto execute a authenticated: se retira explícitamente).
revoke all on function
  public.generate_time_reminders(timestamptz),
  public.expired_punch_selfies(integer),
  public.mark_punch_selfie_purged(uuid)
from authenticated;
grant execute on function
  public.generate_time_reminders(timestamptz),
  public.expired_punch_selfies(integer),
  public.mark_punch_selfie_purged(uuid)
to service_role;

revoke all on public.time_tracking_policies, public.kiosk_devices, public.time_entries, public.punches,
  public.time_correction_requests, public.time_adjustments, public.time_incidents, public.kiosk_pins,
  public.kiosk_attempts, public.work_events
from anon, authenticated;

grant select on public.time_tracking_policies, public.time_entries, public.punches,
  public.time_correction_requests, public.time_adjustments, public.time_incidents, public.work_events
to authenticated;
-- El hash del token del terminal no se expone.
grant select (id, company_id, work_center_id, name, status, blocked_until, last_used_at, created_at)
  on public.kiosk_devices to authenticated;
grant insert (company_id, work_center_id, location_mode, location_notice, selfie_enabled)
  on public.time_tracking_policies to authenticated;
grant update (location_mode, location_notice, selfie_enabled) on public.time_tracking_policies to authenticated;
grant update (name, status, blocked_until) on public.kiosk_devices to authenticated;
-- Fichajes, jornadas, solicitudes, ajustes e incidencias: solo mediante funciones.

-- -----------------------------------------------------------------------------
-- 13. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.time_tracking_policies enable row level security;
alter table public.kiosk_devices enable row level security;
alter table public.time_entries enable row level security;
alter table public.punches enable row level security;
alter table public.time_correction_requests enable row level security;
alter table public.time_adjustments enable row level security;
alter table public.time_incidents enable row level security;
alter table public.kiosk_pins enable row level security;
alter table public.kiosk_attempts enable row level security;
alter table public.work_events enable row level security;

create policy "time_tracking_policies_select" on public.time_tracking_policies
  for select to authenticated
  using (private.is_company_member(company_id) or private.has_time_permission(company_id, 'read'));
create policy "time_tracking_policies_insert" on public.time_tracking_policies
  for insert to authenticated with check (private.has_time_permission(company_id, 'manage'));
create policy "time_tracking_policies_update" on public.time_tracking_policies
  for update to authenticated
  using (private.has_time_permission(company_id, 'manage'))
  with check (private.has_time_permission(company_id, 'manage'));

create policy "kiosk_devices_select" on public.kiosk_devices
  for select to authenticated
  using (private.has_time_permission(company_id, 'manage', work_center_id));
create policy "kiosk_devices_update" on public.kiosk_devices
  for update to authenticated
  using (private.has_time_permission(company_id, 'manage', work_center_id))
  with check (private.has_time_permission(company_id, 'manage', work_center_id));

create policy "time_entries_select" on public.time_entries
  for select to authenticated using (private.can_read_employee_time(employee_id));
create policy "punches_select" on public.punches
  for select to authenticated using (private.can_read_employee_time(employee_id));
create policy "time_adjustments_select" on public.time_adjustments
  for select to authenticated using (private.can_read_employee_time(employee_id));
create policy "time_incidents_select" on public.time_incidents
  for select to authenticated using (private.can_read_employee_time(employee_id));
create policy "time_correction_requests_select" on public.time_correction_requests
  for select to authenticated
  using (private.can_read_employee_time(employee_id) or private.can_decide_time_corrections(employee_id));
create policy "work_events_select" on public.work_events
  for select to authenticated using (private.is_self_employee(employee_id));
-- kiosk_pins y kiosk_attempts: sin políticas (ningún acceso desde la API).
