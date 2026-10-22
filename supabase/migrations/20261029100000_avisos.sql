-- =============================================================================
-- Avisos: bandeja interna, correo y trabajos programados.
--
-- Flujo (docs/AVISOS.md):
--   evento de dominio --(trigger, misma transacción)--> notification_outbox
--   tarea programada --> process_notification_outbox --> notifications + email_deliveries
--   tarea programada --> claim_email_deliveries --> proveedor --> complete_email_delivery
--   webhook firmado del proveedor --> record_email_event (deduplicado por id externo)
--
-- Principios:
--  - La operación principal solo escribe una fila en el outbox: nada se envía
--    dentro de su transacción y un fallo del correo no la afecta.
--  - Idempotencia por evento, destinatario y canal: un evento no produce dos
--    avisos ni dos correos.
--  - Contenido mínimo: los parámetros de las plantillas son empresa, fecha,
--    periodo o un recuento; nunca tipos de ausencia, motivos, importes,
--    coordenadas ni imágenes. No se guardan cuerpos de correo.
--  - Los enlaces llevan solo el id del aviso: abrirlo exige sesión y se vuelve a
--    comprobar el permiso sobre el objeto en ese momento.
--
-- Reversión: supabase/rollbacks/20261029100000_avisos.down.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catálogo de eventos
-- -----------------------------------------------------------------------------

-- Los obligatorios (operativos o legales) no admiten preferencia de correo.
create or replace function private.notification_event_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['absence_submitted', 'absence_decided', 'absence_info_requested', 'absence_info_provided',
    'absence_cancelled', 'expense_step_pending', 'expense_report_returned', 'expense_report_approved',
    'expense_report_settled', 'time_missing_start', 'time_open_entry', 'time_incident',
    'time_correction_decided', 'shift_changed', 'approval_overdue'];
$$;

create or replace function private.notification_event_mandatory(p_event text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_event in ('absence_submitted', 'absence_info_requested', 'expense_step_pending',
    'expense_report_returned', 'time_missing_start', 'time_open_entry', 'shift_changed', 'approval_overdue');
$$;

-- Recordatorios: como mucho 3 correos de este tipo por persona en 24 horas.
create or replace function private.notification_event_is_reminder(p_event text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_event in ('time_missing_start', 'time_open_entry', 'approval_overdue');
$$;

-- -----------------------------------------------------------------------------
-- 2. Tablas
-- -----------------------------------------------------------------------------

create table public.notification_outbox (
  id              bigint generated always as identity primary key,
  company_id      uuid not null references public.companies (id) on delete restrict,
  event_type      text not null check (event_type = any (private.notification_event_types())),
  entity_type     text not null check (entity_type in ('absence_request', 'expense_report', 'work_day',
    'schedule', 'approvals')),
  entity_id       uuid,
  employee_id     uuid,
  -- Origen único (p. ej. "absence_event:123"): el mismo evento no entra dos veces.
  source_key      text not null unique check (char_length(source_key) between 3 and 200),
  -- Solo ids, fechas y recuentos.
  payload         jsonb not null default '{}' check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 1024),
  occurred_at     timestamptz not null default now(),
  status          text not null default 'pending' check (status in ('pending', 'processed', 'failed')),
  attempts        integer not null default 0 check (attempts between 0 and 10),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z_]{1,40}$'),
  processed_at    timestamptz,
  unique (id, company_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);
create index notification_outbox_pending_idx on public.notification_outbox (id) where status = 'pending';

create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  recipient_user_id uuid not null references public.profiles (id) on delete restrict,
  outbox_id         bigint not null,
  event_type        text not null check (event_type = any (private.notification_event_types())),
  template_version  integer not null default 1 check (template_version >= 1),
  params            jsonb not null default '{}' check (jsonb_typeof(params) = 'object' and pg_column_size(params) <= 1024),
  -- Ruta interna de la aplicación (sin dominio ni parámetros).
  link_path         text not null check (link_path ~ '^/[a-z0-9/_-]*$' and char_length(link_path) <= 200),
  entity_type       text not null,
  entity_id         uuid,
  employee_id       uuid,
  mandatory         boolean not null,
  idempotency_key   text not null unique,
  read_at           timestamptz,
  created_at        timestamptz not null default now(),
  unique (id, company_id),
  foreign key (outbox_id, company_id) references public.notification_outbox (id, company_id)
);
create index notifications_recipient_idx on public.notifications (recipient_user_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_user_id) where read_at is null;

