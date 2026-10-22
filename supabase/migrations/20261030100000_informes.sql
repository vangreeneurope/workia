-- =============================================================================
-- Informes, exportaciones y auditoría consultable.
--
-- Principios (docs/INFORMES.md):
--  - Las funciones de informe son SECURITY INVOKER: las filas que suman o
--    listan son las que RLS deja ver al usuario. Nunca saltan permisos y una
--    métrica de otra empresa siempre da cero filas.
--  - Paginación obligatoria (máximo 500 filas por página) y rango de fechas
--    limitado (92 días; 366 en saldos y cierres). Las agregaciones se hacen en
--    la base de datos, nunca en el navegador.
--  - Exportaciones asíncronas generadas con la sesión del solicitante (RLS),
--    guardadas en un bucket privado con huella SHA-256 y caducidad de 7 días;
--    solicitud y cada descarga quedan registradas.
--  - audit_events es append-only: actor, empresa, acción, objeto, request_id,
--    fecha y cambios mínimos (sin textos libres ni datos personales).
--
-- Reversión: supabase/rollbacks/20261030100000_informes.down.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Auditoría: request_id, acciones nuevas y eventos de estado
-- -----------------------------------------------------------------------------

-- request_id de la petición (cabecera x-request-id que añade el servidor).
create or replace function private.current_request_id()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  rid text;
begin
  rid := nullif(current_setting('request.headers', true), '')::json ->> 'x-request-id';
  return case when rid ~ '^[A-Za-z0-9-]{8,64}$' then rid end;
exception when others then
  return null;
end;
$$;

alter table public.audit_events add column request_id text default private.current_request_id()
  check (request_id is null or request_id ~ '^[A-Za-z0-9-]{8,64}$');
alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (action in (
  'create', 'update', 'deactivate', 'reactivate', 'terminate', 'export', 'import', 'publish',
  'status_change', 'request_export', 'download'
));

create index audit_events_actor_idx on public.audit_events (company_id, actor_id, occurred_at desc);
create index audit_events_entity_time_idx on public.audit_events (company_id, entity, occurred_at desc);

-- Evento mínimo de estado: alta o cambio de estado, sin el resto de la fila
-- (los comentarios y motivos pueden contener datos sensibles).
create or replace function private.audit_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  grp uuid;
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) ->> 'status') is not distinct from (to_jsonb(old) ->> 'status') then
    return null;
  end if;
  select c.group_id into grp from public.companies c where c.id = new.company_id;
  insert into public.audit_events (actor_id, company_id, group_id, entity, entity_id, action, changed_fields,
    before, after)
  values ((select auth.uid()), new.company_id, grp, tg_table_name, new.id::text,
    case when tg_op = 'INSERT' then 'create' else 'status_change' end,
    case when to_jsonb(new) ? 'status' then array['status'] else '{}' end,
    case when tg_op = 'UPDATE' then jsonb_build_object('status', to_jsonb(old) -> 'status') end,
    case when to_jsonb(new) ? 'status' then jsonb_build_object('status', to_jsonb(new) -> 'status') end);
  return null;
end;
$$;

create trigger audit_events_absence_requests after insert or update of status on public.absence_requests
  for each row execute function private.audit_status_event();
create trigger audit_events_expense_reports after insert or update of status on public.expense_reports
  for each row execute function private.audit_status_event();
create trigger audit_events_accounting_batches after insert or update of status on public.accounting_batches
  for each row execute function private.audit_status_event();
create trigger audit_events_time_adjustments after insert on public.time_adjustments
  for each row execute function private.audit_status_event();
create trigger audit_events_time_correction_requests after insert or update of status on public.time_correction_requests
  for each row execute function private.audit_status_event();

-- -----------------------------------------------------------------------------
-- 2. Índices para los informes (medidos en supabase/tests/99_rendimiento.test.sql)
-- -----------------------------------------------------------------------------

create index expenses_company_date_idx on public.expenses (company_id, expense_date);
create index absence_requests_company_start_idx on public.absence_requests (company_id, start_date);
create index time_adjustments_company_idx on public.time_adjustments (company_id, created_at);
create index accounting_batches_company_period_idx on public.accounting_batches (company_id, period_month);

-- -----------------------------------------------------------------------------
-- 3. Utilidades
-- -----------------------------------------------------------------------------

-- Valida rango y paginación de un informe (lanza con mensaje claro).
create or replace function private.report_check(p_from date, p_to date, p_limit integer, p_offset integer,
  p_max_days integer default 92)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Indica un periodo válido' using errcode = '22023';
  end if;
  if p_to - p_from > p_max_days then
    raise exception 'El periodo máximo es de % días', p_max_days using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 500 or p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'Paginación no válida' using errcode = '22023';
  end if;
