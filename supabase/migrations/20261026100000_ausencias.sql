-- =============================================================================
-- Vacaciones y ausencias: tipos configurables, políticas versionadas, libro de
-- movimientos de saldo, solicitudes con reserva transaccional, aprobación por
-- manager (con suplencias y escalado a RR. HH.), justificantes privados y
-- calendario con privacidad.
--
-- Principios (docs/AUSENCIAS.md):
--  - Ningún catálogo de permisos legales en el código: cada empresa configura
--    sus tipos y políticas (con su fuente: Estatuto, convenio, acuerdo).
--  - El saldo NO se guarda: es la suma del libro de movimientos (apertura,
--    devengo, arrastre, caducidad, reservas, usos y ajustes), que es inmutable.
--  - Cantidades enteras: medios días para políticas en días; minutos en horas.
--  - Una solicitud bloquea su saldo (FOR UPDATE) antes de reservar: dos
--    solicitudes simultáneas no pueden consumir el mismo saldo.
--  - Las versiones publicadas no cambian ni se aplican hacia atrás.
--  - Sin motivos ni diagnósticos en calendarios, avisos ni audit_log.
--
-- Reversión: supabase/rollbacks/20261026100000_ausencias.down.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------

create type public.absence_unit as enum ('day', 'half_day', 'hour');
create type public.balance_unit as enum ('half_days', 'minutes');
create type public.day_count_basis as enum ('working_days', 'calendar_days');
create type public.accrual_method as enum ('upfront', 'monthly');
create type public.proration_method as enum ('none', 'by_employment');
create type public.rounding_mode as enum ('down', 'up', 'nearest');
create type public.absence_request_status as enum (
  'pending', 'info_requested', 'approved', 'rejected', 'cancelled', 'withdrawn'
);
create type public.balance_movement_kind as enum (
  'opening', 'accrual', 'carryover', 'expiry', 'reservation', 'reservation_release',
  'usage', 'usage_reversal', 'adjustment'
);
create type public.policy_scope as enum ('company', 'work_center', 'team', 'employee');

-- -----------------------------------------------------------------------------
-- 2. Permisos de ausencias (ADR-039)
-- -----------------------------------------------------------------------------

-- 'read': consultar solicitudes y saldos del ámbito.
-- 'manage': decidir, ajustar saldos y configurar tipos, políticas y asignaciones.
-- 'attachments': abrir justificantes sensibles. Solo RR. HH.: ni la administración
-- de empresa ni la de grupo lo tienen por defecto.
create or replace function private.role_has_absence_permission(p_role public.app_role, p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'company_admin' then p_action in ('read', 'manage')
    when 'hr' then p_action in ('read', 'manage', 'attachments')
    when 'auditor' then p_action = 'read'
    else false
  end;
$$;

create or replace function private.has_absence_permission(
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
    (p_action <> 'attachments' and private.is_group_admin_of_company(p_company))
    or exists (
      select 1
      from public.role_assignments ra
      where ra.company_id = p_company
        and ra.membership_id = private.current_membership_id(p_company)
        and ra.status = 'active'
        and private.is_active_window(ra.valid_from, ra.valid_to)
        and private.role_has_absence_permission(ra.role, p_action)
        and (
          ra.scope_type = 'company'
          or (ra.scope_type = 'work_center' and ra.work_center_id = p_work_center)
          or (ra.scope_type = 'team' and ra.team_id = p_team)
        )
    )
  );
$$;

create or replace function private.employee_absence_permission(p_employee uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.has_absence_permission(e.company_id, p_action, e.work_center_id, e.team_id)
    from public.employees e where e.id = p_employee
  ), false);
$$;