-- Preferencias de correo para avisos no obligatorios (la bandeja siempre los recibe).
create table public.notification_preferences (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  user_id    uuid not null references public.profiles (id) on delete restrict,
  event_type text not null check (event_type = any (private.notification_event_types())),
  channel    text not null default 'email' check (channel in ('email')),
  enabled    boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id, event_type, channel),
  constraint notification_preferences_optional check (not private.notification_event_mandatory(event_type))
);

create table public.email_deliveries (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  notification_id   uuid not null,
  recipient_user_id uuid not null references public.profiles (id) on delete restrict,
  event_type        text not null,
  template_version  integer not null,
  idempotency_key   text not null unique,
  status            text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'delivered',
    'bounced', 'complained', 'failed', 'suppressed', 'skipped')),
  attempts          integer not null default 0 check (attempts >= 0),
  max_attempts      integer not null default 5 check (max_attempts between 1 and 10),
  manual_retries    integer not null default 0 check (manual_retries between 0 and 3),
  next_attempt_at   timestamptz not null default now(),
  locked_at         timestamptz,
  provider          text check (provider is null or provider ~ '^[a-z0-9_-]{1,40}$'),
  external_id       text check (external_id is null or char_length(external_id) <= 200),
  last_error_code   text check (last_error_code is null or last_error_code ~ '^[a-z_]{1,40}$'),
  sent_at           timestamptz,
  delivered_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (provider, external_id),
  unique (id, company_id),
  foreign key (notification_id, company_id) references public.notifications (id, company_id)
);
create index email_deliveries_due_idx on public.email_deliveries (next_attempt_at) where status in ('pending', 'sending');
create index email_deliveries_recipient_idx on public.email_deliveries (recipient_user_id, created_at desc);

create table public.email_delivery_events (
  id                bigint generated always as identity primary key,
  company_id        uuid not null references public.companies (id) on delete restrict,
  delivery_id       uuid not null,
  provider          text not null check (provider ~ '^[a-z0-9_-]{1,40}$'),
  external_event_id text not null check (char_length(external_event_id) between 1 and 200),
  event_type        text not null check (event_type in ('delivered', 'bounced', 'complained', 'deferred')),
  occurred_at       timestamptz not null,
  received_at       timestamptz not null default now(),
  unique (provider, external_event_id),
  foreign key (delivery_id, company_id) references public.email_deliveries (id, company_id)
);

-- Registro de ejecuciones de tareas programadas (global, fuera del API).
create table private.scheduled_job_runs (
  id          bigint generated always as identity primary key,
  job         text not null check (job ~ '^[a-z_]{1,40}$'),
  started_at  timestamptz not null,
  finished_at timestamptz not null default now(),
  ok          boolean not null,
  counts      jsonb not null default '{}' check (jsonb_typeof(counts) = 'object' and pg_column_size(counts) <= 1024),
  error_code  text check (error_code is null or error_code ~ '^[a-z_]{1,40}$')
);

-- -----------------------------------------------------------------------------
-- 3. Eventos de dominio -> outbox (misma transacción, sin enviar nada)
-- -----------------------------------------------------------------------------