end;
$$;

-- Ampliación de la minimización: textos libres, proveedores y ubicación
-- tampoco llegan a audit_events.
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
                   'tax_id', 'reason', 'address_line', 'employee_note', 'notes', 'note', 'comment',
                   'message', 'decision_note', 'resolution_note', 'merchant_name', 'merchant_tax_id',
                   'document_number', 'latitude', 'longitude', 'selfie_path', 'employee_name')
        and value <> 'null'::jsonb then to_jsonb('[dato personal]'::text)
      else value
    end
  ), '{}'::jsonb)
  from jsonb_each(p_data);
$$;

-- -----------------------------------------------------------------------------
-- 4. Informes
--
-- Las tablas base aplican su RLS fila a fila con funciones de permiso por
-- persona (can_read_employee_time…). Medido con volumen sintético
-- (99_rendimiento): 6 200 jornadas tardan ~15 s y 40 000 eventos de auditoría
-- ~28 s, porque el mismo predicado se recalcula en cada fila. Por eso los
-- informes de volumen son SECURITY DEFINER y aplican EXACTAMENTE el mismo
-- predicado que la política de cada tabla, pero una vez por persona
-- (report_scope) o una vez por empresa (auditoría). 96_informes comprueba, rol
-- a rol, que devuelven lo mismo que RLS deja ver directamente (ADR-050).
-- Aprobaciones y cierres (volumen bajo) siguen siendo SECURITY INVOKER.
-- -----------------------------------------------------------------------------