-- Aprobador efectivo de ausencias ahora mismo (manager o suplente), o null.
create or replace function private.absence_approver(p_employee uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  approver uuid;
begin
  select r.approver_user_id into approver
  from private.resolve_approver_internal(p_employee, 'absences', now()) r;
  return approver;
exception when others then
  return null;
end;
$$;

create or replace function private.can_read_employee_absences(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_self_employee(p_employee)
    or private.manages_employee(p_employee)
    or private.employee_absence_permission(p_employee, 'read');
$$;

-- Decide: RR. HH. con gestión en su ámbito o el aprobador efectivo. Nunca la propia persona.
create or replace function private.can_decide_absences(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not private.is_self_employee(p_employee) and (
    private.employee_absence_permission(p_employee, 'manage')
    or private.absence_approver(p_employee) = (select auth.uid())
  );
$$;

-- -----------------------------------------------------------------------------
-- 3. Tipos de ausencia y políticas versionadas
-- -----------------------------------------------------------------------------

create table public.absence_types (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies (id) on delete restrict,
  code                    text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name                    text not null check (char_length(btrim(name)) between 2 and 80),
  allowed_units           public.absence_unit[] not null default '{day}'
    check (cardinality(allowed_units) between 1 and 3),
  count_basis             public.day_count_basis not null default 'working_days',
  uses_balance            boolean not null default false,
  -- Aprobación por manager salvo regla expresa aprobada (con su referencia).
  requires_approval       boolean not null default true,
  approval_exemption_ref  text check (approval_exemption_ref is null or char_length(approval_exemption_ref) <= 300),
  requires_attachment     boolean not null default false,
  -- Justificante sensible: el manager solo ve que existe.
  attachment_sensitive    boolean not null default true,
  -- Tipo reservado: en calendarios ajenos y avisos solo aparece "Ausencia".
  is_private              boolean not null default false,
  -- Días hacia atrás que se admiten (p. ej. ausencias imprevistas).
  max_past_days           integer not null default 0 check (max_past_days between 0 and 90),
  -- Fuente que la empresa declara (no se valida su contenido jurídico).
  legal_reference         text check (legal_reference is null or char_length(legal_reference) <= 300),
  status                  public.entity_status not null default 'active',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (company_id, code),
  unique (id, company_id),
  constraint absence_types_exemption_check check (
    requires_approval or char_length(btrim(coalesce(approval_exemption_ref, ''))) >= 5
  )
);

create table public.vacation_policies (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete restrict,
  absence_type_id    uuid not null,
  code               text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name               text not null check (char_length(btrim(name)) between 2 and 120),
  -- Mes en que empieza el periodo anual (1 = año natural).
  period_start_month smallint not null default 1 check (period_start_month between 1 and 12),
  status             public.entity_status not null default 'active',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, code),
  unique (id, company_id),
  unique (id, absence_type_id, company_id),
  foreign key (absence_type_id, company_id) references public.absence_types (id, company_id)
);

-- Reglas versionadas por vigencia. Una versión publicada es inmutable.
create table public.vacation_policy_versions (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies (id) on delete restrict,
  policy_id               uuid not null,
  version                 integer not null check (version >= 1),
  unit                    public.balance_unit not null default 'half_days',
  -- Derecho por periodo completo, en la unidad (44 medios días = 22 días).
  entitlement             integer not null check (entitlement between 0 and 1000000),
  accrual_method          public.accrual_method not null default 'upfront',
  proration               public.proration_method not null default 'by_employment',
  rounding_mode           public.rounding_mode not null default 'nearest',
  rounding_step           integer not null default 1 check (rounding_step between 1 and 1440),
  carryover_max           integer not null default 0 check (carryover_max >= 0),
  carryover_expiry_months smallint check (carryover_expiry_months between 1 and 24),
  allow_negative          boolean not null default false,
  negative_limit          integer not null default 0 check (negative_limit >= 0),
  negative_reason         text check (negative_reason is null or char_length(negative_reason) <= 300),
  status                  public.schedule_status not null default 'draft',
  valid_from              date,
  valid_to                date,
  published_by            uuid references public.profiles (id) on delete set null,
  published_at            timestamptz,
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (company_id, policy_id, version),
  unique (id, company_id),
  foreign key (policy_id, company_id) references public.vacation_policies (id, company_id),
  constraint vacation_policy_versions_negative_check check (
    not allow_negative or (negative_limit > 0 and char_length(btrim(coalesce(negative_reason, ''))) >= 10)
  ),
  constraint vacation_policy_versions_published_check check (
    status <> 'published' or (valid_from is not null and published_at is not null
      and (valid_to is null or valid_to > valid_from))
  ),
  constraint vacation_policy_versions_excl exclude using gist (
    policy_id with =, daterange(valid_from, valid_to, '[)') with &&
  ) where (status = 'published')
);

-- Qué política aplica a quién: persona › equipo › centro › empresa.
create table public.policy_assignments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  policy_id       uuid not null,
  absence_type_id uuid not null,
  scope_type      public.policy_scope not null,
  employee_id     uuid,
  team_id         uuid,
  work_center_id  uuid,
  valid_from      date not null,
  valid_to        date check (valid_to is null or valid_to > valid_from),
  status          public.grant_status not null default 'active',
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, company_id),
  foreign key (policy_id, absence_type_id, company_id)
    references public.vacation_policies (id, absence_type_id, company_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (team_id, company_id) references public.teams (id, company_id),
  foreign key (work_center_id, company_id) references public.work_centers (id, company_id),
  constraint policy_assignments_scope_check check (
    (scope_type = 'company' and employee_id is null and team_id is null and work_center_id is null)
    or (scope_type = 'work_center' and work_center_id is not null and employee_id is null and team_id is null)
    or (scope_type = 'team' and team_id is not null and employee_id is null and work_center_id is null)
    or (scope_type = 'employee' and employee_id is not null and team_id is null and work_center_id is null)
  ),
  -- Una sola política por tipo de ausencia, nivel y sujeto en cada fecha.
  constraint policy_assignments_excl exclude using gist (
    company_id with =, absence_type_id with =, scope_type with =,
    coalesce(employee_id, team_id, work_center_id, company_id) with =,
    daterange(valid_from, valid_to, '[)') with &&
  ) where (status = 'active')
);

create index policy_assignments_company_idx on public.policy_assignments (company_id, absence_type_id);

-- -----------------------------------------------------------------------------
-- 4. Saldos y libro de movimientos
-- -----------------------------------------------------------------------------

-- Saldo de una persona para una política y un periodo. Sin importes: el saldo
-- es la suma de sus movimientos. La versión aplicada queda fijada al abrirlo.
create table public.vacation_balances (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  employee_id       uuid not null,
  policy_id         uuid not null,
  policy_version_id uuid not null,
  period_start      date not null,
  period_end        date not null, -- excluido
  unit              public.balance_unit not null,
  status            text not null default 'open' check (status in ('open', 'closed')),
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  unique (company_id, employee_id, policy_id, period_start),
  unique (id, company_id),
  unique (id, company_id, employee_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (policy_id, company_id) references public.vacation_policies (id, company_id),
  foreign key (policy_version_id, company_id) references public.vacation_policy_versions (id, company_id),
  constraint vacation_balances_period_check check (period_end > period_start)
);

-- -----------------------------------------------------------------------------
-- 5. Solicitudes, aprobación, eventos y adjuntos
-- -----------------------------------------------------------------------------

create table public.absence_requests (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  employee_id       uuid not null,
  absence_type_id   uuid not null,
  balance_id        uuid,
  unit              public.absence_unit not null,
  start_date        date not null,
  end_date          date not null, -- incluido
  half              text check (half in ('morning', 'afternoon')),
  start_minute      integer check (start_minute between 0 and 1439),
  end_minute        integer check (end_minute between 1 and 1440),
  -- Instantes que ocupa (en la zona del centro): impide solapes por construcción.
  period            tstzrange not null,
  -- Cantidad en la unidad del saldo (medios días o minutos).
  amount            integer not null check (amount > 0),
  amount_unit       public.balance_unit not null,
  status            public.absence_request_status not null default 'pending',
  -- Comentario para quien aprueba (se avisa de no incluir datos de salud).
  employee_note     text check (employee_note is null or char_length(employee_note) <= 500),
  -- 'manager' | 'substitute' | 'hr_no_approver' | 'hr_self_approval' | 'auto_rule'
  routing           text not null,
  idempotency_key   uuid not null,
  submitted_at      timestamptz not null default now(),
  decided_at        timestamptz,
  decided_by        uuid references public.profiles (id) on delete set null,
  created_by        uuid references public.profiles (id) on delete set null,
  updated_at        timestamptz not null default now(),
  unique (id, company_id),
  unique (id, company_id, employee_id),
  unique (company_id, employee_id, idempotency_key),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (absence_type_id, company_id) references public.absence_types (id, company_id),
  foreign key (balance_id, company_id, employee_id)
    references public.vacation_balances (id, company_id, employee_id),
  constraint absence_requests_dates_check check (end_date >= start_date),
  constraint absence_requests_shape_check check (
    (unit = 'day' and half is null and start_minute is null and end_minute is null)
    or (unit = 'half_day' and start_date = end_date and half is not null and start_minute is null)
    or (unit = 'hour' and start_date = end_date and half is null and end_minute > start_minute)
  ),
  constraint absence_requests_overlap_excl exclude using gist (
    employee_id with =, period with &&
  ) where (status in ('pending', 'info_requested', 'approved'))
);

create index absence_requests_company_idx on public.absence_requests (company_id, status, start_date);
create index absence_requests_employee_idx on public.absence_requests (employee_id, start_date);

-- Libro de movimientos: inmutable. El saldo disponible es su suma.
create table public.balance_movements (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete restrict,
  employee_id    uuid not null,
  balance_id     uuid not null,
  kind           public.balance_movement_kind not null,
  amount         integer not null,
  request_id     uuid,
  -- Fecha a la que se imputa (inicio de la ausencia, mes devengado…).
  effective_date date not null,
  -- Arrastre: fecha en que caduca lo no disfrutado.
  expires_on     date,
  dedupe_key     text not null,
  note           text check (note is null or char_length(note) <= 300),
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (balance_id, dedupe_key),
  foreign key (balance_id, company_id, employee_id)
    references public.vacation_balances (id, company_id, employee_id),
  foreign key (request_id, company_id, employee_id)
    references public.absence_requests (id, company_id, employee_id),
  constraint balance_movements_sign_check check (
    (kind in ('opening', 'accrual', 'reservation_release', 'usage_reversal') and amount >= 0)
    or (kind in ('reservation', 'usage', 'expiry') and amount <= 0)
    or kind in ('carryover', 'adjustment')
  ),
  constraint balance_movements_adjustment_check check (
    kind <> 'adjustment' or char_length(btrim(coalesce(note, ''))) >= 5
  )
);

create index balance_movements_balance_idx on public.balance_movements (balance_id, effective_date);

-- Instancia de aprobación: quién debía decidir al enviarse y cómo terminó.
create table public.absence_approvals (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete restrict,
  employee_id      uuid not null,
  request_id       uuid not null unique,
  approver_user_id uuid references public.profiles (id) on delete set null,
  routing          text not null,
  status           text not null default 'pending' check (status in ('pending', 'decided', 'closed')),
  decided_by       uuid references public.profiles (id) on delete set null,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (id, company_id),
  foreign key (request_id, company_id, employee_id)
    references public.absence_requests (id, company_id, employee_id)
);

create index absence_approvals_approver_idx on public.absence_approvals (approver_user_id, status);

-- Historial de la solicitud (append-only). Los mensajes solo los ven las partes.
create table public.absence_request_events (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies (id) on delete restrict,
  employee_id uuid not null,
  request_id  uuid not null,
  action      text not null check (action in (
    'submitted', 'auto_approved', 'approved', 'rejected', 'info_requested', 'info_provided',
    'cancelled', 'withdrawn', 'attachment_added'
  )),
  message     text check (message is null or char_length(message) <= 500),
  actor_id    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  foreign key (request_id, company_id, employee_id)
    references public.absence_requests (id, company_id, employee_id)
);

create index absence_request_events_request_idx on public.absence_request_events (request_id, id);

-- Justificantes: el archivo en el bucket privado absence-attachments.
create table public.absence_attachments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  employee_id  uuid not null,
  request_id   uuid not null,
  storage_path text not null unique,
  mime_type    text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes   integer not null check (size_bytes between 1 and 5242880),
  -- Copiado del tipo al subirlo: decide si el manager puede abrirlo.
  sensitive    boolean not null,
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (id, company_id),
  foreign key (request_id, company_id, employee_id)
    references public.absence_requests (id, company_id, employee_id)
);

-- Ausencias aprobadas de día completo -> leave_periods (horarios y fichajes).
alter table public.leave_periods add column absence_request_id uuid;
alter table public.leave_periods
  add constraint leave_periods_absence_request_fkey foreign key (absence_request_id, company_id)
    references public.absence_requests (id, company_id);

-- Avisos a la persona sobre sus solicitudes (sin el tipo si es reservado).
alter table public.work_events drop constraint work_events_event_type_check;
alter table public.work_events add constraint work_events_event_type_check check (event_type in (
  'reminder_open_entry', 'reminder_missing_start', 'incident_detected', 'correction_decided',
  'absence_decided', 'absence_info_requested'
));

-- -----------------------------------------------------------------------------
-- 6. Reglas de cálculo
-- -----------------------------------------------------------------------------

-- n/d redondeado a múltiplos de step, solo con enteros.
create or replace function private.round_ratio(p_n bigint, p_d bigint, p_step integer, p_mode public.rounding_mode)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  unit bigint := p_d * p_step;
  q bigint;
  r bigint;
begin
  if p_d <= 0 or p_n <= 0 then
    return 0;
  end if;
  q := p_n / unit;
  r := p_n % unit;
  if p_mode = 'up' and r > 0 then
    q := q + 1;
  elsif p_mode = 'nearest' and 2 * r >= unit then
    q := q + 1;
  end if;
  return (q * p_step)::integer;
end;
$$;

create or replace function private.employee_today(p_employee uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone private.employee_time_zone(p_employee))::date;
$$;

-- Día laborable según el horario planificado; sin horario asignado, de lunes a
-- viernes no festivo (docs/AUSENCIAS.md, sección 3).
create or replace function private.is_working_day(p_employee uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p.status
    when 'work' then true
    when 'unassigned' then extract(isodow from p_day) < 6
    else false
  end
  from private.planned_shift(p_employee, p_day) p;
$$;

-- Todos los días del rango con condiciones de empleo vigentes y sin baja.
create or replace function private.employment_covers(p_employee uuid, p_from date, p_to date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from generate_series(p_from, p_to, interval '1 day') d
    where not exists (
      select 1 from public.employment_terms t
      where t.employee_id = p_employee and t.status = 'active'
        and t.valid_from <= d::date and (t.valid_to is null or t.valid_to > d::date)
    )
  ) and coalesce((select e.end_date is null or p_to <= e.end_date from public.employees e where e.id = p_employee), false);
$$;

-- Días con empleo vigente dentro de [p_from, p_to).
create or replace function private.employed_days(p_employee uuid, p_from date, p_to date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from generate_series(p_from, p_to - 1, interval '1 day') d
  where exists (
    select 1 from public.employment_terms t
    where t.employee_id = p_employee and t.status = 'active'
      and t.valid_from <= d::date and (t.valid_to is null or t.valid_to > d::date)
  );
$$;

-- Política aplicable: persona › equipo › centro › empresa.
create or replace function private.policy_for(p_employee uuid, p_type uuid, p_day date)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.policy_id
  from public.policy_assignments a
  join public.employees e on e.id = p_employee and e.company_id = a.company_id
  join public.vacation_policies vp on vp.id = a.policy_id and vp.status = 'active'
  where a.absence_type_id = p_type and a.status = 'active'
    and a.valid_from <= p_day and (a.valid_to is null or a.valid_to > p_day)
    and (
      (a.scope_type = 'employee' and a.employee_id = e.id)
      or (a.scope_type = 'team' and a.team_id = e.team_id)
      or (a.scope_type = 'work_center' and a.work_center_id = e.work_center_id)
      or a.scope_type = 'company'
    )
  order by case a.scope_type when 'employee' then 1 when 'team' then 2 when 'work_center' then 3 else 4 end
  limit 1;
$$;

create or replace function private.policy_version_at(p_policy uuid, p_day date)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id from public.vacation_policy_versions v
  where v.policy_id = p_policy and v.status = 'published'
    and v.valid_from <= p_day and (v.valid_to is null or v.valid_to > p_day);
$$;

create or replace function private.period_start_for(p_policy uuid, p_day date)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select make_date(
    extract(year from p_day)::integer - case when extract(month from p_day) < vp.period_start_month then 1 else 0 end,
    vp.period_start_month, 1)
  from public.vacation_policies vp where vp.id = p_policy;
$$;

create or replace function private.balance_available(p_balance uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount), 0)::integer from public.balance_movements where balance_id = p_balance;
$$;

-- Asiento en el libro (idempotente por clave).
create or replace function private.post_movement(
  p_balance uuid,
  p_kind public.balance_movement_kind,
  p_amount integer,
  p_effective date,
  p_key text,
  p_request uuid default null,
  p_note text default null,
  p_expires date default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.balance_movements (company_id, employee_id, balance_id, kind, amount, request_id,
    effective_date, expires_on, dedupe_key, note, created_by)
  select b.company_id, b.employee_id, b.id, p_kind, p_amount, p_request, p_effective, p_expires, p_key,
    p_note, (select auth.uid())
  from public.vacation_balances b where b.id = p_balance
  on conflict (balance_id, dedupe_key) do nothing;
$$;

-- Devengos pendientes y caducidad de arrastres de un saldo abierto, hasta hoy.
create or replace function private.settle_balance(p_balance uuid, p_today date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.vacation_balances;
  v public.vacation_policy_versions;
  m integer;
  month_start date;
  month_end date;
  employed integer;
  period_days integer;
  cumulative integer;
  accrued integer;
  c record;
  consumed integer;
begin
  select * into b from public.vacation_balances where id = p_balance;
  period_days := b.period_end - b.period_start;

  -- Devengo mensual al final de cada mes, con la versión vigente al empezar ese
  -- mes: un cambio de política solo afecta a los meses siguientes.
  for m in 1..12 loop
    month_start := (b.period_start + make_interval(months => m - 1))::date;
    month_end := (b.period_start + make_interval(months => m))::date;
    exit when month_end > p_today or month_end > b.period_end;
    select * into v from public.vacation_policy_versions
    where id = coalesce(private.policy_version_at(b.policy_id, month_start), b.policy_version_id);
    continue when v.accrual_method <> 'monthly' or v.unit <> b.unit;
    employed := case when v.proration = 'none' then month_end - b.period_start
      else private.employed_days(b.employee_id, b.period_start, month_end) end;
    cumulative := private.round_ratio(v.entitlement::bigint * employed, period_days, v.rounding_step, v.rounding_mode);
    select coalesce(sum(amount), 0) into accrued from public.balance_movements
    where balance_id = b.id and kind = 'accrual';
    perform private.post_movement(b.id, 'accrual', greatest(cumulative - accrued, 0), month_end - 1,
      'accrual:' || to_char(month_start, 'YYYY-MM'), null, format('Devengo de %s', to_char(month_start, 'MM/YYYY')));
  end loop;

  -- Caducidad del arrastre: lo arrastrado se consume primero; lo que no se haya
  -- usado (o reservado) antes de su fecha caduca.
  for c in select * from public.balance_movements
           where balance_id = b.id and kind = 'carryover' and amount > 0
             and expires_on is not null and expires_on <= p_today loop
    select coalesce(-sum(amount), 0) into consumed from public.balance_movements
    where balance_id = b.id and effective_date < c.expires_on
      and kind in ('reservation', 'reservation_release', 'usage', 'usage_reversal');
    perform private.post_movement(b.id, 'expiry', -greatest(c.amount - greatest(consumed, 0), 0), c.expires_on,
      'expiry:' || c.id, null, 'Caducidad de días arrastrados');
  end loop;
end;
$$;

-- Saldo de una persona para la política y el periodo de una fecha. Lo crea si
-- no existe (cerrando antes el periodo anterior, con su arrastre) y lo
-- bloquea (FOR UPDATE) para el resto de la transacción.
create or replace function private.ensure_balance(p_employee uuid, p_policy uuid, p_day date)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  start_date date := private.period_start_for(p_policy, p_day);
  end_date date := (start_date + interval '1 year')::date;
  today date := private.employee_today(p_employee);
  balance uuid;
  prev public.vacation_balances;
  version public.vacation_policy_versions;
  prev_version public.vacation_policy_versions;
  employed integer;
  remaining integer;
  carry integer := 0;
  company uuid;
begin
  -- Serializa la apertura de saldos de la persona para esa política.
  perform pg_advisory_xact_lock(hashtextextended('balance:' || p_employee || ':' || p_policy, 0));

  select id into balance from public.vacation_balances
  where employee_id = p_employee and policy_id = p_policy and period_start = start_date;

  if balance is null then
    select * into version from public.vacation_policy_versions
    where id = private.policy_version_at(p_policy, start_date);
    if version.id is null then
      -- Política nueva a mitad de periodo: vale la versión vigente ese día.
      select * into version from public.vacation_policy_versions
      where id = private.policy_version_at(p_policy, greatest(p_day, today));
    end if;
    if version.id is null then
      raise exception 'La política no tiene una versión vigente para esas fechas' using errcode = 'P0001';
    end if;

    -- Cierre del periodo anterior y arrastre (solo si ya terminó y está decidido).
    select * into prev from public.vacation_balances
    where employee_id = p_employee and policy_id = p_policy and period_end = start_date and status = 'open';
    if prev.id is not null and prev.period_end <= today and not exists (
      select 1 from public.absence_requests r
      where r.balance_id = prev.id and r.status in ('pending', 'info_requested')
    ) then
      perform private.settle_balance(prev.id, today);
      select * into prev_version from public.vacation_policy_versions where id = prev.policy_version_id;
      remaining := private.balance_available(prev.id);
      if prev.unit = version.unit then
        carry := case when remaining < 0 then remaining else least(remaining, prev_version.carryover_max) end;
      end if;
      if carry <> 0 then
        perform private.post_movement(prev.id, 'carryover', -carry, prev.period_end - 1, 'carryover_out',
          null, 'Arrastre al periodo siguiente');
      end if;
      if remaining - carry > 0 then
        perform private.post_movement(prev.id, 'expiry', -(remaining - carry), prev.period_end - 1, 'period_end',
          null, 'No disfrutado al cerrar el periodo');
      end if;
      update public.vacation_balances set status = 'closed', closed_at = now() where id = prev.id;
    end if;

    select e.company_id into company from public.employees e where e.id = p_employee;
    insert into public.vacation_balances (company_id, employee_id, policy_id, policy_version_id,
      period_start, period_end, unit)
    values (company, p_employee, p_policy, version.id, start_date, end_date, version.unit)
    returning id into balance;

    if version.accrual_method = 'upfront' then
      employed := case when version.proration = 'none' then end_date - start_date
        else private.employed_days(p_employee, start_date, end_date) end;
      perform private.post_movement(balance, 'opening',
        private.round_ratio(version.entitlement::bigint * employed, end_date - start_date,
          version.rounding_step, version.rounding_mode),
        start_date, 'opening', null, format('Derecho del periodo (versión %s)', version.version));
    end if;
    if carry <> 0 then
      perform private.post_movement(balance, 'carryover', carry, start_date, 'carryover_in', null,
        'Arrastre del periodo anterior',
        case when prev_version.carryover_expiry_months is not null and carry > 0
          then (start_date + make_interval(months => prev_version.carryover_expiry_months))::date end);
    end if;
  end if;

  perform 1 from public.vacation_balances where id = balance for update;
  if (select status from public.vacation_balances where id = balance) = 'open' then
    perform private.settle_balance(balance, today);
  end if;
  return balance;
end;
$$;

-- Comprobaciones y cantidad de una solicitud (sin escribir nada salvo abrir el
-- saldo). Devuelve la cantidad, el saldo y la lista de problemas.
create or replace function private.evaluate_absence(
  p_employee uuid,
  p_type uuid,
  p_unit public.absence_unit,
  p_start date,
  p_end date,
  p_half text,
  p_start_minute integer,
  p_end_minute integer,
  p_ignore_request uuid default null
)
returns table (amount integer, amount_unit public.balance_unit, balance_id uuid, available integer,
  period tstzrange, errors text[], warnings text[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  t public.absence_types;
  tz text := private.employee_time_zone(p_employee);
  today date := private.employee_today(p_employee);
  errs text[] := '{}';
  warns text[] := '{}';
  qty integer := 0;
  unit public.balance_unit := case when p_unit = 'hour' then 'minutes' else 'half_days' end;
  policy uuid;
  version public.vacation_policy_versions;
  bal uuid;
  avail integer;
  rng tstzrange;
begin
  select * into t from public.absence_types
  where id = p_type and company_id = (select company_id from public.employees where id = p_employee);
  if t.id is null or t.status <> 'active' then
    return query select 0, unit, null::uuid, null::integer, null::tstzrange,
      array['Tipo de ausencia no disponible'], warns;
    return;
  end if;
  if not (p_unit = any (t.allowed_units)) then
    errs := errs || 'Este tipo no admite esa unidad'::text;
  end if;
  if p_end < p_start then
    errs := errs || 'La fecha de fin es anterior a la de inicio'::text;
  elsif p_end - p_start > 366 then
    errs := errs || 'Una solicitud no puede superar un año'::text;
  end if;
  if p_start < today - t.max_past_days then
    errs := errs || case when t.max_past_days = 0 then 'No se admiten fechas pasadas para este tipo'
      else format('Como mucho %s días hacia atrás para este tipo', t.max_past_days) end;
  end if;
  if p_unit = 'half_day' and (p_half is null or p_half not in ('morning', 'afternoon')) then
    errs := errs || 'Indica mañana o tarde'::text;
  end if;
  if p_unit = 'hour' and (p_start_minute is null or p_end_minute is null or p_end_minute <= p_start_minute
     or p_start_minute < 0 or p_end_minute > 1440) then
    errs := errs || 'Indica una hora de inicio y fin válidas'::text;
  end if;
  if p_unit in ('half_day', 'hour') and p_end <> p_start then
    errs := errs || 'Las solicitudes por medio día u horas son de un solo día'::text;
  end if;
  if cardinality(errs) > 0 then
    return query select 0, unit, null::uuid, null::integer, null::tstzrange, errs, warns;
    return;
  end if;

  if not private.employment_covers(p_employee, p_start, p_end) then
    errs := errs || 'Hay días sin contrato vigente o posteriores a la baja'::text;
  end if;

  -- Cantidad según la base de cómputo, los festivos y el turno.
  if p_unit = 'day' then
    select count(*)::integer * 2 into qty from generate_series(p_start, p_end, interval '1 day') d
    where t.count_basis = 'calendar_days' or private.is_working_day(p_employee, d::date);
  elsif t.count_basis = 'calendar_days' or private.is_working_day(p_employee, p_start) then
    qty := case when p_unit = 'half_day' then 1 else p_end_minute - p_start_minute end;
  end if;
  if qty = 0 then
    errs := errs || 'La solicitud no incluye días laborables (festivos, descansos o fuera de tu turno)'::text;
  end if;

  rng := case p_unit
    when 'day' then tstzrange(p_start::timestamp at time zone tz, (p_end + 1)::timestamp at time zone tz, '[)')
    when 'half_day' then case p_half
      when 'morning' then tstzrange(p_start::timestamp at time zone tz, (p_start + time '12:00') at time zone tz, '[)')
      else tstzrange((p_start + time '12:00') at time zone tz, (p_start + 1)::timestamp at time zone tz, '[)') end
    else tstzrange(private.local_to_utc(tz, p_start, p_start_minute), private.local_to_utc(tz, p_start, p_end_minute), '[)')
  end;
  if exists (
    select 1 from public.absence_requests r
    where r.employee_id = p_employee and r.status in ('pending', 'info_requested', 'approved')
      and r.period && rng and r.id is distinct from p_ignore_request
  ) then
    errs := errs || 'Se solapa con otra solicitud tuya pendiente o aprobada'::text;
  end if;

  if t.uses_balance then
    policy := private.policy_for(p_employee, p_type, p_start);
    if policy is null then
      errs := errs || 'No tienes una política asignada para este tipo en esas fechas'::text;
    elsif private.period_start_for(policy, p_start) <> private.period_start_for(policy, p_end) then
      errs := errs || 'La solicitud cruza dos periodos: divídela en dos'::text;
    else
      select * into version from public.vacation_policy_versions
      where id = private.policy_version_at(policy, p_start);
      if version.id is null then
        errs := errs || 'La política no tiene una versión vigente para esas fechas'::text;
      elsif version.unit <> unit then
        errs := errs || case when version.unit = 'minutes' then 'Esta política se solicita por horas'
          else 'Esta política se solicita por días o medios días' end;
      elsif cardinality(errs) = 0 then
        bal := private.ensure_balance(p_employee, policy, p_start);
        avail := private.balance_available(bal);
        if avail - qty < 0 then
          if version.allow_negative and avail - qty >= -version.negative_limit then
            warns := warns || ('El saldo quedará en negativo según la política: ' || version.negative_reason);
          else
            errs := errs || format('Saldo insuficiente: disponible %s, solicitado %s (%s)', avail, qty,
              case when unit = 'half_days' then 'medios días' else 'minutos' end);
          end if;
        end if;
      end if;
    end if;
  end if;

  return query select qty, unit, bal, avail, rng, errs, warns;
end;
$$;

-- Avisos sin el tipo si es reservado.
create or replace function private.absence_work_event(p_request uuid, p_type text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.work_events (company_id, employee_id, event_type, dedupe_key, payload)
  select r.company_id, r.employee_id, p_type, p_type || ':' || r.id || ':' || r.status,
    jsonb_build_object('request_id', r.id, 'status', r.status, 'start_date', r.start_date,
      'type', case when t.is_private then null else t.name end)
  from public.absence_requests r join public.absence_types t on t.id = r.absence_type_id
  where r.id = p_request
  on conflict (employee_id, dedupe_key) do nothing;
$$;

create or replace function private.absence_event(p_request uuid, p_action text, p_message text default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.absence_request_events (company_id, employee_id, request_id, action, message, actor_id)
  select r.company_id, r.employee_id, r.id, p_action, nullif(btrim(p_message), ''), (select auth.uid())
  from public.absence_requests r where r.id = p_request;
$$;

-- -----------------------------------------------------------------------------
-- 7. Funciones públicas: consultar, solicitar y decidir
-- -----------------------------------------------------------------------------

create or replace function private.own_employee(p_company uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id from public.employees e
  where e.company_id = p_company and e.membership_id is not null
    and e.membership_id = private.current_membership_id(p_company);
$$;

-- Simulación antes de enviar: cantidad, saldo y problemas.
create or replace function public.quote_absence_request(
  p_company uuid,
  p_type uuid,
  p_unit public.absence_unit,
  p_start date,
  p_end date,
  p_half text default null,
  p_start_minute integer default null,
  p_end_minute integer default null
)
returns table (amount integer, amount_unit public.balance_unit, available integer, errors text[], warnings text[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  employee uuid := private.own_employee(p_company);
begin
  if employee is null then
    raise exception 'No tienes ficha de empleado en esta empresa' using errcode = 'P0002';
  end if;
  return query select e.amount, e.amount_unit, e.available, e.errors, e.warnings
  from private.evaluate_absence(employee, p_type, p_unit, p_start, p_end, p_half, p_start_minute, p_end_minute) e;
end;
$$;

-- Envía la solicitud: valida, reserva saldo y crea la instancia de aprobación,
-- todo en una transacción. Idempotente por clave.
create or replace function public.submit_absence_request(
  p_company uuid,
  p_type uuid,
  p_unit public.absence_unit,
  p_start date,
  p_end date,
  p_idempotency_key uuid,
  p_half text default null,
  p_start_minute integer default null,
  p_end_minute integer default null,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  employee uuid := private.own_employee(p_company);
  existing public.absence_requests;
  t public.absence_types;
  ev record;
  approver uuid;
  route text;
  request uuid;
begin
  if employee is null then
    raise exception 'No tienes ficha de empleado en esta empresa' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('absence:' || employee, 0));

  select * into existing from public.absence_requests
  where company_id = p_company and employee_id = employee and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    return jsonb_build_object('request_id', existing.id, 'status', existing.status, 'duplicate', true);
  end if;

  select * into ev from private.evaluate_absence(employee, p_type, p_unit, p_start, p_end, p_half,
    p_start_minute, p_end_minute);
  if cardinality(ev.errors) > 0 then
    raise exception '%', array_to_string(ev.errors, '. ') using errcode = 'P0001';
  end if;
  select * into t from public.absence_types where id = p_type;

  if not t.requires_approval then
    route := 'auto_rule';
  else
    approver := private.absence_approver(employee);
    if approver is not null then
      route := case when exists (
        select 1 from private.resolve_approver_internal(employee, 'absences', now()) r
        where r.substitution_id is not null
      ) then 'substitute' else 'manager' end;
    else
      begin
        perform private.resolve_approver_internal(employee, 'absences', now());
        route := 'hr_no_approver';
      exception when others then
        route := case when sqlerrm like 'APROBADOR_AUTOAPROBACION%' then 'hr_self_approval' else 'hr_no_approver' end;
      end;
    end if;
  end if;

  insert into public.absence_requests (company_id, employee_id, absence_type_id, balance_id, unit, start_date,
    end_date, half, start_minute, end_minute, period, amount, amount_unit, status, employee_note, routing,
    idempotency_key, decided_at, created_by)
  values (p_company, employee, p_type, ev.balance_id, p_unit, p_start, p_end,
    case when p_unit = 'half_day' then p_half end,
    case when p_unit = 'hour' then p_start_minute end, case when p_unit = 'hour' then p_end_minute end,
    ev.period, ev.amount, ev.amount_unit,
    case when route = 'auto_rule' then 'approved'::public.absence_request_status else 'pending' end,
    nullif(btrim(p_note), ''), route, p_idempotency_key,
    case when route = 'auto_rule' then now() end, (select auth.uid()))
  returning id into request;

  insert into public.absence_approvals (company_id, employee_id, request_id, approver_user_id, routing, status,
    decided_at)
  values (p_company, employee, request, approver, route,
    case when route = 'auto_rule' then 'decided' else 'pending' end,
    case when route = 'auto_rule' then now() end);

  if ev.balance_id is not null then
    if route = 'auto_rule' then
      perform private.post_movement(ev.balance_id, 'usage', -ev.amount, p_start, 'usage:' || request, request);
    else
      perform private.post_movement(ev.balance_id, 'reservation', -ev.amount, p_start, 'reservation:' || request,
        request);
    end if;
  end if;

  if route = 'auto_rule' then
    perform private.absence_event(request, 'auto_approved', 'Regla de aprobación automática: ' || t.approval_exemption_ref);
    if p_unit = 'day' then
      insert into public.leave_periods (company_id, employee_id, starts_on, ends_on, absence_request_id)
      values (p_company, employee, p_start, p_end, request);
    end if;
  else
    perform private.absence_event(request, 'submitted');
  end if;

  return jsonb_build_object('request_id', request, 'duplicate', false, 'amount', ev.amount,
    'amount_unit', ev.amount_unit, 'routing', route,
    'status', case when route = 'auto_rule' then 'approved' else 'pending' end,
    'warnings', to_jsonb(ev.warnings));
end;
$$;

-- Aprobar, rechazar (con motivo) o pedir información.
create or replace function public.decide_absence_request(p_request uuid, p_decision text, p_message text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.absence_requests;
begin
  select * into r from public.absence_requests where id = p_request;
  if r.id is null or not private.can_decide_absences(r.employee_id) then
    raise exception 'Solicitud no encontrada' using errcode = 'P0002';
  end if;
  -- Las rutas de escalado solo las resuelve RR. HH.
  if r.routing in ('hr_no_approver', 'hr_self_approval')
     and not private.employee_absence_permission(r.employee_id, 'manage') then
    raise exception 'Esta solicitud la resuelve RR. HH.' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject', 'request_info') then
    raise exception 'Decisión no válida' using errcode = '22023';
  end if;

  -- Bloqueo del saldo y de la solicitud: nada cambia a la vez.
  if r.balance_id is not null then
    perform 1 from public.vacation_balances where id = r.balance_id for update;
  end if;
  select * into r from public.absence_requests where id = p_request for update;
  if r.status <> 'pending' then
    raise exception 'La solicitud no está pendiente de decisión' using errcode = 'P0001';
  end if;

  if p_decision = 'request_info' then
    if char_length(btrim(coalesce(p_message, ''))) < 5 then
      raise exception 'Indica qué información necesitas' using errcode = '22023';
    end if;
    update public.absence_requests set status = 'info_requested' where id = r.id;
    perform private.absence_event(r.id, 'info_requested', p_message);
    perform private.absence_work_event(r.id, 'absence_info_requested');
    return;
  end if;

  if p_decision = 'reject' and char_length(btrim(coalesce(p_message, ''))) < 5 then
    raise exception 'Indica el motivo del rechazo' using errcode = '22023';
  end if;

  if r.balance_id is not null then
    perform private.post_movement(r.balance_id, 'reservation_release', r.amount, r.start_date,
      'release:' || r.id, r.id);
    if p_decision = 'approve' then
      perform private.post_movement(r.balance_id, 'usage', -r.amount, r.start_date, 'usage:' || r.id, r.id);
    end if;
  end if;

  update public.absence_requests
  set status = case when p_decision = 'approve' then 'approved'::public.absence_request_status else 'rejected' end,
    decided_at = now(), decided_by = (select auth.uid())
  where id = r.id;
  update public.absence_approvals set status = 'decided', decided_by = (select auth.uid()), decided_at = now()
  where request_id = r.id;

  if p_decision = 'approve' and r.unit = 'day' then
    insert into public.leave_periods (company_id, employee_id, starts_on, ends_on, absence_request_id)
    values (r.company_id, r.employee_id, r.start_date, r.end_date, r.id);
  end if;
  perform private.absence_event(r.id, case when p_decision = 'approve' then 'approved' else 'rejected' end, p_message);
  perform private.absence_work_event(r.id, 'absence_decided');
end;
$$;

-- La persona responde a una petición de información.
create or replace function public.respond_absence_info(p_request uuid, p_message text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if char_length(btrim(coalesce(p_message, ''))) < 2 then
    raise exception 'Escribe tu respuesta' using errcode = '22023';
  end if;
  update public.absence_requests set status = 'pending'
  where id = p_request and status = 'info_requested' and private.is_self_employee(employee_id);
  if not found then
    raise exception 'Solicitud no encontrada o sin información pendiente' using errcode = 'P0002';
  end if;
  perform private.absence_event(p_request, 'info_provided', p_message);
end;
$$;

-- Cancelar (pendiente) o retirar (aprobada que aún no ha empezado).
create or replace function public.cancel_absence_request(p_request uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.absence_requests;
  result text;
begin
  select * into r from public.absence_requests where id = p_request;
  if r.id is null or not (private.is_self_employee(r.employee_id)
     or private.employee_absence_permission(r.employee_id, 'manage')) then
    raise exception 'Solicitud no encontrada' using errcode = 'P0002';
  end if;
  if r.balance_id is not null then
    perform 1 from public.vacation_balances where id = r.balance_id for update;
  end if;
  select * into r from public.absence_requests where id = p_request for update;

  if r.status in ('pending', 'info_requested') then
    if r.balance_id is not null then
      perform private.post_movement(r.balance_id, 'reservation_release', r.amount, r.start_date,
        'release:' || r.id, r.id);
    end if;
    update public.absence_requests set status = 'cancelled' where id = r.id;
    update public.absence_approvals set status = 'closed' where request_id = r.id;
    perform private.absence_event(r.id, 'cancelled');
    result := 'cancelled';
  elsif r.status = 'approved' then
    if r.start_date <= private.employee_today(r.employee_id) then
      raise exception 'Una ausencia ya iniciada no se retira: solicita a RR. HH. un ajuste' using errcode = 'P0001';
    end if;
    if r.balance_id is not null then
      perform private.post_movement(r.balance_id, 'usage_reversal', r.amount, r.start_date,
        'reversal:' || r.id, r.id);
    end if;
    update public.absence_requests set status = 'withdrawn' where id = r.id;
    update public.leave_periods set status = 'cancelled' where absence_request_id = r.id;
    perform private.absence_event(r.id, 'withdrawn');
    result := 'withdrawn';
  else
    raise exception 'La solicitud ya está cerrada' using errcode = 'P0001';
  end if;
  return result;
end;
$$;

-- Justificante: se sube al bucket y se registra aquí.
create or replace function public.add_absence_attachment(p_request uuid, p_path text, p_mime text, p_size integer)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.absence_requests;
  sensitive boolean;
  attachment uuid;
begin
  select * into r from public.absence_requests where id = p_request;
  if r.id is null or not private.is_self_employee(r.employee_id) then
    raise exception 'Solicitud no encontrada' using errcode = 'P0002';
  end if;
  if r.status not in ('pending', 'info_requested', 'approved') then
    raise exception 'La solicitud está cerrada' using errcode = 'P0001';
  end if;
  if p_path !~ ('^' || r.company_id || '/' || r.employee_id || '/' || r.id || '/[0-9a-f-]{36}\.(pdf|jpg|png)$')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'absence-attachments' and o.name = p_path) then
    raise exception 'Archivo no válido' using errcode = '22023';
  end if;
  select t.attachment_sensitive into sensitive from public.absence_types t where t.id = r.absence_type_id;
  insert into public.absence_attachments (company_id, employee_id, request_id, storage_path, mime_type,
    size_bytes, sensitive, uploaded_by)
  values (r.company_id, r.employee_id, r.id, p_path, p_mime, p_size, sensitive, (select auth.uid()))
  returning id into attachment;
  perform private.absence_event(r.id, 'attachment_added');
  return attachment;
end;
$$;

-- Ajuste manual auditado (regularización, corrección de errores).
create or replace function public.adjust_vacation_balance(
  p_employee uuid,
  p_policy uuid,
  p_day date,
  p_amount integer,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  balance uuid;
begin
  if not private.employee_absence_permission(p_employee, 'manage') or private.is_self_employee(p_employee) then
    raise exception 'Empleado no encontrado' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.vacation_policies vp join public.employees e on e.company_id = vp.company_id
    where vp.id = p_policy and e.id = p_employee
  ) then
    raise exception 'Política no encontrada' using errcode = 'P0002';
  end if;
  if p_amount = 0 or char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Indica una cantidad distinta de cero y el motivo del ajuste' using errcode = '22023';
  end if;
  balance := private.ensure_balance(p_employee, p_policy, p_day);
  if (select status from public.vacation_balances where id = balance) = 'closed' then
    raise exception 'El periodo está cerrado: ajusta el periodo vigente' using errcode = 'P0001';
  end if;
  perform private.post_movement(balance, 'adjustment', p_amount, private.employee_today(p_employee),
    'adjustment:' || gen_random_uuid(), null, btrim(p_reason));
end;
$$;

-- Saldos de la propia persona en la fecha indicada (los abre y liquida si hace falta).
create or replace function public.my_vacation_balances(p_company uuid, p_day date default null)
returns table (
  balance_id uuid,
  policy_id uuid,
  policy_name text,
  absence_type_id uuid,
  period_start date,
  period_end date,
  unit public.balance_unit,
  entitled integer,
  carried integer,
  reserved integer,
  used integer,
  adjusted integer,
  expired integer,
  available integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  employee uuid := private.own_employee(p_company);
  day date;
  p record;
begin
  if employee is null then
    return;
  end if;
  day := coalesce(p_day, private.employee_today(employee));
  for p in select distinct vp.id from public.vacation_policies vp
           join public.absence_types t on t.id = vp.absence_type_id and t.uses_balance and t.status = 'active'
           where vp.company_id = p_company and private.policy_for(employee, vp.absence_type_id, day) = vp.id loop
    begin
      perform private.ensure_balance(employee, p.id, day);
    exception when others then
      null; -- política sin versión vigente: no se muestra saldo
    end;
  end loop;
  return query
  select b.id, b.policy_id, vp.name, vp.absence_type_id, b.period_start, b.period_end, b.unit,
    coalesce(sum(m.amount) filter (where m.kind in ('opening', 'accrual')), 0)::integer,
    coalesce(sum(m.amount) filter (where m.kind = 'carryover'), 0)::integer,
    coalesce(-sum(m.amount) filter (where m.kind in ('reservation', 'reservation_release')), 0)::integer,
    coalesce(-sum(m.amount) filter (where m.kind in ('usage', 'usage_reversal')), 0)::integer,
    coalesce(sum(m.amount) filter (where m.kind = 'adjustment'), 0)::integer,
    coalesce(-sum(m.amount) filter (where m.kind = 'expiry'), 0)::integer,
    coalesce(sum(m.amount), 0)::integer
  from public.vacation_balances b
  join public.vacation_policies vp on vp.id = b.policy_id
  left join public.balance_movements m on m.balance_id = b.id
  where b.employee_id = employee and b.period_start <= day and b.period_end > day
  group by b.id, vp.name, vp.absence_type_id;
end;
$$;

-- Calendario con privacidad: la propia persona ve todo lo suyo; manager y
-- RR. HH. ven el tipo (salvo los reservados, que solo RR. HH. con lectura
-- ve); compañeros del mismo equipo solo "Ausente" en ausencias aprobadas.
create or replace function public.absence_calendar(p_company uuid, p_from date, p_to date)
returns table (
  employee_id uuid,
  employee_label text,
  start_date date,
  end_date date,
  unit public.absence_unit,
  half text,
  start_minute integer,
  end_minute integer,
  status public.absence_request_status,
  label text,
  relation text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := private.own_employee(p_company);
  my_team uuid := (select e.team_id from public.employees e where e.id = me);
begin
  if p_to < p_from or p_to - p_from > 62 then
    raise exception 'Rango de fechas no válido (máximo 62 días)' using errcode = '22023';
  end if;
  return query
  select r.employee_id, e.first_name || ' ' || e.last_name, r.start_date, r.end_date, r.unit, r.half,
    r.start_minute, r.end_minute, r.status,
    case
      when r.employee_id = me then t.name
      when private.employee_absence_permission(r.employee_id, 'read') then t.name
      when private.manages_employee(r.employee_id) then case when t.is_private then 'Ausencia' else t.name end
      else 'Ausente'
    end,
    case
      when r.employee_id = me then 'self'
      when private.employee_absence_permission(r.employee_id, 'read') or private.manages_employee(r.employee_id)
        then 'managed'
      else 'peer'
    end
  from public.absence_requests r
  join public.employees e on e.id = r.employee_id
  join public.absence_types t on t.id = r.absence_type_id
  where r.company_id = p_company
    and r.start_date <= p_to and r.end_date >= p_from
    and (
      (r.employee_id = me and r.status in ('pending', 'info_requested', 'approved'))
      or ((private.employee_absence_permission(r.employee_id, 'read') or private.manages_employee(r.employee_id))
          and r.status in ('pending', 'info_requested', 'approved'))
      or (my_team is not null and e.team_id = my_team and r.status = 'approved')
    )
  order by r.start_date, e.last_name;
end;
$$;

create or replace function public.my_absence_access(p_company uuid)
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
  cross join unnest(array['read', 'manage', 'attachments']) as a
  where ra.company_id = p_company
    and ra.membership_id = private.current_membership_id(p_company)
    and ra.status = 'active'
    and private.is_active_window(ra.valid_from, ra.valid_to)
    and private.role_has_absence_permission(ra.role, a);
$$;

-- Publica una versión de política desde hoy o una fecha futura.
create or replace function public.publish_vacation_policy_version(p_version uuid, p_valid_from date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.vacation_policy_versions;
  today date;
begin
  select * into v from public.vacation_policy_versions where id = p_version;
  if v.id is null or not private.has_absence_permission(v.company_id, 'manage') then
    raise exception 'Versión no encontrada' using errcode = 'P0002';
  end if;
  if v.status <> 'draft' then
    raise exception 'Solo se publican borradores' using errcode = 'P0001';
  end if;
  select (now() at time zone c.timezone)::date into today from public.companies c where c.id = v.company_id;
  if p_valid_from < today then
    raise exception 'Una versión se publica con efecto desde hoy o una fecha futura' using errcode = 'P0001',
      hint = 'Los periodos pasados no se recalculan.';
  end if;
  if exists (
    select 1 from public.vacation_policy_versions
    where policy_id = v.policy_id and status = 'published' and valid_from >= p_valid_from
  ) then
    raise exception 'Ya hay una versión publicada que empieza el % o después', p_valid_from using errcode = 'P0001';
  end if;
  update public.vacation_policy_versions set valid_to = p_valid_from
  where policy_id = v.policy_id and status = 'published' and (valid_to is null or valid_to > p_valid_from);
  update public.vacation_policy_versions
  set status = 'published', valid_from = p_valid_from, published_by = (select auth.uid()), published_at = now()
  where id = v.id;
end;
$$;

-- Tarea programada: devengos, caducidades y cierre de periodos. Idempotente.
create or replace function public.settle_vacation_balances()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b record;
  n integer := 0;
begin
  for b in select id, employee_id, policy_id, period_end from public.vacation_balances where status = 'open' loop
    if b.period_end <= private.employee_today(b.employee_id) then
      -- Abrir el siguiente periodo cierra este con su arrastre.
      begin
        perform private.ensure_balance(b.employee_id, b.policy_id, b.period_end);
      exception when others then
        null;
      end;
    else
      perform private.settle_balance(b.id, private.employee_today(b.employee_id));
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Integridad
-- -----------------------------------------------------------------------------

create or replace function private.guard_policy_version()
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
  if old.status = 'published' and (to_jsonb(new) - 'valid_to' - 'updated_at') <> (to_jsonb(old) - 'valid_to' - 'updated_at') then
    raise exception 'Una versión publicada no se modifica: crea una versión nueva' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'published' and pg_trigger_depth() = 1
     and current_user not in ('postgres', 'service_role') then
    raise exception 'Publica con publish_vacation_policy_version' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Asignaciones: nada con efecto en el pasado.
create or replace function private.guard_policy_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  today date := (select (now() at time zone c.timezone)::date from public.companies c where c.id = new.company_id);
begin
  if tg_op = 'INSERT' and new.valid_from < today then
    raise exception 'Una asignación de política empieza hoy o en una fecha futura' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.valid_to is distinct from old.valid_to and (new.valid_to is null or new.valid_to < today) then
    raise exception 'No se puede cerrar una asignación con efecto en el pasado' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status = 'revoked' and old.status = 'active' and old.valid_from < today then
    raise exception 'Una asignación ya iniciada no se revoca: ciérrala desde hoy' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Solicitudes: los datos de la ausencia no cambian; solo su estado y decisión.
create or replace function private.guard_absence_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status' - 'decided_at' - 'decided_by' - 'updated_at')
     <> (to_jsonb(old) - 'status' - 'decided_at' - 'decided_by' - 'updated_at') then
    raise exception 'Los datos de una solicitud no se modifican' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger vacation_policy_versions_guard before update or delete on public.vacation_policy_versions
  for each row execute function private.guard_policy_version();
create trigger policy_assignments_guard before insert or update on public.policy_assignments
  for each row execute function private.guard_policy_assignment();
create trigger absence_requests_guard before update on public.absence_requests
  for each row execute function private.guard_absence_request();
create trigger balance_movements_immutable before update or delete on public.balance_movements
  for each row execute function private.prevent_mutation();
create trigger absence_request_events_immutable before update or delete on public.absence_request_events
  for each row execute function private.prevent_mutation();
create trigger absence_attachments_immutable before update or delete on public.absence_attachments
  for each row execute function private.prevent_mutation();
create trigger absence_requests_no_delete before delete on public.absence_requests
  for each row execute function private.prevent_mutation();
create trigger vacation_balances_no_delete before delete on public.vacation_balances
  for each row execute function private.prevent_mutation();

create trigger absence_types_updated_at before update on public.absence_types
  for each row execute function private.set_updated_at();
create trigger vacation_policies_updated_at before update on public.vacation_policies
  for each row execute function private.set_updated_at();
create trigger vacation_policy_versions_updated_at before update on public.vacation_policy_versions
  for each row execute function private.set_updated_at();
create trigger policy_assignments_updated_at before update on public.policy_assignments
  for each row execute function private.set_updated_at();
create trigger absence_requests_updated_at before update on public.absence_requests
  for each row execute function private.set_updated_at();

create trigger absence_types_keys before update on public.absence_types
  for each row execute function private.prevent_key_change('id', 'company_id', 'code');
create trigger vacation_policies_keys before update on public.vacation_policies
  for each row execute function private.prevent_key_change('id', 'company_id', 'absence_type_id', 'code', 'period_start_month');
create trigger vacation_policy_versions_keys before update on public.vacation_policy_versions
  for each row execute function private.prevent_key_change('id', 'company_id', 'policy_id', 'version');
create trigger policy_assignments_keys before update on public.policy_assignments
  for each row execute function private.prevent_key_change(
    'id', 'company_id', 'policy_id', 'absence_type_id', 'scope_type', 'employee_id', 'team_id', 'work_center_id', 'valid_from'
  );
create trigger vacation_balances_keys before update on public.vacation_balances
  for each row execute function private.prevent_key_change(
    'id', 'company_id', 'employee_id', 'policy_id', 'policy_version_id', 'period_start', 'period_end', 'unit'
  );

-- Auditoría completa de la configuración y de los ajustes manuales. Las
-- solicitudes no van a audit_log (podrían contener datos sensibles en el
-- comentario): su rastro es absence_request_events, sin textos de salud.
create trigger audit_absence_types after insert or update on public.absence_types
  for each row execute function private.audit_row_change('company_id');
create trigger audit_vacation_policies after insert or update on public.vacation_policies
  for each row execute function private.audit_row_change('company_id');
create trigger audit_vacation_policy_versions after insert or update on public.vacation_policy_versions
  for each row execute function private.audit_row_change('company_id');
create trigger audit_policy_assignments after insert or update on public.policy_assignments
  for each row execute function private.audit_row_change('company_id');
create trigger audit_balance_adjustments after insert on public.balance_movements
  for each row when (new.kind = 'adjustment') execute function private.audit_row_change('company_id');

-- -----------------------------------------------------------------------------
-- 9. Storage: justificantes en un bucket separado
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('absence-attachments', 'absence-attachments', false, 5242880,
  array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Ruta: <company_id>/<employee_id>/<request_id>/<uuid>.<ext>
create or replace function private.object_request_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  third_segment text := split_part(object_name, '/', 3);
begin
  if third_segment ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return third_segment::uuid;
  end if;
  return null;
end;
$$;

-- ¿Puede el usuario abrir un justificante? La persona, RR. HH. con permiso de
-- justificantes en su ámbito y, solo si el tipo no es sensible, quien decide.
create or replace function private.can_open_absence_attachment(p_object text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.absence_requests r
    where r.id = private.object_request_id(p_object)
      and r.employee_id = private.object_employee_id(p_object)
      and r.company_id = private.object_company_id(p_object)
      and (
        private.is_self_employee(r.employee_id)
        or private.employee_absence_permission(r.employee_id, 'attachments')
        or (
          not coalesce((select a.sensitive from public.absence_attachments a where a.storage_path = p_object),
            (select t.attachment_sensitive from public.absence_types t where t.id = r.absence_type_id))
          and (private.can_decide_absences(r.employee_id) or private.manages_employee(r.employee_id))
        )
      )
  );
$$;

create policy "absence_attachments_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'absence-attachments' and private.can_open_absence_attachment(name));

create policy "absence_attachments_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'absence-attachments'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png)$'
    and exists (
      select 1 from public.absence_requests r
      where r.id = private.object_request_id(name)
        and r.employee_id = private.object_employee_id(name)
        and r.company_id = private.object_company_id(name)
        and r.status in ('pending', 'info_requested', 'approved')
        and private.is_self_employee(r.employee_id)
    )
  );

-- -----------------------------------------------------------------------------
-- 10. Privilegios
-- -----------------------------------------------------------------------------

revoke all on function
  private.role_has_absence_permission(public.app_role, text),
  private.has_absence_permission(uuid, text, uuid, uuid),
  private.employee_absence_permission(uuid, text),
  private.absence_approver(uuid),
  private.can_read_employee_absences(uuid),
  private.can_decide_absences(uuid),
  private.round_ratio(bigint, bigint, integer, public.rounding_mode),
  private.employee_today(uuid),
  private.is_working_day(uuid, date),
  private.employment_covers(uuid, date, date),
  private.employed_days(uuid, date, date),
  private.policy_for(uuid, uuid, date),
  private.policy_version_at(uuid, date),
  private.period_start_for(uuid, date),
  private.balance_available(uuid),
  private.post_movement(uuid, public.balance_movement_kind, integer, date, text, uuid, text, date),
  private.settle_balance(uuid, date),
  private.ensure_balance(uuid, uuid, date),
  private.evaluate_absence(uuid, uuid, public.absence_unit, date, date, text, integer, integer, uuid),
  private.absence_work_event(uuid, text),
  private.absence_event(uuid, text, text),
  private.own_employee(uuid),
  private.object_request_id(text),
  private.can_open_absence_attachment(text),
  private.guard_policy_version(),
  private.guard_policy_assignment(),
  private.guard_absence_request()
from public;

grant execute on function
  private.role_has_absence_permission(public.app_role, text),
  private.has_absence_permission(uuid, text, uuid, uuid),
  private.employee_absence_permission(uuid, text),
  private.absence_approver(uuid),
  private.can_read_employee_absences(uuid),
  private.can_decide_absences(uuid),
  private.object_request_id(text),
  private.can_open_absence_attachment(text)
to authenticated, service_role;

revoke all on function
  public.quote_absence_request(uuid, uuid, public.absence_unit, date, date, text, integer, integer),
  public.submit_absence_request(uuid, uuid, public.absence_unit, date, date, uuid, text, integer, integer, text),
  public.decide_absence_request(uuid, text, text),
  public.respond_absence_info(uuid, text),
  public.cancel_absence_request(uuid),
  public.add_absence_attachment(uuid, text, text, integer),
  public.adjust_vacation_balance(uuid, uuid, date, integer, text),
  public.my_vacation_balances(uuid, date),
  public.absence_calendar(uuid, date, date),
  public.my_absence_access(uuid),
  public.publish_vacation_policy_version(uuid, date),
  public.settle_vacation_balances()
from public, anon, authenticated;

grant execute on function
  public.quote_absence_request(uuid, uuid, public.absence_unit, date, date, text, integer, integer),
  public.submit_absence_request(uuid, uuid, public.absence_unit, date, date, uuid, text, integer, integer, text),
  public.decide_absence_request(uuid, text, text),
  public.respond_absence_info(uuid, text),
  public.cancel_absence_request(uuid),
  public.add_absence_attachment(uuid, text, text, integer),
  public.adjust_vacation_balance(uuid, uuid, date, integer, text),
  public.my_vacation_balances(uuid, date),
  public.absence_calendar(uuid, date, date),
  public.my_absence_access(uuid),
  public.publish_vacation_policy_version(uuid, date)
to authenticated, service_role;

-- Tarea programada: solo con la clave de servicio.
grant execute on function public.settle_vacation_balances() to service_role;

revoke all on public.absence_types, public.vacation_policies, public.vacation_policy_versions,
  public.policy_assignments, public.vacation_balances, public.balance_movements, public.absence_requests,
  public.absence_approvals, public.absence_request_events, public.absence_attachments
from anon, authenticated;

grant select on public.absence_types, public.vacation_policies, public.vacation_policy_versions,
  public.policy_assignments, public.vacation_balances, public.balance_movements, public.absence_requests,
  public.absence_approvals, public.absence_request_events, public.absence_attachments
to authenticated;

-- Configuración: escritura directa con RLS (gestión de ausencias, ámbito empresa).
grant insert (company_id, code, name, allowed_units, count_basis, uses_balance, requires_approval,
  approval_exemption_ref, requires_attachment, attachment_sensitive, is_private, max_past_days, legal_reference)
  on public.absence_types to authenticated;
grant update (name, allowed_units, count_basis, uses_balance, requires_approval, approval_exemption_ref,
  requires_attachment, attachment_sensitive, is_private, max_past_days, legal_reference, status)
  on public.absence_types to authenticated;
grant insert (company_id, absence_type_id, code, name, period_start_month) on public.vacation_policies to authenticated;
grant update (name, status) on public.vacation_policies to authenticated;
grant insert (company_id, policy_id, version, unit, entitlement, accrual_method, proration, rounding_mode,
  rounding_step, carryover_max, carryover_expiry_months, allow_negative, negative_limit, negative_reason, created_by)
  on public.vacation_policy_versions to authenticated;
grant update (unit, entitlement, accrual_method, proration, rounding_mode, rounding_step, carryover_max,
  carryover_expiry_months, allow_negative, negative_limit, negative_reason)
  on public.vacation_policy_versions to authenticated;
grant insert (company_id, policy_id, absence_type_id, scope_type, employee_id, team_id, work_center_id,
  valid_from, valid_to, created_by) on public.policy_assignments to authenticated;
grant update (valid_to, status) on public.policy_assignments to authenticated;
-- Saldos, movimientos, solicitudes, aprobaciones, eventos y adjuntos: solo mediante funciones.

-- -----------------------------------------------------------------------------
-- 11. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.absence_types enable row level security;
alter table public.vacation_policies enable row level security;
alter table public.vacation_policy_versions enable row level security;
alter table public.policy_assignments enable row level security;
alter table public.vacation_balances enable row level security;
alter table public.balance_movements enable row level security;
alter table public.absence_requests enable row level security;
alter table public.absence_approvals enable row level security;
alter table public.absence_request_events enable row level security;
alter table public.absence_attachments enable row level security;

create policy "absence_types_select" on public.absence_types
  for select to authenticated
  using (private.is_company_member(company_id) or private.has_absence_permission(company_id, 'read')
    or private.manages_in_company(company_id));
create policy "absence_types_insert" on public.absence_types
  for insert to authenticated with check (private.has_absence_permission(company_id, 'manage'));
create policy "absence_types_update" on public.absence_types
  for update to authenticated
  using (private.has_absence_permission(company_id, 'manage'))
  with check (private.has_absence_permission(company_id, 'manage'));

create policy "vacation_policies_select" on public.vacation_policies
  for select to authenticated
  using (private.is_company_member(company_id) or private.has_absence_permission(company_id, 'read')
    or private.manages_in_company(company_id));
create policy "vacation_policies_insert" on public.vacation_policies
  for insert to authenticated with check (private.has_absence_permission(company_id, 'manage'));
create policy "vacation_policies_update" on public.vacation_policies
  for update to authenticated
  using (private.has_absence_permission(company_id, 'manage'))
  with check (private.has_absence_permission(company_id, 'manage'));

create policy "vacation_policy_versions_select" on public.vacation_policy_versions
  for select to authenticated
  using (private.has_absence_permission(company_id, 'manage')
    or (status = 'published' and (private.is_company_member(company_id)
      or private.has_absence_permission(company_id, 'read') or private.manages_in_company(company_id))));
create policy "vacation_policy_versions_insert" on public.vacation_policy_versions
  for insert to authenticated
  with check (private.has_absence_permission(company_id, 'manage') and status = 'draft');
create policy "vacation_policy_versions_update" on public.vacation_policy_versions
  for update to authenticated
  using (private.has_absence_permission(company_id, 'manage') and status = 'draft')
  with check (private.has_absence_permission(company_id, 'manage'));

create policy "policy_assignments_select" on public.policy_assignments
  for select to authenticated
  using (private.has_absence_permission(company_id, 'read')
    or (employee_id is not null and private.can_read_employee_absences(employee_id)));
create policy "policy_assignments_insert" on public.policy_assignments
  for insert to authenticated with check (private.has_absence_permission(company_id, 'manage'));
create policy "policy_assignments_update" on public.policy_assignments
  for update to authenticated
  using (private.has_absence_permission(company_id, 'manage'))
  with check (private.has_absence_permission(company_id, 'manage'));

create policy "vacation_balances_select" on public.vacation_balances
  for select to authenticated using (private.can_read_employee_absences(employee_id));
create policy "balance_movements_select" on public.balance_movements
  for select to authenticated using (private.can_read_employee_absences(employee_id));
create policy "absence_requests_select" on public.absence_requests
  for select to authenticated
  using (private.can_read_employee_absences(employee_id) or private.can_decide_absences(employee_id));
create policy "absence_approvals_select" on public.absence_approvals
  for select to authenticated
  using (private.can_read_employee_absences(employee_id) or private.can_decide_absences(employee_id));
create policy "absence_request_events_select" on public.absence_request_events
  for select to authenticated
  using (private.can_read_employee_absences(employee_id) or private.can_decide_absences(employee_id));
-- Los metadatos del justificante (que existe, tipo y tamaño) los ven las partes;
-- abrir el archivo depende de la política de Storage.
create policy "absence_attachments_select" on public.absence_attachments
  for select to authenticated
  using (private.can_read_employee_absences(employee_id) or private.can_decide_absences(employee_id));