create or replace function private.enqueue_notification(
  p_company uuid,
  p_event text,
  p_entity_type text,
  p_entity uuid,
  p_employee uuid,
  p_source text,
  p_payload jsonb default '{}'
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with ins as (
    insert into public.notification_outbox (company_id, event_type, entity_type, entity_id, employee_id, source_key, payload)
    values (p_company, p_event, p_entity_type, p_entity, p_employee, p_source, coalesce(p_payload, '{}'))
    on conflict (source_key) do nothing
    returning 1
  )
  select exists (select 1 from ins);
$$;

create or replace function private.notify_from_absence_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event text := case new.action
    when 'submitted' then 'absence_submitted'
    when 'approved' then 'absence_decided'
    when 'rejected' then 'absence_decided'
    when 'info_requested' then 'absence_info_requested'
    when 'info_provided' then 'absence_info_provided'
    when 'cancelled' then 'absence_cancelled'
    when 'withdrawn' then 'absence_cancelled'
  end;
begin
  if event is not null then
    perform private.enqueue_notification(new.company_id, event, 'absence_request', new.request_id, new.employee_id,
      'absence_event:' || new.id);
  end if;
  return null;
end;
$$;

create or replace function private.notify_from_approval_step()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    perform private.enqueue_notification(new.company_id, 'expense_step_pending', 'expense_report',
      (select ai.report_id from public.approval_instances ai where ai.id = new.instance_id), new.employee_id,
      'expense_step:' || new.id || ':pending', jsonb_build_object('step_id', new.id));
  end if;
  return null;
end;
$$;

create or replace function private.notify_from_expense_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event text := case new.status
    when 'returned' then 'expense_report_returned'
    when 'approved' then 'expense_report_approved'
    when 'included_in_batch' then 'expense_report_settled'
  end;
begin
  if event is not null and new.status is distinct from old.status then
    perform private.enqueue_notification(new.company_id, event, 'expense_report', new.id, new.employee_id,
      'expense_report:' || new.id || ':' || new.status, jsonb_build_object('period', to_char(new.period_month, 'YYYY-MM')));
  end if;
  return null;
end;
$$;

create or replace function private.notify_from_work_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event text := case new.event_type
    when 'reminder_missing_start' then 'time_missing_start'
    when 'reminder_open_entry' then 'time_open_entry'
    when 'incident_detected' then 'time_incident'
    when 'correction_decided' then 'time_correction_decided'
  end;
begin
  if event is not null then
    perform private.enqueue_notification(new.company_id, event, 'work_day', null, new.employee_id,
      'work_event:' || new.id,
      case when new.payload ? 'work_date' then jsonb_build_object('work_date', new.payload ->> 'work_date') else '{}' end);
  end if;
  return null;
end;
$$;

create or replace function private.notify_from_schedule_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type in ('shift_assignment_published', 'shift_assignment_changed') then
    perform private.enqueue_notification(new.company_id, 'shift_changed', 'schedule', null, new.employee_id,
      'schedule_event:' || new.id);
  end if;
  return null;
end;
$$;

create trigger notify_absence_request_events after insert on public.absence_request_events
  for each row execute function private.notify_from_absence_event();
create trigger notify_approval_steps after insert or update of status on public.approval_steps
  for each row execute function private.notify_from_approval_step();
create trigger notify_expense_reports after update of status on public.expense_reports
  for each row execute function private.notify_from_expense_report();
create trigger notify_work_events after insert on public.work_events
  for each row execute function private.notify_from_work_event();
create trigger notify_schedule_events after insert on public.schedule_events
  for each row execute function private.notify_from_schedule_event();

-- -----------------------------------------------------------------------------
-- 4. Destinatarios y contenido mínimo
-- -----------------------------------------------------------------------------

create or replace function private.user_is_current_member(p_user uuid, p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_memberships m
    where m.user_id = p_user and m.company_id = p_company and m.status = 'active'
      and private.is_active_window(m.valid_from, m.valid_to)
  );
$$;

-- Usuarios con un rol vigente en la empresa cuyo ámbito cubre a la persona.
create or replace function private.users_with_role_over(p_employee uuid, p_roles public.app_role[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct m.user_id
  from public.employees e
  join public.role_assignments ra on ra.company_id = e.company_id
  join public.company_memberships m on m.id = ra.membership_id
  where e.id = p_employee and ra.role = any (p_roles) and ra.status = 'active'
    and private.is_active_window(ra.valid_from, ra.valid_to)
    and (ra.scope_type = 'company' or (ra.scope_type = 'work_center' and ra.work_center_id = e.work_center_id)
      or (ra.scope_type = 'team' and ra.team_id = e.team_id));
$$;

create or replace function private.outbox_recipients(p_outbox bigint)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.notification_outbox;
  approver uuid;
  s public.approval_steps;
begin
  select * into o from public.notification_outbox where id = p_outbox;
  if o.event_type in ('absence_submitted', 'absence_info_provided', 'absence_cancelled') then
    select a.approver_user_id into approver from public.absence_approvals a where a.request_id = o.entity_id;
    if approver is not null then
      return query select approver;
    else
      return query select * from private.users_with_role_over(o.employee_id, array['hr', 'company_admin']::public.app_role[]);
    end if;
  elsif o.event_type = 'expense_step_pending' then
    select * into s from public.approval_steps where id = (o.payload ->> 'step_id')::uuid;
    if s.assigned_user_id is not null then
      return query select s.assigned_user_id;
    elsif s.assigned_role is not null then
      return query select * from private.users_with_role_over(o.employee_id, array[s.assigned_role]);
    end if;
  elsif o.event_type = 'approval_overdue' then
    return query select (o.payload ->> 'user_id')::uuid;
  elsif o.employee_id is not null then
    return query select private.employee_user(o.employee_id);
  end if;
end;
$$;

create or replace function private.outbox_link(o public.notification_outbox)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when o.event_type in ('absence_submitted', 'absence_info_provided', 'absence_cancelled') then '/ausencias/bandeja'
    when o.event_type in ('absence_decided', 'absence_info_requested') then '/ausencias'
    when o.event_type like 'expense_%' then '/gastos/informes/' || o.entity_id
    when o.event_type = 'time_correction_decided' then '/fichajes/historial'
    when o.event_type like 'time_%' then '/fichajes'
    when o.event_type = 'shift_changed' then '/horario'
    when o.event_type = 'approval_overdue' and o.payload ->> 'kind' = 'expenses' then '/gastos/bandeja'
    else '/ausencias/bandeja'
  end;
$$;

-- Parámetros de las plantillas: empresa, fecha local y, según el evento, periodo,
-- día de trabajo o recuento. Nada más.
create or replace function private.outbox_params(o public.notification_outbox)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'company', c.name,
    'date', to_char(o.occurred_at at time zone c.timezone, 'YYYY-MM-DD'),
    'period', o.payload ->> 'period',
    'work_date', o.payload ->> 'work_date',
    'count', (o.payload ->> 'count')::integer,
    'outcome', case when o.event_type = 'absence_decided' then (
      select e.action from public.absence_request_events e
      where o.source_key = 'absence_event:' || e.id) end
  ))
  from public.companies c where c.id = o.company_id;
$$;

-- -----------------------------------------------------------------------------
-- 5. Proceso del outbox (tarea programada, solo service_role)
-- -----------------------------------------------------------------------------

create or replace function public.process_notification_outbox(p_limit integer default 200)
returns table (processed integer, notifications integer, deliveries integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  o public.notification_outbox;
  recipient uuid;
  notification uuid;
  mandatory boolean;
  n_processed integer := 0;
  n_notifications integer := 0;
  n_deliveries integer := 0;
  n integer;
  email_status text;
begin
  for o in
    select * from public.notification_outbox where status = 'pending'
    order by id limit greatest(1, least(p_limit, 1000)) for update skip locked
  loop
    begin
      mandatory := private.notification_event_mandatory(o.event_type);
      for recipient in select distinct r from private.outbox_recipients(o.id) as r where r is not null loop
        -- Solo destinatarios con membresía vigente; nunca la persona que actuó sobre lo suyo.
        continue when not private.user_is_current_member(recipient, o.company_id);
        continue when o.event_type in ('expense_step_pending', 'absence_submitted', 'approval_overdue')
          and recipient = private.employee_user(o.employee_id);
        insert into public.notifications (company_id, recipient_user_id, outbox_id, event_type, params, link_path,
          entity_type, entity_id, employee_id, mandatory, idempotency_key)
        values (o.company_id, recipient, o.id, o.event_type, private.outbox_params(o), private.outbox_link(o),
          o.entity_type, o.entity_id, o.employee_id, mandatory, o.id || ':' || recipient || ':in_app')
        on conflict (idempotency_key) do nothing
        returning id into notification;
        get diagnostics n = row_count;
        n_notifications := n_notifications + n;
        if notification is null then
          select id into notification from public.notifications where idempotency_key = o.id || ':' || recipient || ':in_app';
        end if;

        email_status := 'pending';
        if not mandatory and exists (select 1 from public.notification_preferences p
            where p.company_id = o.company_id and p.user_id = recipient and p.event_type = o.event_type
              and p.channel = 'email' and not p.enabled) then
          email_status := null;
        elsif private.notification_event_is_reminder(o.event_type) and (
            select count(*) from public.email_deliveries d
            where d.recipient_user_id = recipient and d.created_at > now() - interval '24 hours'
              and private.notification_event_is_reminder(d.event_type) and d.status <> 'skipped') >= 3 then
          email_status := 'skipped';
        end if;
        if email_status is not null then
          insert into public.email_deliveries (company_id, notification_id, recipient_user_id, event_type,
            template_version, idempotency_key, status, last_error_code)
          values (o.company_id, notification, recipient, o.event_type, 1, o.id || ':' || recipient || ':email',
            email_status, case when email_status = 'skipped' then 'frequency_limit' end)
          on conflict (idempotency_key) do nothing;
          get diagnostics n = row_count;
          n_deliveries := n_deliveries + n;
        end if;
      end loop;
      update public.notification_outbox set status = 'processed', processed_at = now(), attempts = attempts + 1
      where id = o.id;
      n_processed := n_processed + 1;
    exception when others then
      update public.notification_outbox
      set attempts = attempts + 1, last_error_code = 'processing_error',
          status = case when attempts + 1 >= 5 then 'failed' else 'pending' end
      where id = o.id;
    end;
  end loop;
  return query select n_processed, n_notifications, n_deliveries;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Envío de correo (tarea programada, solo service_role)
-- -----------------------------------------------------------------------------

-- Toma entregas pendientes y vencidas (o bloqueadas hace más de 10 minutos).
-- Las de personas con un rebote o queja en los últimos 30 días se suprimen.
create or replace function public.claim_email_deliveries(p_limit integer default 50)
returns table (delivery_id uuid, to_email text, event_type text, template_version integer, params jsonb,
  notification_id uuid, idempotency_key text, attempt integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d public.email_deliveries;
  email text;
begin
  for d in
    select * from public.email_deliveries ed
    where (ed.status = 'pending' and ed.next_attempt_at <= now())
       or (ed.status = 'sending' and ed.locked_at < now() - interval '10 minutes')
    order by ed.next_attempt_at limit greatest(1, least(p_limit, 500)) for update skip locked
  loop
    if exists (select 1 from public.email_deliveries o where o.recipient_user_id = d.recipient_user_id
               and o.status in ('bounced', 'complained') and o.updated_at > now() - interval '30 days') then
      update public.email_deliveries set status = 'suppressed', last_error_code = 'recent_bounce', locked_at = null
      where id = d.id;
      continue;
    end if;
    select u.email into email from auth.users u where u.id = d.recipient_user_id;
    if email is null then
      update public.email_deliveries set status = 'failed', last_error_code = 'no_address', locked_at = null
      where id = d.id;
      continue;
    end if;
    update public.email_deliveries set status = 'sending', attempts = d.attempts + 1, locked_at = now() where id = d.id;
    return query select d.id, email, d.event_type, d.template_version, n.params, d.notification_id,
      d.idempotency_key, d.attempts + 1
    from public.notifications n where n.id = d.notification_id;
  end loop;
end;
$$;

-- Resultado del envío. Un fallo temporal vuelve a la cola con espera creciente
-- (1, 2, 4, 8… minutos) hasta max_attempts; después queda 'failed' (dead-letter).
create or replace function public.complete_email_delivery(
  p_delivery uuid,
  p_status text,
  p_provider text default null,
  p_external_id text default null,
  p_error_code text default null,
  p_retryable boolean default false
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d public.email_deliveries;
  result text;
begin
  select * into d from public.email_deliveries where id = p_delivery for update;
  if d.id is null then
    raise exception 'Entrega no encontrada' using errcode = 'P0002';
  end if;
  if d.status <> 'sending' then
    return d.status;
  end if;
  if p_status = 'sent' then
    result := 'sent';
    update public.email_deliveries set status = 'sent', sent_at = now(), provider = p_provider,
      external_id = p_external_id, last_error_code = null, locked_at = null where id = d.id;
  elsif p_status = 'skipped' then
    result := 'skipped';
    update public.email_deliveries set status = 'skipped', last_error_code = coalesce(p_error_code, 'skipped'),
      locked_at = null where id = d.id;
  elsif p_status = 'failed' then
    if coalesce(p_error_code, '') !~ '^[a-z_]{1,40}$' then
      raise exception 'Código de error no válido' using errcode = '22023';
    end if;
    result := case when p_retryable and d.attempts < d.max_attempts then 'pending' else 'failed' end;
    update public.email_deliveries
    set status = result, last_error_code = p_error_code, locked_at = null, provider = p_provider,
        next_attempt_at = case when result = 'pending'
          then now() + make_interval(mins => power(2, d.attempts - 1)::integer) else d.next_attempt_at end
    where id = d.id;
  else
    raise exception 'Estado no válido' using errcode = '22023';
  end if;
  return result;
end;
$$;

-- Evento del webhook (firma ya verificada). Deduplicado por id externo.
create or replace function public.record_email_event(
  p_provider text,
  p_event_id text,
  p_external_id text,
  p_event text,
  p_occurred_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d public.email_deliveries;
  n integer;
begin
  select * into d from public.email_deliveries where provider = p_provider and external_id = p_external_id for update;
  if d.id is null then
    return false;
  end if;
  insert into public.email_delivery_events (company_id, delivery_id, provider, external_event_id, event_type, occurred_at)
  values (d.company_id, d.id, p_provider, p_event_id, p_event, coalesce(p_occurred_at, now()))
  on conflict (provider, external_event_id) do nothing;
  get diagnostics n = row_count;
  if n = 0 then
    return false;
  end if;
  if p_event = 'delivered' and d.status = 'sent' then
    update public.email_deliveries set status = 'delivered', delivered_at = coalesce(p_occurred_at, now()) where id = d.id;
  elsif p_event in ('bounced', 'complained') then
    update public.email_deliveries set status = p_event, last_error_code = p_event where id = d.id;
  end if;
  return true;
end;
$$;

-- Soporte: reintentar a mano una entrega fallida (hasta 3 veces).
create or replace function public.retry_email_delivery(p_delivery uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d public.email_deliveries;
begin
  select * into d from public.email_deliveries where id = p_delivery for update;
  if d.id is null or not private.has_permission(d.company_id, 'org.manage') then
    raise exception 'Entrega no encontrada' using errcode = 'P0002';
  end if;
  if d.status <> 'failed' then
    raise exception 'Solo se reintentan entregas fallidas' using errcode = 'P0001';
  end if;
  if d.manual_retries >= 3 then
    raise exception 'Ya no quedan reintentos manuales para esta entrega' using errcode = 'P0001';
  end if;
  update public.email_deliveries set status = 'pending', attempts = 0, manual_retries = d.manual_retries + 1,
    next_attempt_at = now(), last_error_code = null where id = d.id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Bandeja: abrir un aviso comprueba el permiso actual sobre el objeto
-- -----------------------------------------------------------------------------

create or replace function private.notification_target_allowed(p_notification uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case n.entity_type
      when 'absence_request' then exists (
        select 1 from public.absence_requests r where r.id = n.entity_id
          and (private.can_read_employee_absences(r.employee_id) or private.can_decide_absences(r.employee_id)))
      when 'expense_report' then private.can_view_report(n.entity_id)
      when 'work_day' then n.employee_id is not null and private.is_self_employee(n.employee_id)
      when 'schedule' then n.employee_id is not null and private.is_self_employee(n.employee_id)
      else private.is_company_member(n.company_id)
    end
    from public.notifications n
    where n.id = p_notification and n.recipient_user_id = (select auth.uid())
      and private.is_company_member(n.company_id)
  ), false);
$$;

create or replace function public.open_notification(p_notification uuid)
returns table (allowed boolean, link_path text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n public.notifications;
begin
  select * into n from public.notifications
  where id = p_notification and recipient_user_id = (select auth.uid());
  if n.id is null or not private.is_company_member(n.company_id) then
    raise exception 'Aviso no encontrado' using errcode = 'P0002';
  end if;
  update public.notifications set read_at = now() where id = n.id and read_at is null;
  return query select private.notification_target_allowed(n.id), n.link_path;
end;
$$;

create or replace function public.mark_notifications_read(p_company uuid, p_ids uuid[] default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.notifications set read_at = now()
  where company_id = p_company and recipient_user_id = (select auth.uid()) and read_at is null
    and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Resumen para la consola de soporte (sin contenido): recuentos por estado.
create or replace function public.notification_support_summary(p_company uuid)
returns table (kind text, status text, total bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_company, 'audit.read') then
    raise exception 'No tienes permiso' using errcode = '42501';
  end if;
  return query
    select 'outbox', o.status, count(*) from public.notification_outbox o where o.company_id = p_company group by o.status
    union all
    select 'email', d.status, count(*) from public.email_deliveries d where d.company_id = p_company group by d.status
    order by 1, 2;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Recordatorios programados (solo service_role)
-- -----------------------------------------------------------------------------

-- Fichajes olvidados y jornadas abiertas (zona horaria del centro y horario
-- planificado, ver generate_time_reminders) y aprobaciones vencidas: un aviso
-- por aprobador y día, solo en día laborable y entre las 9:00 y las 18:00 de la
-- zona de la empresa.
create or replace function public.run_scheduled_reminders(p_now timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  created integer;
  r record;
  local_ts timestamp;
  approver_employee uuid;
  plan_status text;
begin
  created := public.generate_time_reminders(p_now);

  for r in
    select x.company_id, x.approver, x.kind, count(*) as pending, c.timezone
    from (
      select a.company_id, a.approver_user_id as approver, 'absences' as kind
      from public.absence_approvals a
      join public.absence_requests q on q.id = a.request_id
      where q.status = 'pending' and a.approver_user_id is not null and q.submitted_at < p_now - interval '48 hours'
      union all
      select s.company_id, s.assigned_user_id, 'expenses'
      from public.approval_steps s
      join public.approval_instances ai on ai.id = s.instance_id
      where s.status = 'pending' and ai.status = 'active' and s.assigned_user_id is not null
        and ai.created_at < p_now - interval '72 hours'
    ) x
    join public.companies c on c.id = x.company_id
    group by x.company_id, x.approver, x.kind, c.timezone
  loop
    local_ts := p_now at time zone r.timezone;
    continue when extract(hour from local_ts) < 9 or extract(hour from local_ts) >= 18;
    approver_employee := null;
    plan_status := null;
    select e.id into approver_employee from public.employees e
    join public.company_memberships m on m.id = e.membership_id
    where m.user_id = r.approver and e.company_id = r.company_id limit 1;
    -- Su horario planificado si lo tiene (descanso, festivo o ausencia: no se avisa);
    -- sin contrato ni horario, de lunes a viernes.
    select p.status into plan_status from private.planned_shift(approver_employee, local_ts::date) p
    where approver_employee is not null;
    continue when plan_status in ('rest', 'holiday', 'absence')
      or (coalesce(plan_status, 'unassigned') <> 'work' and extract(isodow from local_ts) > 5);
    if private.enqueue_notification(r.company_id, 'approval_overdue', 'approvals', null, null,
         'overdue:' || r.kind || ':' || r.approver || ':' || local_ts::date,
         jsonb_build_object('user_id', r.approver, 'kind', r.kind, 'count', r.pending)) then
      created := created + 1;
    end if;
  end loop;
  return created;
end;
$$;

create or replace function public.record_job_run(p_job text, p_started_at timestamptz, p_ok boolean,
  p_counts jsonb default '{}', p_error_code text default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.scheduled_job_runs (job, started_at, ok, counts, error_code)
  values (p_job, p_started_at, p_ok, coalesce(p_counts, '{}'), p_error_code);
$$;

-- Últimas ejecuciones (administración de plataforma).
create or replace function public.recent_job_runs(p_limit integer default 50)
returns table (job text, started_at timestamptz, finished_at timestamptz, ok boolean, counts jsonb, error_code text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_global_admin() then
    raise exception 'No tienes permiso' using errcode = '42501';
  end if;
  return query select r.job, r.started_at, r.finished_at, r.ok, r.counts, r.error_code
    from private.scheduled_job_runs r order by r.id desc limit greatest(1, least(p_limit, 500));
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Integridad
-- -----------------------------------------------------------------------------

-- De un aviso solo cambia read_at (una vez).
create or replace function private.guard_notification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at')
     or (old.read_at is not null and new.read_at is distinct from old.read_at) then
    raise exception 'Un aviso no se modifica' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger notifications_guard before update on public.notifications
  for each row execute function private.guard_notification();
create trigger notifications_no_delete before delete on public.notifications
  for each row execute function private.prevent_mutation();
create trigger notification_outbox_no_delete before delete on public.notification_outbox
  for each row execute function private.prevent_mutation();
create trigger email_deliveries_no_delete before delete on public.email_deliveries
  for each row execute function private.prevent_mutation();
create trigger email_delivery_events_immutable before update or delete on public.email_delivery_events
  for each row execute function private.prevent_mutation();
create trigger notification_preferences_no_delete before delete on public.notification_preferences
  for each row execute function private.prevent_mutation();

create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function private.set_updated_at();
create trigger email_deliveries_updated_at before update on public.email_deliveries
  for each row execute function private.set_updated_at();

create trigger notification_outbox_keys before update on public.notification_outbox
  for each row execute function private.prevent_key_change('id', 'company_id', 'event_type', 'entity_type',
    'entity_id', 'employee_id', 'source_key', 'payload');
create trigger notification_preferences_keys before update on public.notification_preferences
  for each row execute function private.prevent_key_change('id', 'company_id', 'user_id', 'event_type', 'channel');
create trigger email_deliveries_keys before update on public.email_deliveries
  for each row execute function private.prevent_key_change('id', 'company_id', 'notification_id',
    'recipient_user_id', 'event_type', 'idempotency_key');

create trigger audit_notification_preferences after insert or update on public.notification_preferences
  for each row execute function private.audit_row_change('company_id');

-- -----------------------------------------------------------------------------
-- 10. Privilegios
-- -----------------------------------------------------------------------------

revoke all on function
  private.notification_event_types(),
  private.notification_event_mandatory(text),
  private.notification_event_is_reminder(text),
  private.enqueue_notification(uuid, text, text, uuid, uuid, text, jsonb),
  private.notify_from_absence_event(),
  private.notify_from_approval_step(),
  private.notify_from_expense_report(),
  private.notify_from_work_event(),
  private.notify_from_schedule_event(),
  private.user_is_current_member(uuid, uuid),
  private.users_with_role_over(uuid, public.app_role[]),
  private.outbox_recipients(bigint),
  private.outbox_link(public.notification_outbox),
  private.outbox_params(public.notification_outbox),
  private.notification_target_allowed(uuid),
  private.guard_notification()
from public;

-- Los CHECK de las tablas llaman al catálogo con el rol que inserta.
grant execute on function
  private.notification_event_types(),
  private.notification_event_mandatory(text),
  private.notification_target_allowed(uuid)
to authenticated, service_role;

revoke all on function
  public.process_notification_outbox(integer),
  public.claim_email_deliveries(integer),
  public.complete_email_delivery(uuid, text, text, text, text, boolean),
  public.record_email_event(text, text, text, text, timestamptz),
  public.retry_email_delivery(uuid),
  public.open_notification(uuid),
  public.mark_notifications_read(uuid, uuid[]),
  public.notification_support_summary(uuid),
  public.run_scheduled_reminders(timestamptz),
  public.record_job_run(text, timestamptz, boolean, jsonb, text),
  public.recent_job_runs(integer)
from public, anon, authenticated;

-- Tareas programadas y webhook: solo con la clave de servicio (ADR-048).
grant execute on function
  public.process_notification_outbox(integer),
  public.claim_email_deliveries(integer),
  public.complete_email_delivery(uuid, text, text, text, text, boolean),
  public.record_email_event(text, text, text, text, timestamptz),
  public.run_scheduled_reminders(timestamptz),
  public.record_job_run(text, timestamptz, boolean, jsonb, text)
to service_role;

grant execute on function
  public.retry_email_delivery(uuid),
  public.open_notification(uuid),
  public.mark_notifications_read(uuid, uuid[]),
  public.notification_support_summary(uuid),
  public.recent_job_runs(integer)
to authenticated, service_role;

revoke all on public.notification_outbox, public.notifications, public.notification_preferences,
  public.email_deliveries, public.email_delivery_events
from anon, authenticated;
revoke all on private.scheduled_job_runs from public, anon, authenticated;

grant select on public.notifications, public.notification_preferences, public.email_deliveries,
  public.email_delivery_events
to authenticated;
grant insert (company_id, user_id, event_type, channel, enabled) on public.notification_preferences to authenticated;
grant update (enabled) on public.notification_preferences to authenticated;
-- El outbox no es visible para los usuarios; avisos y entregas solo cambian mediante funciones.

-- -----------------------------------------------------------------------------
-- 11. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.notification_outbox enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.email_deliveries enable row level security;
alter table public.email_delivery_events enable row level security;

-- Cada persona ve solo sus avisos de empresas en las que sigue siendo miembro.
create policy "notifications_select" on public.notifications
  for select to authenticated
  using (recipient_user_id = (select auth.uid()) and private.is_company_member(company_id));

create policy "notification_preferences_select" on public.notification_preferences
  for select to authenticated
  using (user_id = (select auth.uid()) and private.is_company_member(company_id));
create policy "notification_preferences_insert" on public.notification_preferences
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_company_member(company_id));
create policy "notification_preferences_update" on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid()) and private.is_company_member(company_id))
  with check (user_id = (select auth.uid()) and private.is_company_member(company_id));

-- Consola de soporte: estado de las entregas, sin contenido.
create policy "email_deliveries_select" on public.email_deliveries
  for select to authenticated using (private.has_permission(company_id, 'audit.read'));
create policy "email_delivery_events_select" on public.email_delivery_events
  for select to authenticated using (private.has_permission(company_id, 'audit.read'));