-- Personas de la empresa cuyo dato de ese dominio puede ver el usuario actual
-- (mismo predicado que la política RLS de la tabla del dominio) y si puede ver
-- su nombre (mismo predicado que la política de employees).
--   time      -> time_entries, punches, time_adjustments, time_incidents
--   absences  -> absence_requests
--   balances  -> vacation_balances, balance_movements
--   expenses  -> expenses
create or replace function private.report_scope(p_company uuid, p_domain text)
returns table (employee_id uuid, named boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Atajo: un permiso con ámbito de empresa cubre a todas las personas.
  whole_company boolean := case p_domain
    when 'time' then private.has_time_permission(p_company, 'read')
    when 'absences' then private.has_absence_permission(p_company, 'read')
    when 'balances' then private.has_absence_permission(p_company, 'read')
    when 'expenses' then private.has_expense_permission(p_company, 'read')
  end;
  all_named boolean := private.has_permission(p_company, 'employees.read');
begin
  if whole_company is null or (select auth.uid()) is null then
    return;
  end if;
  return query
  select e.id,
    all_named or private.is_self_employee(e.id)
      or private.has_permission(p_company, 'employees.read', e.work_center_id, e.team_id)
      or private.manages_employee(e.id)
  from public.employees e
  where e.company_id = p_company
    and (whole_company or case p_domain
      when 'time' then private.can_read_employee_time(e.id)
      when 'absences' then private.can_read_employee_absences(e.id) or private.can_decide_absences(e.id)
      when 'balances' then private.can_read_employee_absences(e.id)
      when 'expenses' then private.can_read_employee_expenses(e.id)
    end);
end;
$$;

-- Jornada diaria y diferencia con el turno planificado (presencia real =
-- trabajo + pausas; presencia planificada = del inicio al fin del turno).
create or replace function public.report_time_daily(
  p_company uuid, p_from date, p_to date,
  p_employee uuid default null, p_team uuid default null, p_center uuid default null,
  p_limit integer default 100, p_offset integer default 0
)
returns table (work_date date, employee_id uuid, employee_code text, employee_name text, status text,
  started_at timestamptz, ended_at timestamptz, worked_seconds integer, break_seconds integer,
  planned_status text, planned_seconds integer, difference_seconds integer, adjustments integer,
  open_incidents integer, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.report_check(p_from, p_to, p_limit, p_offset);
  return query
  with scope as (select * from private.report_scope(p_company, 'time')),
  page as (
    select t.id, t.work_date, t.employee_id, t.status::text as status, t.started_at, t.ended_at,
      t.worked_seconds, t.break_seconds, s.named, count(*) over () as total_count
    from public.time_entries t
    join scope s on s.employee_id = t.employee_id
    join public.employees e on e.id = t.employee_id
    where t.company_id = p_company and t.work_date between p_from and p_to
      and (p_employee is null or t.employee_id = p_employee)
      and (p_team is null or e.team_id = p_team)
      and (p_center is null or e.work_center_id = p_center)
    order by t.work_date desc, e.employee_code, t.id
    limit p_limit offset p_offset
  )
  select p.work_date, p.employee_id, case when p.named then e.employee_code end,
    case when p.named then e.last_name || ', ' || e.first_name else 'Persona' end, p.status,
    p.started_at, p.ended_at, p.worked_seconds, p.break_seconds, pl.status, pl.seconds,
    case when pl.seconds is null then null else p.worked_seconds + p.break_seconds - pl.seconds end,
    (select count(*)::integer from public.time_adjustments a where a.time_entry_id = p.id),
    (select count(*)::integer from public.time_incidents i where i.time_entry_id = p.id and i.status = 'open'),
    p.total_count
  from page p
  join public.employees e on e.id = p.employee_id
  left join lateral (
    select ps.status,
      case when ps.status = 'work' and ps.starts_at is not null and ps.ends_at is not null
        then extract(epoch from ps.ends_at - ps.starts_at)::integer else 0 end as seconds
    from private.planned_shift(p.employee_id, p.work_date) ps limit 1
  ) pl on true
  order by p.work_date desc, e.employee_code, p.id;
end;
$$;

-- Horas y descansos por persona en el periodo.
create or replace function public.report_time_summary(
  p_company uuid, p_from date, p_to date,
  p_employee uuid default null, p_team uuid default null, p_center uuid default null,
  p_limit integer default 100, p_offset integer default 0
)
returns table (employee_id uuid, employee_code text, employee_name text, days integer, worked_seconds bigint,
  break_seconds bigint, incomplete_days integer, adjustments integer, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.report_check(p_from, p_to, p_limit, p_offset);
  return query
  with scope as (select * from private.report_scope(p_company, 'time'))
  select t.employee_id, case when s.named then e.employee_code end,
    case when s.named then e.last_name || ', ' || e.first_name else 'Persona' end, count(*)::integer,
    sum(t.worked_seconds)::bigint, sum(t.break_seconds)::bigint,
    count(*) filter (where t.status = 'incomplete')::integer,
    coalesce(sum(adj.n), 0)::integer,
    count(*) over ()
  from public.time_entries t
  join scope s on s.employee_id = t.employee_id
  join public.employees e on e.id = t.employee_id
  left join (select a.time_entry_id, count(*) as n from public.time_adjustments a
    where a.company_id = p_company group by a.time_entry_id) adj on adj.time_entry_id = t.id
  where t.company_id = p_company and t.work_date between p_from and p_to
    and (p_employee is null or t.employee_id = p_employee)
    and (p_team is null or e.team_id = p_team)
    and (p_center is null or e.work_center_id = p_center)
  group by t.employee_id, s.named, e.employee_code, e.last_name, e.first_name
  order by e.employee_code, t.employee_id
  limit p_limit offset p_offset;
end;
$$;

-- Registro horario: inicio, fin, pausas y ajustes con su trazabilidad. Sin
-- ubicación, selfies ni motivos libres.
create or replace function public.report_time_register(
  p_company uuid, p_from date, p_to date,
  p_employee uuid default null, p_team uuid default null, p_center uuid default null,
  p_limit integer default 100, p_offset integer default 0
)
returns table (work_date date, employee_id uuid, employee_code text, employee_name text, time_zone text,
  status text, started_at timestamptz, ended_at timestamptz, worked_seconds integer, break_seconds integer,
  punches jsonb, adjustments jsonb, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.report_check(p_from, p_to, p_limit, p_offset);
  return query
  with scope as (select * from private.report_scope(p_company, 'time')),
  page as (
    select t.id, t.work_date, t.employee_id, t.time_zone, t.status, t.started_at, t.ended_at,
      t.worked_seconds, t.break_seconds, s.named, count(*) over () as total_count
    from public.time_entries t
    join scope s on s.employee_id = t.employee_id
    join public.employees e on e.id = t.employee_id
    where t.company_id = p_company and t.work_date between p_from and p_to
      and (p_employee is null or t.employee_id = p_employee)
      and (p_team is null or e.team_id = p_team)
      and (p_center is null or e.work_center_id = p_center)
    order by t.work_date desc, e.employee_code, t.id
    limit p_limit offset p_offset
  )
  select p.work_date, p.employee_id, case when p.named then e.employee_code end,
    case when p.named then e.last_name || ', ' || e.first_name else 'Persona' end, p.time_zone,
    p.status::text, p.started_at, p.ended_at, p.worked_seconds, p.break_seconds,
    coalesce((select jsonb_agg(jsonb_build_object('kind', pu.kind, 'at', pu.server_at, 'source', pu.source,
        'device_at', pu.device_at, 'id', pu.id) order by pu.server_at)
      from public.punches pu where pu.time_entry_id = p.id), '[]'),
    coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'kind', a.kind, 'effective_at', a.effective_at,
        'punch_id', a.punch_id, 'approved_at', a.created_at, 'requested_by', a.requested_by,
        'decided_by', a.decided_by) order by a.created_at)
      from public.time_adjustments a where a.time_entry_id = p.id), '[]'),
    p.total_count
  from page p
  join public.employees e on e.id = p.employee_id
  order by p.work_date desc, e.employee_code, p.id;
end;
$$;

-- Saldos del periodo que contiene p_day, a partir del libro (misma fórmula que
-- my_vacation_balances).
create or replace function public.report_absence_balances(
  p_company uuid, p_day date,
  p_employee uuid default null, p_team uuid default null, p_center uuid default null,
  p_limit integer default 100, p_offset integer default 0
)
returns table (employee_id uuid, employee_code text, employee_name text, policy_name text, unit text,
  period_start date, period_end date, entitled bigint, carried bigint, used bigint, reserved bigint,
  adjusted bigint, expired bigint, available bigint, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.report_check(p_day, p_day, p_limit, p_offset);
  return query
  with scope as (select * from private.report_scope(p_company, 'balances'))
  select b.employee_id, case when s.named then e.employee_code end,
    case when s.named then e.last_name || ', ' || e.first_name else 'Persona' end, vp.name, b.unit::text,
    b.period_start, b.period_end,
    coalesce(sum(m.amount) filter (where m.kind in ('opening', 'accrual')), 0)::bigint,
    coalesce(sum(m.amount) filter (where m.kind = 'carryover'), 0)::bigint,
    coalesce(-sum(m.amount) filter (where m.kind in ('usage', 'usage_reversal')), 0)::bigint,
    coalesce(-sum(m.amount) filter (where m.kind in ('reservation', 'reservation_release')), 0)::bigint,
    coalesce(sum(m.amount) filter (where m.kind = 'adjustment'), 0)::bigint,
    coalesce(-sum(m.amount) filter (where m.kind = 'expiry'), 0)::bigint,
    coalesce(sum(m.amount), 0)::bigint,
    count(*) over ()
  from public.vacation_balances b
  join scope s on s.employee_id = b.employee_id
  join public.vacation_policies vp on vp.id = b.policy_id
  join public.employees e on e.id = b.employee_id
  left join public.balance_movements m on m.balance_id = b.id
  where b.company_id = p_company and p_day >= b.period_start and p_day < b.period_end
    and (p_employee is null or b.employee_id = p_employee)
    and (p_team is null or e.team_id = p_team)
    and (p_center is null or e.work_center_id = p_center)
  group by b.id, b.employee_id, s.named, e.employee_code, e.last_name, e.first_name, vp.name, b.unit,
    b.period_start, b.period_end
  order by e.employee_code, vp.name, b.id
  limit p_limit offset p_offset;
end;
$$;

-- Solicitudes de ausencia. Los tipos reservados (p. ej., de salud) se muestran
-- como "Ausencia (reservada)": ningún informe general expone el tipo.
create or replace function public.report_absence_requests(
  p_company uuid, p_from date, p_to date,
  p_employee uuid default null, p_team uuid default null, p_center uuid default null,
  p_limit integer default 100, p_offset integer default 0
)
returns table (request_id uuid, employee_id uuid, employee_code text, employee_name text, type_label text,
  start_date date, end_date date, amount integer, amount_unit text, status text, submitted_at timestamptz,
  decided_at timestamptz, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.report_check(p_from, p_to, p_limit, p_offset);
  return query
  with scope as (select * from private.report_scope(p_company, 'absences'))
  select r.id, r.employee_id, case when s.named then e.employee_code end,
    case when s.named then e.last_name || ', ' || e.first_name else 'Persona' end,
    case when t.is_private then 'Ausencia (reservada)' else t.name end,
    r.start_date, r.end_date, r.amount, r.amount_unit::text, r.status::text, r.submitted_at, r.decided_at,
    count(*) over ()
  from public.absence_requests r
  join scope s on s.employee_id = r.employee_id
  join public.absence_types t on t.id = r.absence_type_id
  join public.employees e on e.id = r.employee_id
  where r.company_id = p_company and r.start_date <= p_to and r.end_date >= p_from
    and (p_employee is null or r.employee_id = p_employee)
    and (p_team is null or e.team_id = p_team)
    and (p_center is null or e.work_center_id = p_center)
  order by r.start_date desc, e.employee_code, r.id
  limit p_limit offset p_offset;
end;
$$;

-- Gastos confirmados agrupados (por persona, categoría, proyecto, cliente,
-- centro de coste o mes) y por moneda. Sin proveedores ni notas.
create or replace function public.report_expenses(
  p_company uuid, p_from date, p_to date, p_group text,
  p_employee uuid default null, p_team uuid default null, p_center uuid default null,
  p_client text default null, p_project text default null,
  p_limit integer default 100, p_offset integer default 0
)
returns table (group_key text, group_label text, currency text, expenses bigint, base_cents bigint,
  tax_cents bigint, total_cents bigint, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.report_check(p_from, p_to, p_limit, p_offset, 366);
  if p_group is null or p_group not in ('employee', 'category', 'project', 'client', 'cost_center', 'month') then
    raise exception 'Agrupación no válida' using errcode = '22023';
  end if;
  return query
  with scope as (select * from private.report_scope(p_company, 'expenses'))
  select g.k, g.l, x.currency, count(*)::bigint, sum(coalesce(x.base_cents, 0))::bigint,
    sum(coalesce(x.tax_cents, 0))::bigint, sum(x.total_cents)::bigint, count(*) over ()
  from public.expenses x
  join scope s on s.employee_id = x.employee_id
  join public.employees e on e.id = x.employee_id
  left join public.expense_categories c on c.id = x.category_id
  cross join lateral (select
    case p_group
      when 'employee' then x.employee_id::text
      when 'category' then coalesce(c.code, '')
      when 'project' then coalesce(x.project_code, '')
      when 'client' then coalesce(x.client_name, '')
      when 'cost_center' then coalesce(x.cost_center, '')
      else to_char(x.expense_date, 'YYYY-MM')
    end as k,
    case p_group
      when 'employee' then case when s.named then e.employee_code || ' · ' || e.last_name || ', ' || e.first_name
        else 'Persona' end
      when 'category' then coalesce(c.name, 'Sin categoría')
      when 'project' then coalesce(x.project_code, 'Sin proyecto')
      when 'client' then coalesce(x.client_name, 'Sin cliente')
      when 'cost_center' then coalesce(x.cost_center, 'Sin centro de coste')
      else to_char(x.expense_date, 'YYYY-MM')
    end as l) g
  where x.company_id = p_company and x.status = 'ready' and x.expense_date between p_from and p_to
    and (p_employee is null or x.employee_id = p_employee)
    and (p_team is null or e.team_id = p_team)
    and (p_center is null or e.work_center_id = p_center)
    and (p_client is null or x.client_name ilike '%' || replace(replace(replace(p_client, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    and (p_project is null or x.project_code = p_project)
  group by g.k, g.l, x.currency
  order by g.k, x.currency
  limit p_limit offset p_offset;
end;
$$;

-- Aprobaciones: pendientes, decididas y tiempo medio de decisión (horas).
create or replace function public.report_approvals(p_company uuid, p_from date, p_to date)
returns table (kind text, pending bigint, overdue bigint, decided bigint, avg_hours numeric)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.report_check(p_from, p_to, 1, 0, 366);
  return query
  select 'absences', count(*) filter (where r.status in ('pending', 'info_requested')),
    count(*) filter (where r.status = 'pending' and r.submitted_at < now() - interval '48 hours'),
    count(*) filter (where r.decided_at is not null),
    round(avg(extract(epoch from r.decided_at - r.submitted_at) / 3600) filter (where r.decided_at is not null), 1)
  from public.absence_requests r
  where r.company_id = p_company and r.submitted_at >= p_from and r.submitted_at < p_to + 1
  union all
  select 'expense_reports', count(*) filter (where r.status in ('submitted', 'in_review')),
    count(*) filter (where r.status in ('submitted', 'in_review') and r.submitted_at < now() - interval '72 hours'),
    count(*) filter (where r.decided_at is not null),
    round(avg(extract(epoch from r.decided_at - r.submitted_at) / 3600) filter (where r.decided_at is not null), 1)
  from public.expense_reports r
  where r.company_id = p_company and r.submitted_at >= p_from and r.submitted_at < p_to + 1
  union all
  select 'time_corrections', count(*) filter (where c.status = 'pending'),
    count(*) filter (where c.status = 'pending' and c.created_at < now() - interval '48 hours'),
    count(*) filter (where c.decided_at is not null),
    round(avg(extract(epoch from c.decided_at - c.created_at) / 3600) filter (where c.decided_at is not null), 1)
  from public.time_correction_requests c
  where c.company_id = p_company and c.created_at >= p_from and c.created_at < p_to + 1;
end;
$$;

-- Cierres contables del periodo con sus totales por moneda.
create or replace function public.report_closures(p_company uuid, p_from date, p_to date)
returns table (batch_id uuid, sequence integer, kind text, period_month date, status text, closed_at timestamptz,
  currency text, lines bigint, total_cents bigint)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform private.report_check(p_from, p_to, 1, 0, 366);
  return query
  select b.id, b.sequence, b.kind::text, b.period_month, b.status, b.closed_at, l.currency, count(l.id),
    coalesce(sum(l.total_cents), 0)::bigint
  from public.accounting_batches b
  left join public.accounting_batch_lines l on l.batch_id = b.id
  where b.company_id = p_company and b.period_month between date_trunc('month', p_from)::date and p_to
  group by b.id, b.sequence, b.kind, b.period_month, b.status, b.closed_at, l.currency
  order by b.sequence, l.currency;
end;
$$;

-- Auditoría consultable: mismo predicado que la política de audit_events
-- (audit.read en la empresa), comprobado una vez y no por fila.
create or replace function public.report_audit(
  p_company uuid, p_from date, p_to date,
  p_actor uuid default null, p_entity text default null, p_entity_id text default null, p_action text default null,
  p_limit integer default 50, p_offset integer default 0
)
returns table (id bigint, occurred_at timestamptz, actor_id uuid, entity text, entity_id text, action text,
  changed_fields text[], before jsonb, after jsonb, request_id text, total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.report_check(p_from, p_to, p_limit, p_offset, 366);
  if (select auth.uid()) is null or not private.has_permission(p_company, 'audit.read') then
    return;
  end if;
  return query
  select a.id, a.occurred_at, a.actor_id, a.entity, a.entity_id, a.action, a.changed_fields, a.before, a.after,
    a.request_id, count(*) over ()
  from public.audit_events a
  where a.company_id = p_company and a.occurred_at >= p_from and a.occurred_at < p_to + 1
    and (p_actor is null or a.actor_id = p_actor)
    and (p_entity is null or a.entity = p_entity)
    and (p_entity_id is null or a.entity_id = p_entity_id)
    and (p_action is null or a.action = p_action)
  order by a.occurred_at desc, a.id desc
  limit p_limit offset p_offset;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Exportaciones asíncronas
-- -----------------------------------------------------------------------------

create table public.report_exports (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  requested_by    uuid not null references public.profiles (id) on delete restrict,
  report_key      text not null check (report_key in ('time_daily', 'time_summary', 'time_register',
    'absence_balances', 'absence_requests', 'expenses', 'approvals', 'closures', 'audit')),
  format          text not null check (format in ('csv', 'xlsx', 'pdf')),
  -- Filtros validados (fechas, ids, agrupación): nunca texto libre sensible.
  filters         jsonb not null check (jsonb_typeof(filters) = 'object' and pg_column_size(filters) <= 1024),
  idempotency_key uuid not null,
  status          text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'failed', 'expired')),
  row_count       integer check (row_count is null or row_count >= 0),
  file_name       text check (file_name is null or file_name ~ '^[a-z0-9._-]{1,120}$'),
  storage_path    text unique,
  sha256          text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes      bigint check (size_bytes is null or size_bytes > 0),
  error_code      text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  request_id      text default private.current_request_id(),
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  unique (company_id, requested_by, idempotency_key),
  unique (id, company_id),
  constraint report_exports_ready check (status <> 'ready' or (storage_path is not null and sha256 is not null
    and expires_at is not null))
);
create index report_exports_requester_idx on public.report_exports (requested_by, created_at desc);
create index report_exports_expiry_idx on public.report_exports (status, expires_at);

create table public.report_export_downloads (
  id            bigint generated always as identity primary key,
  company_id    uuid not null references public.companies (id) on delete restrict,
  export_id     uuid not null,
  downloaded_by uuid not null references public.profiles (id) on delete restrict,
  request_id    text default private.current_request_id(),
  downloaded_at timestamptz not null default now(),
  foreign key (export_id, company_id) references public.report_exports (id, company_id)
);
create index report_export_downloads_export_idx on public.report_export_downloads (export_id);

create or replace function private.report_export_event(p_export uuid, p_action text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.audit_events (actor_id, company_id, group_id, entity, entity_id, action, changed_fields, after)
  select (select auth.uid()), x.company_id, c.group_id, 'report_exports', x.id::text, p_action,
    array['report_key', 'format'], jsonb_build_object('report_key', x.report_key, 'format', x.format,
      'filters', (select coalesce(jsonb_agg(k order by k), '[]') from jsonb_object_keys(x.filters) k))
  from public.report_exports x join public.companies c on c.id = x.company_id
  where x.id = p_export;
$$;

-- Solicitar una exportación (idempotente). La genera el servidor con la sesión
-- del solicitante, de modo que el archivo solo contiene lo que RLS le deja ver.
create or replace function public.request_report_export(p_company uuid, p_report text, p_format text,
  p_filters jsonb, p_idempotency_key uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing uuid;
  created uuid;
begin
  if (select auth.uid()) is null or not private.is_company_member(p_company) then
    raise exception 'No perteneces a esta empresa' using errcode = '42501';
  end if;
  if p_report = 'audit' and not private.has_permission(p_company, 'audit.read') then
    raise exception 'No tienes permiso para exportar la auditoría' using errcode = '42501';
  end if;
  select x.id into existing from public.report_exports x
  where x.company_id = p_company and x.requested_by = (select auth.uid()) and x.idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;
  end if;
  if (select count(*) from public.report_exports x where x.requested_by = (select auth.uid())
      and x.status in ('pending', 'processing')) >= 3 then
    raise exception 'Tienes 3 exportaciones en curso: espera a que terminen' using errcode = 'P0001';
  end if;
  insert into public.report_exports (company_id, requested_by, report_key, format, filters, idempotency_key)
  values (p_company, (select auth.uid()), p_report, p_format, coalesce(p_filters, '{}'), p_idempotency_key)
  returning id into created;
  perform private.report_export_event(created, 'request_export');
  return created;
end;
$$;

create or replace function public.start_report_export(p_export uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.report_exports set status = 'processing', started_at = now()
  where id = p_export and requested_by = (select auth.uid()) and status = 'pending';
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

create or replace function public.complete_report_export(p_export uuid, p_file_name text, p_path text, p_sha256 text,
  p_size bigint, p_rows integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  x public.report_exports;
begin
  select * into x from public.report_exports where id = p_export and requested_by = (select auth.uid()) for update;
  if x.id is null or x.status <> 'processing' then
    raise exception 'Exportación no encontrada' using errcode = 'P0002';
  end if;
  if p_path <> (x.company_id || '/' || x.requested_by || '/' || x.id || '/' || p_file_name)
     or not exists (select 1 from storage.objects o where o.bucket_id = 'report-exports' and o.name = p_path) then
    raise exception 'Archivo no válido' using errcode = '22023';
  end if;
  update public.report_exports
  set status = 'ready', file_name = p_file_name, storage_path = p_path, sha256 = lower(p_sha256), size_bytes = p_size,
      row_count = p_rows, completed_at = now(), expires_at = now() + interval '7 days'
  where id = x.id;
end;
$$;

create or replace function public.fail_report_export(p_export uuid, p_error_code text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.report_exports
  set status = 'failed', completed_at = now(),
      error_code = case when p_error_code ~ '^[a-z_]{1,40}$' then p_error_code else 'generation_failed' end
  where id = p_export and requested_by = (select auth.uid()) and status in ('pending', 'processing');
$$;

-- Descarga: solo quien la pidió, lista y sin caducar. Queda registrada.
create or replace function public.log_report_download(p_export uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  x public.report_exports;
begin
  select * into x from public.report_exports where id = p_export and requested_by = (select auth.uid());
  if x.id is null or x.status <> 'ready' or x.expires_at <= now() or not private.is_company_member(x.company_id) then
    raise exception 'Exportación no disponible' using errcode = 'P0002';
  end if;
  insert into public.report_export_downloads (company_id, export_id, downloaded_by)
  values (x.company_id, x.id, (select auth.uid()));
  perform private.report_export_event(x.id, 'download');
  return x.storage_path;
end;
$$;

-- Tarea programada: marca atascadas (fallidas) y caducadas, y devuelve los
-- archivos que ya no deben existir (caducados o huérfanos de una generación
-- fallida) para que la tarea los borre con la API de Storage.
create or replace function public.expire_report_exports()
returns table (export_id uuid, storage_path text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.report_exports set status = 'failed', error_code = 'timeout', completed_at = now()
  where status in ('pending', 'processing') and created_at < now() - interval '30 minutes';
  update public.report_exports set status = 'expired'
  where status = 'ready' and expires_at <= now();
  return query
  select x.id, o.name
  from storage.objects o
  left join public.report_exports x on x.id::text = split_part(o.name, '/', 3)
  where o.bucket_id = 'report-exports' and (x.id is null or x.status in ('failed', 'expired'));
end;
$$;

-- Solo cambia el estado (y lo que lo acompaña): la solicitud y sus filtros no.
create or replace function private.guard_report_export()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.company_id, new.requested_by, new.report_key, new.format, new.filters, new.idempotency_key,
      new.created_at, new.request_id)
     is distinct from (old.company_id, old.requested_by, old.report_key, old.format, old.filters,
      old.idempotency_key, old.created_at, old.request_id)
     or (old.status in ('ready', 'failed', 'expired') and not (old.status = 'ready' and new.status = 'expired')) then
    raise exception 'Una exportación no se modifica' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger report_exports_guard before update on public.report_exports
  for each row execute function private.guard_report_export();
create trigger report_exports_no_delete before delete on public.report_exports
  for each row execute function private.prevent_mutation();
create trigger report_export_downloads_immutable before update or delete on public.report_export_downloads
  for each row execute function private.prevent_mutation();
create trigger report_exports_keys before update on public.report_exports
  for each row execute function private.prevent_key_change('id', 'company_id', 'requested_by', 'idempotency_key');

-- Storage: <company_id>/<usuario>/<exportación>/<archivo>. Solo el solicitante.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-exports', 'report-exports', false, 104857600,
  array['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf'])
on conflict (id) do nothing;

create or replace function private.can_write_report_export(p_object text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.report_exports x
    where x.id::text = split_part(p_object, '/', 3) and x.company_id = private.object_company_id(p_object)
      and x.requested_by = (select auth.uid()) and split_part(p_object, '/', 2) = (select auth.uid())::text
      and x.status = 'processing'
  );
$$;

create or replace function private.can_read_report_export(p_object text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.report_exports x
    where x.storage_path = p_object and x.requested_by = (select auth.uid()) and x.status = 'ready'
      and x.expires_at > now() and private.is_company_member(x.company_id)
  );
$$;

create policy "report_exports_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'report-exports'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[a-z0-9._-]{1,120}$'
    and private.can_write_report_export(name));
create policy "report_exports_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'report-exports' and private.can_read_report_export(name));

-- -----------------------------------------------------------------------------
-- 6. Privilegios y RLS
-- -----------------------------------------------------------------------------

revoke all on function
  private.audit_status_event(),
  private.report_check(date, date, integer, integer, integer),
  private.report_scope(uuid, text),
  private.report_export_event(uuid, text),
  private.guard_report_export(),
  private.can_write_report_export(text),
  private.can_read_report_export(text)
from public;
grant execute on function
  private.current_request_id(),
  private.report_check(date, date, integer, integer, integer),
  private.report_scope(uuid, text),
  private.can_write_report_export(text),
  private.can_read_report_export(text)
to authenticated, service_role;

revoke all on function
  public.report_time_daily(uuid, date, date, uuid, uuid, uuid, integer, integer),
  public.report_time_summary(uuid, date, date, uuid, uuid, uuid, integer, integer),
  public.report_time_register(uuid, date, date, uuid, uuid, uuid, integer, integer),
  public.report_absence_balances(uuid, date, uuid, uuid, uuid, integer, integer),
  public.report_absence_requests(uuid, date, date, uuid, uuid, uuid, integer, integer),
  public.report_expenses(uuid, date, date, text, uuid, uuid, uuid, text, text, integer, integer),
  public.report_approvals(uuid, date, date),
  public.report_closures(uuid, date, date),
  public.report_audit(uuid, date, date, uuid, text, text, text, integer, integer),
  public.request_report_export(uuid, text, text, jsonb, uuid),
  public.start_report_export(uuid),
  public.complete_report_export(uuid, text, text, text, bigint, integer),
  public.fail_report_export(uuid, text),
  public.log_report_download(uuid),
  public.expire_report_exports()
from public, anon, authenticated;

grant execute on function
  public.report_time_daily(uuid, date, date, uuid, uuid, uuid, integer, integer),
  public.report_time_summary(uuid, date, date, uuid, uuid, uuid, integer, integer),
  public.report_time_register(uuid, date, date, uuid, uuid, uuid, integer, integer),
  public.report_absence_balances(uuid, date, uuid, uuid, uuid, integer, integer),
  public.report_absence_requests(uuid, date, date, uuid, uuid, uuid, integer, integer),
  public.report_expenses(uuid, date, date, text, uuid, uuid, uuid, text, text, integer, integer),
  public.report_approvals(uuid, date, date),
  public.report_closures(uuid, date, date),
  public.report_audit(uuid, date, date, uuid, text, text, text, integer, integer),
  public.request_report_export(uuid, text, text, jsonb, uuid),
  public.start_report_export(uuid),
  public.complete_report_export(uuid, text, text, text, bigint, integer),
  public.fail_report_export(uuid, text),
  public.log_report_download(uuid)
to authenticated, service_role;
grant execute on function public.expire_report_exports() to service_role;

revoke all on public.report_exports, public.report_export_downloads from anon, authenticated;
grant select on public.report_exports, public.report_export_downloads to authenticated;

alter table public.report_exports enable row level security;
alter table public.report_export_downloads enable row level security;

-- El solicitante ve las suyas; auditoría ve el registro de la empresa (sin archivo).
create policy "report_exports_select" on public.report_exports
  for select to authenticated
  using ((requested_by = (select auth.uid()) and private.is_company_member(company_id))
    or private.has_permission(company_id, 'audit.read'));
create policy "report_export_downloads_select" on public.report_export_downloads
  for select to authenticated
  using ((downloaded_by = (select auth.uid()) and private.is_company_member(company_id))
    or private.has_permission(company_id, 'audit.read'));
