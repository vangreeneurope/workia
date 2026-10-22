-- =============================================================================
-- Informes mensuales de gastos, aprobación por pasos y liquidación contable.
--
-- Ciclo (docs/LIQUIDACION_GASTOS.md):
--   gasto draft -> ready -> (informe) submitted -> in_review -> returned | approved
--   -> included_in_batch -> accounted
--
-- Principios:
--  - Al enviar, cada gasto se copia (snapshot) en el informe: lo revisado no
--    cambia aunque el gasto se edite después. Una devolución no modifica la
--    versión devuelta: el reenvío crea una versión nueva enlazada a la anterior.
--  - Nadie aprueba sus propios gastos ni dos pasos del mismo informe; las
--    suplencias quedan registradas como delegación.
--  - El cierre es transaccional, con secuencia sin huecos por empresa y clave de
--    idempotencia: reintentarlo devuelve el mismo lote. Un lote cerrado no se
--    modifica nunca; los ajustes van en lotes correctores.
--  - Dinero siempre en céntimos enteros y por moneda (nunca se suman monedas).
--  - Las cuentas contables son un mapeo genérico configurable por categoría:
--    no se presupone el formato de ningún ERP.
--
-- Reversión: supabase/rollbacks/20261028100000_informes_gastos.down.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------

create type public.expense_report_status as enum (
  'submitted', 'in_review', 'returned', 'approved', 'included_in_batch', 'accounted'
);
create type public.report_line_decision as enum ('pending', 'approved', 'rejected', 'returned');
create type public.approval_step_status as enum ('waiting', 'pending', 'approved', 'returned', 'skipped');
create type public.accounting_batch_kind as enum ('regular', 'corrective');
create type public.accounting_export_format as enum ('pdf', 'csv', 'xlsx', 'zip');

-- -----------------------------------------------------------------------------
-- 2. Permisos (ADR-045): se amplía la matriz de gastos
-- -----------------------------------------------------------------------------

-- 'approve': aprobar como responsable de respaldo (sin aprobador o autoaprobación)
-- y en pasos por rol. 'close': cerrar periodos, generar y descargar el paquete
-- contable. Solo Contabilidad cierra.
create or replace function private.role_has_expense_permission(p_role public.app_role, p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'company_admin' then p_action in ('read', 'manage', 'approve')
    when 'accounting' then p_action in ('read', 'close')
    else false
  end;
$$;

create or replace function public.my_expense_access(p_company uuid)
returns table (action text, scope_type text, work_center_id uuid, team_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select 'manage', 'company', null::uuid, null::uuid
  where private.is_group_admin_of_company(p_company)
  union
  select a, ra.scope_type::text, ra.work_center_id, ra.team_id
  from public.role_assignments ra
  cross join unnest(array['read', 'manage', 'approve', 'close']) as a
  where ra.company_id = p_company
    and ra.membership_id = private.current_membership_id(p_company)
    and ra.status = 'active'
    and private.is_active_window(ra.valid_from, ra.valid_to)
    and private.role_has_expense_permission(ra.role, a);
$$;

-- -----------------------------------------------------------------------------
-- 3. Configuración: reglas de aprobación y mapeo contable
-- -----------------------------------------------------------------------------

-- Pasos adicionales tras el del manager: si el total del informe en una moneda
-- (o el de una categoría) alcanza el umbral, aprueba además un rol o una persona.
create table public.expense_approval_rules (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete restrict,
  name             text not null check (char_length(btrim(name)) between 2 and 80),
  step_order       integer not null default 2 check (step_order between 2 and 9),
  currency         text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  min_total_cents  bigint not null default 0 check (min_total_cents >= 0),
  category_id      uuid,
  approver_role    public.app_role check (approver_role is null or approver_role in ('company_admin', 'accounting')),
  approver_user_id uuid references public.profiles (id) on delete restrict,
  status           text not null default 'active' check (status in ('active', 'inactive')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id),
  foreign key (category_id, company_id) references public.expense_categories (id, company_id),
  constraint expense_approval_rules_one_approver check ((approver_role is null) <> (approver_user_id is null))
);

-- Cuenta contable por categoría (o por defecto si category_id es null).
create table public.expense_account_mappings (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies (id) on delete restrict,
  category_id              uuid,
  account_code             text not null check (account_code ~ '^[A-Za-z0-9._-]{1,30}$'),
  tax_account_code         text check (tax_account_code is null or tax_account_code ~ '^[A-Za-z0-9._-]{1,30}$'),
  counterpart_account_code text check (counterpart_account_code is null or counterpart_account_code ~ '^[A-Za-z0-9._-]{1,30}$'),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (id, company_id),
  foreign key (category_id, company_id) references public.expense_categories (id, company_id)
);
create unique index expense_account_mappings_category_idx
  on public.expense_account_mappings (company_id, coalesce(category_id, '00000000-0000-0000-0000-000000000000'));

-- -----------------------------------------------------------------------------
-- 4. Informes, líneas (snapshot) y aprobación
-- -----------------------------------------------------------------------------

create table public.expense_reports (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete restrict,
  employee_id         uuid not null,
  period_month        date not null check (extract(day from period_month) = 1),
  version             integer not null check (version >= 1),
  previous_version_id uuid,
  status              public.expense_report_status not null default 'submitted',
  idempotency_key     uuid not null,
  submitted_by        uuid references public.profiles (id) on delete set null,
  submitted_at        timestamptz not null default now(),
  decided_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, employee_id, period_month, version),
  unique (company_id, employee_id, idempotency_key),
  unique (id, company_id, employee_id),
  unique (id, company_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (previous_version_id, company_id, employee_id)
    references public.expense_reports (id, company_id, employee_id)
);
-- Como mucho un informe en revisión por persona y mes.
create unique index expense_reports_open_idx on public.expense_reports (company_id, employee_id, period_month)
  where status in ('submitted', 'in_review');
create index expense_reports_period_idx on public.expense_reports (company_id, period_month, status);

create table public.expense_report_items (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete restrict,
  employee_id          uuid not null,
  report_id            uuid not null,
  expense_id           uuid not null,
  -- Copia del gasto al enviar (datos y categoría) y su huella.
  snapshot             jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_hash        text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  expense_date         date not null,
  category_id          uuid not null,
  currency             text not null check (currency ~ '^[A-Z]{3}$'),
  base_cents           bigint,
  tax_cents            bigint,
  total_cents          bigint not null check (total_cents > 0),
  cost_center          text,
  project_code         text,
  decision             public.report_line_decision not null default 'pending',
  decision_comment     text check (decision_comment is null or char_length(decision_comment) <= 500),
  decided_by           uuid references public.profiles (id) on delete set null,
  decided_at           timestamptz,
  -- Aprobación heredada de la versión anterior (misma línea sin cambios).
  carried_from_item_id uuid references public.expense_report_items (id),
  unique (report_id, expense_id),
  unique (id, company_id, employee_id),
  foreign key (report_id, company_id, employee_id) references public.expense_reports (id, company_id, employee_id),
  foreign key (expense_id, company_id, employee_id) references public.expenses (id, company_id, employee_id),
  foreign key (category_id, company_id) references public.expense_categories (id, company_id)
);
create index expense_report_items_expense_idx on public.expense_report_items (expense_id);

create table public.approval_instances (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  employee_id  uuid not null,
  subject_type text not null default 'expense_report' check (subject_type in ('expense_report')),
  report_id    uuid not null unique,
  status       text not null default 'active' check (status in ('active', 'approved', 'returned')),
  current_step integer not null default 1,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  unique (id, company_id, employee_id),
  foreign key (report_id, company_id, employee_id) references public.expense_reports (id, company_id, employee_id)
);

create table public.approval_steps (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete restrict,
  employee_id            uuid not null,
  instance_id            uuid not null,
  step_order             integer not null check (step_order between 1 and 9),
  kind                   text not null check (kind in ('manager', 'rule')),
  rule_id                uuid,
  -- manager | substitute | admin_no_approver | admin_self_approval | rule_role | rule_user
  routing                text not null check (routing in ('manager', 'substitute', 'admin_no_approver',
    'admin_self_approval', 'rule_role', 'rule_user')),
  assigned_user_id       uuid references public.profiles (id) on delete set null,
  assigned_role          public.app_role,
  status                 public.approval_step_status not null default 'waiting',
  acted_by               uuid references public.profiles (id) on delete set null,
  -- Si actúa una suplente, a quién sustituye.
  delegated_from_user_id uuid references public.profiles (id) on delete set null,
  acted_at               timestamptz,
  comment                text check (comment is null or char_length(comment) <= 500),
  unique (instance_id, step_order),
  foreign key (instance_id, company_id, employee_id) references public.approval_instances (id, company_id, employee_id),
  foreign key (rule_id, company_id) references public.expense_approval_rules (id, company_id),
  constraint approval_steps_assignee check (assigned_user_id is not null or assigned_role is not null)
);
create index approval_steps_assigned_idx on public.approval_steps (assigned_user_id, status);

-- -----------------------------------------------------------------------------
-- 5. Lotes contables y exportaciones
-- -----------------------------------------------------------------------------

create table public.accounting_batches (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete restrict,
  period_month      date not null check (extract(day from period_month) = 1),
  sequence          integer not null check (sequence >= 1),
  kind              public.accounting_batch_kind not null default 'regular',
  corrects_batch_id uuid,
  idempotency_key   uuid not null,
  status            text not null default 'closed' check (status in ('closed', 'accounted')),
  note              text check (note is null or char_length(note) <= 500),
  closed_by         uuid references public.profiles (id) on delete set null,
  closed_at         timestamptz not null default now(),
  accounted_by      uuid references public.profiles (id) on delete set null,
  accounted_at      timestamptz,
  unique (company_id, sequence),
  unique (company_id, idempotency_key),
  unique (id, company_id),
  foreign key (corrects_batch_id, company_id) references public.accounting_batches (id, company_id),
  constraint accounting_batches_corrective check ((kind = 'corrective') = (corrects_batch_id is not null))
);
-- Un único cierre ordinario por empresa y periodo.
create unique index accounting_batches_regular_idx on public.accounting_batches (company_id, period_month)
  where kind = 'regular';

create table public.accounting_batch_lines (
  id               bigint generated always as identity primary key,
  company_id       uuid not null references public.companies (id) on delete restrict,
  batch_id         uuid not null,
  line_no          integer not null check (line_no >= 1),
  report_id        uuid,
  report_item_id   uuid unique,
  expense_id       uuid,
  employee_id      uuid not null,
  employee_code    text not null,
  employee_name    text not null,
  category_id      uuid,
  category_code    text not null,
  category_name    text not null,
  account_code     text not null,
  tax_account_code text,
  counterpart_account_code text,
  cost_center      text,
  project_code     text,
  expense_date     date not null,
  merchant_name    text,
  merchant_tax_id  text,
  document_number  text,
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  base_cents       bigint,
  tax_cents        bigint,
  total_cents      bigint not null check (total_cents <> 0),
  adjustment_reason text check (adjustment_reason is null or char_length(adjustment_reason) between 5 and 300),
  unique (batch_id, line_no),
  foreign key (batch_id, company_id) references public.accounting_batches (id, company_id),
  foreign key (report_id, company_id) references public.expense_reports (id, company_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  constraint accounting_batch_lines_origin check ((report_item_id is null) = (adjustment_reason is not null))
);

-- Informes pendientes que se excluyeron de un cierre (autorizado y motivado).
create table public.accounting_batch_exclusions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete restrict,
  batch_id      uuid not null,
  report_id     uuid not null,
  reason        text not null check (char_length(btrim(reason)) between 10 and 500),
  authorized_by uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (batch_id, report_id),
  foreign key (batch_id, company_id) references public.accounting_batches (id, company_id),
  foreign key (report_id, company_id) references public.expense_reports (id, company_id)
);

create table public.accounting_exports (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  batch_id     uuid not null,
  format       public.accounting_export_format not null,
  file_name    text not null check (file_name ~ '^[a-z0-9._-]{1,120}$'),
  storage_path text not null unique,
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes   bigint not null check (size_bytes > 0),
  generated_by uuid references public.profiles (id) on delete set null,
  generated_at timestamptz not null default now(),
  unique (batch_id, format),
  unique (id, company_id),
  foreign key (batch_id, company_id) references public.accounting_batches (id, company_id)
);

create table public.accounting_export_events (
  id         bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete restrict,
  export_id  uuid not null,
  action     text not null check (action in ('generated', 'downloaded')),
  actor_id   uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (export_id, company_id) references public.accounting_exports (id, company_id)
);

-- -----------------------------------------------------------------------------
-- 6. Funciones internas
-- -----------------------------------------------------------------------------

-- ¿Está el gasto en un informe que lo bloquea (no devuelto)? Un rechazo es definitivo.
create or replace function private.expense_locked(p_expense uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.expense_report_items i
    join public.expense_reports r on r.id = i.report_id
    where i.expense_id = p_expense and (r.status <> 'returned' or i.decision = 'rejected')
  );
$$;

-- Suplente vigente de un usuario para gastos (o null).
create or replace function private.expense_substitute_of(p_company uuid, p_absent uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.substitute_user_id from public.approver_substitutions s
  where s.company_id = p_company and s.absent_user_id = p_absent and s.status = 'active'
    and s.valid_from <= now() and s.valid_to > now() and s.request_type in ('expenses', 'all')
  order by (s.request_type = 'expenses') desc
  limit 1;
$$;

-- Usuario de la ficha (null si no tiene cuenta).
create or replace function private.employee_user(p_employee uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id from public.employees e
  join public.company_memberships m on m.id = e.membership_id
  where e.id = p_employee;
$$;

-- ¿Puede el usuario actual actuar en este paso? Nunca la propia persona ni
-- quien ya actuó en otro paso del mismo informe.
create or replace function private.can_act_on_step(p_step uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.approval_steps;
  me uuid := (select auth.uid());
  current_approver uuid;
begin
  select * into s from public.approval_steps where id = p_step;
  if s.id is null or s.status <> 'pending' or me is null
     or private.is_self_employee(s.employee_id) or private.employee_user(s.employee_id) = me
     or exists (select 1 from public.approval_steps o
       where o.instance_id = s.instance_id and o.id <> s.id and o.acted_by = me) then
    return false;
  end if;
  if s.assigned_role is not null then
    return private.has_company_role(s.company_id, array[s.assigned_role])
      and (s.assigned_role <> 'company_admin' or private.employee_expense_permission(s.employee_id, 'approve'));
  end if;
  if s.assigned_user_id = me or private.expense_substitute_of(s.company_id, s.assigned_user_id) = me then
    return true;
  end if;
  -- Paso del manager: si ha cambiado el aprobador vigente, decide el actual.
  if s.kind = 'manager' then
    begin
      select r.approver_user_id into current_approver
      from private.resolve_approver_internal(s.employee_id, 'expenses', now()) r;
    exception when others then
      current_approver := null;
    end;
    return current_approver = me;
  end if;
  return false;
end;
$$;

-- ¿Puede ver el informe? Quien puede leer los gastos de la persona o quien
-- tiene un paso asignado en él.
create or replace function private.can_view_report(p_report uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.expense_reports r
    where r.id = p_report and (
      private.can_read_employee_expenses(r.employee_id)
      or exists (
        select 1 from public.approval_instances ai
        join public.approval_steps st on st.instance_id = ai.id
        where ai.report_id = r.id and (st.assigned_user_id = (select auth.uid()) or st.acted_by = (select auth.uid())
          or private.expense_substitute_of(st.company_id, st.assigned_user_id) = (select auth.uid()))
      )
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- 7. Envío y revisión de informes
-- -----------------------------------------------------------------------------

-- Envía el informe de un mes con los gastos listos que no estén en otro informe.
-- Idempotente por clave. Si el último informe del mes fue devuelto, crea una
-- versión nueva enlazada; las líneas aprobadas que no han cambiado conservan
-- su aprobación.
create or replace function public.submit_expense_report(p_company uuid, p_period date, p_idempotency_key uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.own_employee(p_company);
  existing uuid;
  prev public.expense_reports;
  report uuid;
  instance uuid;
  today date;
  approver uuid;
  manager uuid;
  substitution uuid;
  route text;
  next_order integer := 2;
  rl record;
  n integer;
begin
  if me is null then
    raise exception 'No tienes ficha de empleado en esta empresa' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('expense:' || me));
  select r.id into existing from public.expense_reports r
  where r.company_id = p_company and r.employee_id = me and r.idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;
  end if;

  today := private.employee_today(me);
  if p_period is null or extract(day from p_period) <> 1 or p_period > date_trunc('month', today)::date then
    raise exception 'Elige un mes que ya haya empezado' using errcode = '22023';
  end if;
  if exists (select 1 from public.expense_reports r where r.company_id = p_company and r.employee_id = me
             and r.period_month = p_period and r.status in ('submitted', 'in_review')) then
    raise exception 'Ya tienes un informe de este mes en revisión' using errcode = 'P0001';
  end if;

  select * into prev from public.expense_reports r
  where r.company_id = p_company and r.employee_id = me and r.period_month = p_period
  order by r.version desc limit 1;

  insert into public.expense_reports (company_id, employee_id, period_month, version, previous_version_id,
    idempotency_key, submitted_by)
  values (p_company, me, p_period, coalesce(prev.version, 0) + 1, prev.id, p_idempotency_key, (select auth.uid()))
  returning id into report;

  -- Líneas: gastos listos del mes, sin informe vigente ni rechazo previo.
  insert into public.expense_report_items (company_id, employee_id, report_id, expense_id, snapshot, snapshot_hash,
    expense_date, category_id, currency, base_cents, tax_cents, total_cents, cost_center, project_code)
  select x.company_id, x.employee_id, report, x.id, s.snap,
    encode(extensions.digest(s.snap::text, 'sha256'), 'hex'),
    x.expense_date, x.category_id, x.currency, x.base_cents, x.tax_cents, x.total_cents, x.cost_center, x.project_code
  from public.expenses x
  join public.expense_categories c on c.id = x.category_id
  cross join lateral (select jsonb_build_object(
    'expense_id', x.id, 'source', x.source, 'expense_date', x.expense_date,
    'category_id', c.id, 'category_code', c.code, 'category_name', c.name,
    'merchant_name', x.merchant_name, 'merchant_tax_id', x.merchant_tax_id, 'document_number', x.document_number,
    'currency', x.currency, 'base_cents', x.base_cents, 'tax_cents', x.tax_cents, 'total_cents', x.total_cents,
    'payment_method', x.payment_method, 'client_name', x.client_name, 'project_code', x.project_code,
    'cost_center', x.cost_center, 'notes', x.notes, 'distance_km_tenths', x.distance_km_tenths,
    'mileage_rate_milli', x.mileage_rate_milli, 'deviations', to_jsonb(x.deviations),
    'receipt_id', (select rc.id from public.expense_receipts rc where rc.expense_id = x.id),
    'confirmed_at', x.confirmed_at
  ) as snap) s
  where x.company_id = p_company and x.employee_id = me and x.status = 'ready'
    and x.expense_date >= p_period and x.expense_date < (p_period + interval '1 month')::date
    and not private.expense_locked(x.id);
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'No hay gastos listos de ese mes pendientes de enviar' using errcode = 'P0001';
  end if;

  -- Aprobaciones heredadas: misma línea, sin cambios, aprobada en la versión devuelta.
  if prev.status = 'returned' then
    update public.expense_report_items i
    set decision = 'approved', decided_by = o.decided_by, decided_at = o.decided_at,
        decision_comment = o.decision_comment, carried_from_item_id = o.id
    from public.expense_report_items o
    where i.report_id = report and o.report_id = prev.id and o.expense_id = i.expense_id
      and o.decision = 'approved' and o.snapshot_hash = i.snapshot_hash;
  end if;

  insert into public.approval_instances (company_id, employee_id, report_id)
  values (p_company, me, report) returning id into instance;

  -- Paso 1: manager vigente (o su suplente); si no hay, o sería autoaprobación,
  -- la administración de la empresa con permiso de aprobación.
  begin
    select r.approver_user_id, r.manager_user_id, r.substitution_id into approver, manager, substitution
    from private.resolve_approver_internal(me, 'expenses', now()) r;
    route := case when substitution is not null then 'substitute' else 'manager' end;
  exception when others then
    approver := null;
    route := case when sqlerrm like 'APROBADOR_AUTOAPROBACION%' then 'admin_self_approval' else 'admin_no_approver' end;
  end;
  if approver is not null and approver = (select auth.uid()) then
    approver := null;
    route := 'admin_self_approval';
  end if;
  insert into public.approval_steps (company_id, employee_id, instance_id, step_order, kind, routing,
    assigned_user_id, assigned_role, delegated_from_user_id, status)
  values (p_company, me, instance, 1, 'manager', route, approver,
    case when approver is null then 'company_admin'::public.app_role end,
    case when route = 'substitute' then manager end, 'pending');

  -- Pasos adicionales según reglas configuradas.
  for rl in
    select ru.* from public.expense_approval_rules ru
    where ru.company_id = p_company and ru.status = 'active'
      and (select coalesce(sum(i.total_cents), 0) from public.expense_report_items i
           where i.report_id = report and i.currency = ru.currency
             and (ru.category_id is null or i.category_id = ru.category_id)) >= greatest(ru.min_total_cents, 1)
    order by ru.step_order, ru.name
  loop
    insert into public.approval_steps (company_id, employee_id, instance_id, step_order, kind, rule_id, routing,
      assigned_user_id, assigned_role)
    values (p_company, me, instance, next_order, 'rule', rl.id,
      case when rl.approver_user_id is not null then 'rule_user' else 'rule_role' end,
      rl.approver_user_id, rl.approver_role);
    next_order := next_order + 1;
  end loop;
  return report;
end;
$$;

-- Decisión sobre una línea en el paso del manager.
create or replace function public.decide_report_line(
  p_item uuid,
  p_decision public.report_line_decision,
  p_comment text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  i public.expense_report_items;
  r public.expense_reports;
  step uuid;
begin
  select * into i from public.expense_report_items where id = p_item;
  if i.id is null then
    raise exception 'Línea no encontrada' using errcode = 'P0002';
  end if;
  select * into r from public.expense_reports where id = i.report_id for update;
  select st.id into step from public.approval_steps st
  join public.approval_instances ai on ai.id = st.instance_id
  where ai.report_id = r.id and st.step_order = 1;
  if not private.can_view_report(r.id) then
    raise exception 'Línea no encontrada' using errcode = 'P0002';
  end if;
  if r.status not in ('submitted', 'in_review') then
    raise exception 'El informe no está en revisión' using errcode = 'P0001';
  end if;
  if not private.can_act_on_step(step) then
    raise exception 'Línea no encontrada' using errcode = 'P0002';
  end if;
  if p_decision = 'pending' then
    raise exception 'Elige aprobar, rechazar o devolver' using errcode = '22023';
  end if;
  if p_decision in ('rejected', 'returned') and char_length(coalesce(btrim(p_comment), '')) < 5 then
    raise exception 'Explica el motivo para rechazar o devolver la línea' using errcode = '22023';
  end if;
  update public.expense_report_items
  set decision = p_decision, decision_comment = nullif(btrim(p_comment), ''), decided_by = (select auth.uid()),
      decided_at = now(), carried_from_item_id = null
  where id = i.id;
  update public.expense_reports set status = 'in_review' where id = r.id and status = 'submitted';
end;
$$;

-- Termina el paso actual. En el paso del manager todas las líneas deben estar
-- decididas: si alguna se devuelve, el informe vuelve a la persona. En pasos
-- posteriores se aprueba o se devuelve el informe entero (con comentario).
create or replace function public.complete_report_step(p_report uuid, p_action text, p_comment text default null)
returns public.expense_report_status
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.expense_reports;
  ai public.approval_instances;
  s public.approval_steps;
  me uuid := (select auth.uid());
  delegated uuid;
  outcome public.expense_report_status;
begin
  select * into r from public.expense_reports where id = p_report for update;
  if r.id is null then
    raise exception 'Informe no encontrado' using errcode = 'P0002';
  end if;
  select * into ai from public.approval_instances where report_id = r.id for update;
  select * into s from public.approval_steps where instance_id = ai.id and step_order = ai.current_step for update;
  if s.id is null or not private.can_act_on_step(s.id) then
    raise exception 'Informe no encontrado' using errcode = 'P0002';
  end if;
  if r.status not in ('submitted', 'in_review') then
    raise exception 'El informe no está en revisión' using errcode = 'P0001';
  end if;
  if p_action not in ('approve', 'return') then
    raise exception 'Acción no válida' using errcode = '22023';
  end if;

  if s.kind = 'manager' then
    if exists (select 1 from public.expense_report_items where report_id = r.id and decision = 'pending') then
      raise exception 'Decide todas las líneas antes de terminar la revisión' using errcode = 'P0001';
    end if;
    if p_action = 'return' and not exists (
      select 1 from public.expense_report_items where report_id = r.id and decision = 'returned') then
      raise exception 'Para devolver el informe, marca qué líneas hay que corregir' using errcode = '22023';
    end if;
    if exists (select 1 from public.expense_report_items where report_id = r.id and decision = 'returned') then
      outcome := 'returned';
    end if;
  elsif p_action = 'return' then
    if char_length(coalesce(btrim(p_comment), '')) < 5 then
      raise exception 'Explica el motivo de la devolución' using errcode = '22023';
    end if;
    outcome := 'returned';
  end if;

  if s.assigned_user_id is not null and s.assigned_user_id <> me then
    delegated := s.assigned_user_id;
  else
    delegated := s.delegated_from_user_id;
  end if;
  update public.approval_steps
  set status = case when outcome = 'returned' then 'returned'::public.approval_step_status else 'approved' end,
      acted_by = me, acted_at = now(), comment = nullif(btrim(p_comment), ''), delegated_from_user_id = delegated
  where id = s.id;

  if outcome = 'returned' then
    update public.approval_steps set status = 'skipped' where instance_id = ai.id and status = 'waiting';
    update public.approval_instances set status = 'returned', completed_at = now() where id = ai.id;
    update public.expense_reports set status = 'returned', decided_at = now() where id = r.id;
    return 'returned';
  end if;

  if exists (select 1 from public.approval_steps where instance_id = ai.id and step_order > s.step_order) then
    update public.approval_steps set status = 'pending'
    where instance_id = ai.id and step_order = (select min(step_order) from public.approval_steps
      where instance_id = ai.id and step_order > s.step_order);
    update public.approval_instances set current_step = (select min(step_order) from public.approval_steps
      where instance_id = ai.id and step_order > s.step_order) where id = ai.id;
    update public.expense_reports set status = 'in_review' where id = r.id;
    return 'in_review';
  end if;

  update public.approval_instances set status = 'approved', completed_at = now() where id = ai.id;
  update public.expense_reports set status = 'approved', decided_at = now() where id = r.id;
  return 'approved';
end;
$$;

-- Informes de la empresa en los que el usuario puede actuar ahora (bandeja).
create or replace function public.my_pending_expense_approvals(p_company uuid)
returns table (report_id uuid, step_order integer, routing text)
language sql
stable
security definer
set search_path = ''
as $$
  select ai.report_id, st.step_order, st.routing
  from public.approval_steps st
  join public.approval_instances ai on ai.id = st.instance_id
  where st.company_id = p_company and st.status = 'pending' and ai.status = 'active'
    and private.can_act_on_step(st.id)
  order by ai.created_at;
$$;

-- -----------------------------------------------------------------------------
-- 8. Cierre contable
-- -----------------------------------------------------------------------------

-- Bloqueos que impiden cerrar un periodo (para mostrarlos antes de intentarlo).
create or replace function public.accounting_close_blockers(p_company uuid, p_period date)
returns table (kind text, report_id uuid, category_id uuid, detail text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_expense_permission(p_company, 'read') and not private.has_expense_permission(p_company, 'close') then
    raise exception 'No tienes permiso' using errcode = '42501';
  end if;
  return query
    -- Informes en revisión o devueltos sin reenviar (última versión del mes).
    select 'pending_report', r.id, null::uuid, r.status::text
    from public.expense_reports r
    where r.company_id = p_company and r.period_month = p_period
      and r.status in ('submitted', 'in_review', 'returned')
      and not exists (select 1 from public.expense_reports n
        where n.previous_version_id = r.id)
    union all
    -- Categorías sin cuenta contable (ni cuenta por defecto).
    select distinct 'missing_account', null::uuid, i.category_id, null::text
    from public.expense_report_items i
    join public.expense_reports r on r.id = i.report_id
    where r.company_id = p_company and r.period_month = p_period and r.status = 'approved'
      and i.decision = 'approved'
      and not exists (select 1 from public.expense_account_mappings m
        where m.company_id = p_company and (m.category_id = i.category_id or m.category_id is null));
end;
$$;

-- Inserta las líneas de un lote a partir de las líneas aprobadas de los informes dados.
create or replace function private.insert_batch_lines(p_batch uuid, p_company uuid, p_reports uuid[], p_first_line integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if exists (
    select 1 from public.expense_report_items i
    where i.report_id = any (p_reports) and i.decision = 'approved'
      and not exists (select 1 from public.expense_account_mappings mm
        where mm.company_id = p_company and (mm.category_id = i.category_id or mm.category_id is null))
  ) then
    raise exception 'Faltan cuentas contables para alguna categoría: configura el mapeo contable' using errcode = 'P0001';
  end if;
  insert into public.accounting_batch_lines (company_id, batch_id, line_no, report_id, report_item_id, expense_id,
    employee_id, employee_code, employee_name, category_id, category_code, category_name, account_code,
    tax_account_code, counterpart_account_code, cost_center, project_code, expense_date, merchant_name,
    merchant_tax_id, document_number, currency, base_cents, tax_cents, total_cents)
  select p_company, p_batch,
    p_first_line - 1 + row_number() over (order by e.employee_code, i.expense_date, i.id)::integer,
    i.report_id, i.id, i.expense_id, i.employee_id, e.employee_code, e.last_name || ', ' || e.first_name,
    i.category_id, i.snapshot ->> 'category_code', i.snapshot ->> 'category_name',
    m.account_code, m.tax_account_code, m.counterpart_account_code, i.cost_center, i.project_code, i.expense_date,
    i.snapshot ->> 'merchant_name', i.snapshot ->> 'merchant_tax_id', i.snapshot ->> 'document_number',
    i.currency, i.base_cents, i.tax_cents, i.total_cents
  from public.expense_report_items i
  join public.employees e on e.id = i.employee_id
  cross join lateral (
    select mm.* from public.expense_account_mappings mm
    where mm.company_id = p_company and (mm.category_id = i.category_id or mm.category_id is null)
    order by mm.category_id nulls last limit 1
  ) m
  where i.report_id = any (p_reports) and i.decision = 'approved';
  get diagnostics n = row_count;
  update public.expense_reports set status = 'included_in_batch' where id = any (p_reports);
  return n;
end;
$$;

-- Cierre ordinario de un periodo. Reintentar con la misma clave devuelve el
-- mismo lote. Los informes pendientes bloquean salvo exclusión motivada.
create or replace function public.close_accounting_period(
  p_company uuid,
  p_period date,
  p_idempotency_key uuid,
  p_excluded uuid[] default '{}',
  p_reason text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing uuid;
  batch uuid;
  regular integer;
  pending uuid[];
  reports uuid[];
  missing integer;
  seq integer;
begin
  if not private.has_expense_permission(p_company, 'close') then
    raise exception 'Solo Contabilidad puede cerrar periodos' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('accounting:' || p_company));
  select b.id into existing from public.accounting_batches b
  where b.company_id = p_company and b.idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;
  end if;
  if p_period is null or extract(day from p_period) <> 1 then
    raise exception 'Periodo no válido' using errcode = '22023';
  end if;
  select b.sequence into regular from public.accounting_batches b
  where b.company_id = p_company and b.period_month = p_period and b.kind = 'regular';
  if regular is not null then
    raise exception 'Este periodo ya está cerrado (lote %): para ajustes crea un lote corrector', regular
      using errcode = 'P0001';
  end if;

  select coalesce(array_agg(report_id), '{}') into pending
  from public.accounting_close_blockers(p_company, p_period) where kind = 'pending_report';
  if exists (select 1 from unnest(pending) as p where not (p = any (coalesce(p_excluded, '{}')))) then
    raise exception 'Hay % informes pendientes en este periodo: termina su revisión o exclúyelos con un motivo',
      (select count(*) from unnest(pending) as p where not (p = any (coalesce(p_excluded, '{}'))))
      using errcode = 'P0001';
  end if;
  if cardinality(coalesce(p_excluded, '{}')) > 0 then
    if char_length(coalesce(btrim(p_reason), '')) < 10 then
      raise exception 'Explica por qué se excluyen informes pendientes (mínimo 10 caracteres)' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(p_excluded) as x where not (x = any (pending))) then
      raise exception 'Solo se pueden excluir informes pendientes de este periodo' using errcode = '22023';
    end if;
  end if;
  select count(*) into missing from public.accounting_close_blockers(p_company, p_period)
  where kind = 'missing_account';
  if missing > 0 then
    raise exception 'Faltan cuentas contables para % categorías: configura el mapeo contable', missing
      using errcode = 'P0001';
  end if;

  select coalesce(array_agg(r.id order by r.id), '{}') into reports
  from public.expense_reports r
  where r.company_id = p_company and r.period_month = p_period and r.status = 'approved';
  if cardinality(reports) = 0 then
    raise exception 'No hay informes aprobados en este periodo' using errcode = 'P0001';
  end if;

  select coalesce(max(b.sequence), 0) + 1 into seq from public.accounting_batches b where b.company_id = p_company;
  insert into public.accounting_batches (company_id, period_month, sequence, kind, idempotency_key, closed_by)
  values (p_company, p_period, seq, 'regular', p_idempotency_key, (select auth.uid()))
  returning id into batch;
  insert into public.accounting_batch_exclusions (company_id, batch_id, report_id, reason, authorized_by)
  select p_company, batch, x, btrim(p_reason), (select auth.uid()) from unnest(coalesce(p_excluded, '{}')) as x;
  perform private.insert_batch_lines(batch, p_company, reports, 1);
  return batch;
end;
$$;

-- Lote corrector de un lote cerrado: informes del periodo aprobados después del
-- cierre y ajustes manuales con motivo. El lote original no cambia.
create or replace function public.create_corrective_batch(
  p_batch uuid,
  p_idempotency_key uuid,
  p_include_late_reports boolean,
  p_adjustments jsonb default '[]',
  p_note text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  original public.accounting_batches;
  existing uuid;
  batch uuid;
  reports uuid[] := '{}';
  lines integer := 0;
  seq integer;
  adj jsonb;
  emp public.employees;
  cat public.expense_categories;
  m public.expense_account_mappings;
begin
  select * into original from public.accounting_batches where id = p_batch;
  if original.id is null or not private.has_expense_permission(original.company_id, 'close') then
    raise exception 'Lote no encontrado' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('accounting:' || original.company_id));
  select b.id into existing from public.accounting_batches b
  where b.company_id = original.company_id and b.idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;
  end if;
  if char_length(coalesce(btrim(p_note), '')) < 10 then
    raise exception 'Explica el motivo del lote corrector (mínimo 10 caracteres)' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_adjustments, '[]')) <> 'array' then
    raise exception 'Ajustes no válidos' using errcode = '22023';
  end if;
  if p_include_late_reports then
    select coalesce(array_agg(r.id order by r.id), '{}') into reports from public.expense_reports r
    where r.company_id = original.company_id and r.period_month = original.period_month and r.status = 'approved';
  end if;
  if cardinality(reports) = 0 and jsonb_array_length(coalesce(p_adjustments, '[]')) = 0 then
    raise exception 'El lote corrector no tiene informes ni ajustes' using errcode = 'P0001';
  end if;

  select coalesce(max(b.sequence), 0) + 1 into seq from public.accounting_batches b
  where b.company_id = original.company_id;
  insert into public.accounting_batches (company_id, period_month, sequence, kind, corrects_batch_id,
    idempotency_key, note, closed_by)
  values (original.company_id, original.period_month, seq, 'corrective', original.id, p_idempotency_key,
    btrim(p_note), (select auth.uid()))
  returning id into batch;
  if cardinality(reports) > 0 then
    lines := private.insert_batch_lines(batch, original.company_id, reports, 1);
  end if;

  for adj in select * from jsonb_array_elements(coalesce(p_adjustments, '[]')) loop
    select * into emp from public.employees
    where id = (adj ->> 'employee_id')::uuid and company_id = original.company_id;
    select * into cat from public.expense_categories
    where id = (adj ->> 'category_id')::uuid and company_id = original.company_id;
    if emp.id is null or cat.id is null then
      raise exception 'Ajuste con persona o categoría no válida' using errcode = '22023';
    end if;
    select mm.* into m from public.expense_account_mappings mm
    where mm.company_id = original.company_id and (mm.category_id = cat.id or mm.category_id is null)
    order by mm.category_id nulls last limit 1;
    if m.id is null then
      raise exception 'Falta la cuenta contable de la categoría %', cat.code using errcode = 'P0001';
    end if;
    if (adj ->> 'total_cents') !~ '^-?[0-9]{1,12}$' or (adj ->> 'total_cents')::bigint = 0
       or coalesce(adj ->> 'currency', '') !~ '^[A-Z]{3}$'
       or char_length(coalesce(btrim(adj ->> 'reason'), '')) not between 5 and 300 then
      raise exception 'Cada ajuste necesita importe en céntimos distinto de cero, moneda y motivo' using errcode = '22023';
    end if;
    lines := lines + 1;
    insert into public.accounting_batch_lines (company_id, batch_id, line_no, employee_id, employee_code,
      employee_name, category_id, category_code, category_name, account_code, tax_account_code,
      counterpart_account_code, expense_date, currency, total_cents, adjustment_reason)
    values (original.company_id, batch, lines, emp.id, emp.employee_code, emp.last_name || ', ' || emp.first_name,
      cat.id, cat.code, cat.name, m.account_code, m.tax_account_code, m.counterpart_account_code,
      (original.period_month + interval '1 month' - interval '1 day')::date, adj ->> 'currency',
      (adj ->> 'total_cents')::bigint, btrim(adj ->> 'reason'));
  end loop;
  return batch;
end;
$$;

-- Contabilidad confirma que el lote se ha contabilizado en su sistema.
create or replace function public.mark_batch_accounted(p_batch uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.accounting_batches;
begin
  select * into b from public.accounting_batches where id = p_batch for update;
  if b.id is null or not private.has_expense_permission(b.company_id, 'close') then
    raise exception 'Lote no encontrado' using errcode = 'P0002';
  end if;
  if b.status = 'accounted' then
    return;
  end if;
  update public.accounting_batches set status = 'accounted', accounted_by = (select auth.uid()), accounted_at = now()
  where id = b.id;
  update public.expense_reports set status = 'accounted'
  where id in (select l.report_id from public.accounting_batch_lines l where l.batch_id = b.id and l.report_id is not null);
end;
$$;

-- Totales del lote por dimensión y moneda (los usan pantalla, PDF y ficheros).
create or replace function public.accounting_batch_totals(p_batch uuid)
returns table (dimension text, key text, label text, currency text, base_cents bigint, tax_cents bigint,
  total_cents bigint, lines bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with l as (
    select * from public.accounting_batch_lines
    where batch_id = p_batch
      and (private.has_expense_permission(company_id, 'read') or private.has_expense_permission(company_id, 'close'))
  )
  select 'total', '', '', currency, sum(coalesce(base_cents, 0))::bigint, sum(coalesce(tax_cents, 0))::bigint,
    sum(total_cents)::bigint, count(*) from l group by currency
  union all
  select 'employee', employee_code, max(employee_name), currency, sum(coalesce(base_cents, 0))::bigint,
    sum(coalesce(tax_cents, 0))::bigint, sum(total_cents)::bigint, count(*) from l group by employee_code, currency
  union all
  select 'category', category_code, max(category_name), currency, sum(coalesce(base_cents, 0))::bigint,
    sum(coalesce(tax_cents, 0))::bigint, sum(total_cents)::bigint, count(*) from l group by category_code, currency
  union all
  select 'account', account_code, account_code, currency, sum(coalesce(base_cents, 0))::bigint,
    sum(coalesce(tax_cents, 0))::bigint, sum(total_cents)::bigint, count(*) from l group by account_code, currency
  union all
  select 'cost_center', coalesce(cost_center, ''), coalesce(cost_center, 'Sin centro de coste'), currency,
    sum(coalesce(base_cents, 0))::bigint, sum(coalesce(tax_cents, 0))::bigint, sum(total_cents)::bigint, count(*)
  from l group by cost_center, currency
  union all
  select 'project', coalesce(project_code, ''), coalesce(project_code, 'Sin proyecto'), currency,
    sum(coalesce(base_cents, 0))::bigint, sum(coalesce(tax_cents, 0))::bigint, sum(total_cents)::bigint, count(*)
  from l group by project_code, currency
  order by 1, 2, 4;
$$;

-- Registra un archivo generado. Idempotente: el mismo formato del mismo lote
-- debe dar la misma huella (generación determinista).
create or replace function public.register_accounting_export(
  p_batch uuid,
  p_format public.accounting_export_format,
  p_file_name text,
  p_path text,
  p_sha256 text,
  p_size bigint
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  b public.accounting_batches;
  e public.accounting_exports;
begin
  select * into b from public.accounting_batches where id = p_batch;
  if b.id is null or not private.has_expense_permission(b.company_id, 'close') then
    raise exception 'Lote no encontrado' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('export:' || p_batch || ':' || p_format));
  select * into e from public.accounting_exports where batch_id = b.id and format = p_format;
  if e.id is not null then
    if e.sha256 <> lower(p_sha256) then
      raise exception 'El archivo generado no coincide con el ya registrado' using errcode = 'P0001';
    end if;
    return e.id;
  end if;
  if p_path <> (b.company_id || '/lotes/' || b.id || '/' || p_file_name)
     or not exists (select 1 from storage.objects o where o.bucket_id = 'accounting-exports' and o.name = p_path) then
    raise exception 'Archivo no válido' using errcode = '22023';
  end if;
  insert into public.accounting_exports (company_id, batch_id, format, file_name, storage_path, sha256, size_bytes,
    generated_by)
  values (b.company_id, b.id, p_format, p_file_name, p_path, lower(p_sha256), p_size, (select auth.uid()))
  returning * into e;
  insert into public.accounting_export_events (company_id, export_id, action, actor_id)
  values (e.company_id, e.id, 'generated', (select auth.uid()));
  return e.id;
end;
$$;

-- Registra una descarga y devuelve la ruta para firmar el enlace.
create or replace function public.log_export_download(p_export uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e public.accounting_exports;
begin
  select * into e from public.accounting_exports where id = p_export;
  if e.id is null or not private.has_expense_permission(e.company_id, 'close') then
    raise exception 'Archivo no encontrado' using errcode = 'P0002';
  end if;
  insert into public.accounting_export_events (company_id, export_id, action, actor_id)
  values (e.company_id, e.id, 'downloaded', (select auth.uid()));
  return e.storage_path;
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Gastos bloqueados por un informe (se sustituyen las funciones de 20261027)
-- -----------------------------------------------------------------------------

create or replace function public.reopen_expense(p_expense uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  x public.expenses := private.own_expense_for_update(p_expense);
begin
  if x.status <> 'ready' then
    raise exception 'Solo se puede corregir un gasto listo' using errcode = 'P0001';
  end if;
  if private.expense_locked(x.id) then
    raise exception 'El gasto está en un informe enviado: solo se corrige si te lo devuelven' using errcode = 'P0001';
  end if;
  update public.expenses set status = 'draft', confirmed_at = null, confirmed_by = null where id = x.id;
  perform private.expense_event(x.id, 'reopened');
end;
$$;

create or replace function public.set_expense_discarded(p_expense uuid, p_discarded boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  x public.expenses := private.own_expense_for_update(p_expense);
begin
  if private.expense_locked(x.id) then
    raise exception 'El gasto está en un informe enviado' using errcode = 'P0001';
  end if;
  if p_discarded and x.status = 'draft' then
    update public.expenses set status = 'discarded' where id = x.id;
    perform private.expense_event(x.id, 'discarded');
  elsif not p_discarded and x.status = 'discarded' then
    update public.expenses set status = 'draft' where id = x.id;
    perform private.expense_event(x.id, 'restored');
  else
    raise exception 'El gasto no se puede descartar en su estado actual' using errcode = 'P0001';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Integridad
-- -----------------------------------------------------------------------------

-- La copia del gasto no cambia; la decisión solo mientras el informe está en revisión.
create or replace function private.guard_report_item()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.snapshot, new.snapshot_hash, new.expense_date, new.category_id, new.currency, new.base_cents,
      new.tax_cents, new.total_cents, new.cost_center, new.project_code)
     is distinct from (old.snapshot, old.snapshot_hash, old.expense_date, old.category_id, old.currency,
      old.base_cents, old.tax_cents, old.total_cents, old.cost_center, old.project_code) then
    raise exception 'La copia del gasto en el informe es inmutable' using errcode = 'P0001';
  end if;
  if (select r.status from public.expense_reports r where r.id = old.report_id) not in ('submitted', 'in_review') then
    raise exception 'El informe ya no está en revisión: sus líneas no cambian' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Transiciones de estado permitidas de un informe.
create or replace function private.guard_report_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> old.status and not (
    (old.status = 'submitted' and new.status in ('in_review', 'returned', 'approved'))
    or (old.status = 'in_review' and new.status in ('returned', 'approved'))
    or (old.status = 'approved' and new.status = 'included_in_batch')
    or (old.status = 'included_in_batch' and new.status = 'accounted')
  ) then
    raise exception 'Transición de informe no permitida: % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Un lote solo pasa de cerrado a contabilizado.
create or replace function private.guard_accounting_batch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['status', 'accounted_by', 'accounted_at'])
     is distinct from (to_jsonb(old) - array['status', 'accounted_by', 'accounted_at'])
     or not (old.status = 'closed' and new.status = 'accounted') then
    raise exception 'Un lote cerrado no se modifica: crea un lote corrector' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger expense_report_items_guard before update on public.expense_report_items
  for each row execute function private.guard_report_item();
create trigger expense_reports_status_guard before update on public.expense_reports
  for each row execute function private.guard_report_status();
create trigger accounting_batches_guard before update on public.accounting_batches
  for each row execute function private.guard_accounting_batch();
create trigger expense_reports_no_delete before delete on public.expense_reports
  for each row execute function private.prevent_mutation();
create trigger expense_report_items_no_delete before delete on public.expense_report_items
  for each row execute function private.prevent_mutation();
create trigger approval_instances_no_delete before delete on public.approval_instances
  for each row execute function private.prevent_mutation();
create trigger approval_steps_no_delete before delete on public.approval_steps
  for each row execute function private.prevent_mutation();
create trigger accounting_batches_no_delete before delete on public.accounting_batches
  for each row execute function private.prevent_mutation();
create trigger accounting_batch_lines_immutable before update or delete on public.accounting_batch_lines
  for each row execute function private.prevent_mutation();
create trigger accounting_batch_exclusions_immutable before update or delete on public.accounting_batch_exclusions
  for each row execute function private.prevent_mutation();
create trigger accounting_exports_immutable before update or delete on public.accounting_exports
  for each row execute function private.prevent_mutation();
create trigger accounting_export_events_immutable before update or delete on public.accounting_export_events
  for each row execute function private.prevent_mutation();

create trigger expense_approval_rules_updated_at before update on public.expense_approval_rules
  for each row execute function private.set_updated_at();
create trigger expense_account_mappings_updated_at before update on public.expense_account_mappings
  for each row execute function private.set_updated_at();
create trigger expense_reports_updated_at before update on public.expense_reports
  for each row execute function private.set_updated_at();

create trigger expense_approval_rules_keys before update on public.expense_approval_rules
  for each row execute function private.prevent_key_change('id', 'company_id');
create trigger expense_account_mappings_keys before update on public.expense_account_mappings
  for each row execute function private.prevent_key_change('id', 'company_id', 'category_id');
create trigger expense_reports_keys before update on public.expense_reports
  for each row execute function private.prevent_key_change(
    'id', 'company_id', 'employee_id', 'period_month', 'version', 'previous_version_id', 'idempotency_key');
create trigger expense_report_items_keys before update on public.expense_report_items
  for each row execute function private.prevent_key_change('id', 'company_id', 'employee_id', 'report_id', 'expense_id');
create trigger approval_instances_keys before update on public.approval_instances
  for each row execute function private.prevent_key_change('id', 'company_id', 'employee_id', 'report_id');
create trigger approval_steps_keys before update on public.approval_steps
  for each row execute function private.prevent_key_change(
    'id', 'company_id', 'employee_id', 'instance_id', 'step_order', 'kind', 'rule_id');

-- Auditoría: configuración, decisiones, pasos y cierres.
create trigger audit_expense_approval_rules after insert or update on public.expense_approval_rules
  for each row execute function private.audit_row_change('company_id');
create trigger audit_expense_account_mappings after insert or update on public.expense_account_mappings
  for each row execute function private.audit_row_change('company_id');
create trigger audit_expense_reports after insert or update on public.expense_reports
  for each row execute function private.audit_row_change('company_id');
create trigger audit_approval_steps after update on public.approval_steps
  for each row execute function private.audit_row_change('company_id');
create trigger audit_accounting_batches after insert or update on public.accounting_batches
  for each row execute function private.audit_row_change('company_id');
create trigger audit_accounting_batch_exclusions after insert on public.accounting_batch_exclusions
  for each row execute function private.audit_row_change('company_id');

-- -----------------------------------------------------------------------------
-- 11. Storage: paquetes contables en un bucket privado
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('accounting-exports', 'accounting-exports', false, 524288000,
  array['application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip'])
on conflict (id) do nothing;

-- Ruta: <company_id>/lotes/<batch_id>/<nombre>. Solo Contabilidad (cierre) sube y abre.
create policy "accounting_exports_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'accounting-exports'
    and private.has_expense_permission(private.object_company_id(name), 'close'));

create policy "accounting_exports_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'accounting-exports'
    and name ~ '^[0-9a-f-]{36}/lotes/[0-9a-f-]{36}/[a-z0-9._-]{1,120}$'
    and private.has_expense_permission(private.object_company_id(name), 'close')
    and exists (select 1 from public.accounting_batches b
      where b.id::text = split_part(name, '/', 3) and b.company_id = private.object_company_id(name))
  );

-- -----------------------------------------------------------------------------
-- 12. Privilegios
-- -----------------------------------------------------------------------------

revoke all on function
  private.expense_locked(uuid),
  private.expense_substitute_of(uuid, uuid),
  private.employee_user(uuid),
  private.can_act_on_step(uuid),
  private.can_view_report(uuid),
  private.insert_batch_lines(uuid, uuid, uuid[], integer),
  private.guard_report_item(),
  private.guard_report_status(),
  private.guard_accounting_batch()
from public;

grant execute on function
  private.expense_locked(uuid),
  private.can_act_on_step(uuid),
  private.can_view_report(uuid)
to authenticated, service_role;

revoke all on function
  public.submit_expense_report(uuid, date, uuid),
  public.decide_report_line(uuid, public.report_line_decision, text),
  public.complete_report_step(uuid, text, text),
  public.my_pending_expense_approvals(uuid),
  public.accounting_close_blockers(uuid, date),
  public.close_accounting_period(uuid, date, uuid, uuid[], text),
  public.create_corrective_batch(uuid, uuid, boolean, jsonb, text),
  public.mark_batch_accounted(uuid),
  public.accounting_batch_totals(uuid),
  public.register_accounting_export(uuid, public.accounting_export_format, text, text, text, bigint),
  public.log_export_download(uuid)
from public, anon, authenticated;

grant execute on function
  public.submit_expense_report(uuid, date, uuid),
  public.decide_report_line(uuid, public.report_line_decision, text),
  public.complete_report_step(uuid, text, text),
  public.my_pending_expense_approvals(uuid),
  public.accounting_close_blockers(uuid, date),
  public.close_accounting_period(uuid, date, uuid, uuid[], text),
  public.create_corrective_batch(uuid, uuid, boolean, jsonb, text),
  public.mark_batch_accounted(uuid),
  public.accounting_batch_totals(uuid),
  public.register_accounting_export(uuid, public.accounting_export_format, text, text, text, bigint),
  public.log_export_download(uuid)
to authenticated, service_role;

revoke all on public.expense_approval_rules, public.expense_account_mappings, public.expense_reports,
  public.expense_report_items, public.approval_instances, public.approval_steps, public.accounting_batches,
  public.accounting_batch_lines, public.accounting_batch_exclusions, public.accounting_exports,
  public.accounting_export_events
from anon, authenticated;

grant select on public.expense_approval_rules, public.expense_account_mappings, public.expense_reports,
  public.expense_report_items, public.approval_instances, public.approval_steps, public.accounting_batches,
  public.accounting_batch_lines, public.accounting_batch_exclusions, public.accounting_exports,
  public.accounting_export_events
to authenticated;

-- Configuración: escritura directa con RLS (gestión de gastos).
grant insert (company_id, name, step_order, currency, min_total_cents, category_id, approver_role, approver_user_id)
  on public.expense_approval_rules to authenticated;
grant update (name, step_order, currency, min_total_cents, category_id, approver_role, approver_user_id, status)
  on public.expense_approval_rules to authenticated;
grant insert (company_id, category_id, account_code, tax_account_code, counterpart_account_code)
  on public.expense_account_mappings to authenticated;
grant update (account_code, tax_account_code, counterpart_account_code)
  on public.expense_account_mappings to authenticated;
-- Informes, líneas, pasos, lotes y exportaciones: solo mediante funciones.

-- -----------------------------------------------------------------------------
-- 13. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.expense_approval_rules enable row level security;
alter table public.expense_account_mappings enable row level security;
alter table public.expense_reports enable row level security;
alter table public.expense_report_items enable row level security;
alter table public.approval_instances enable row level security;
alter table public.approval_steps enable row level security;
alter table public.accounting_batches enable row level security;
alter table public.accounting_batch_lines enable row level security;
alter table public.accounting_batch_exclusions enable row level security;
alter table public.accounting_exports enable row level security;
alter table public.accounting_export_events enable row level security;

create policy "expense_approval_rules_select" on public.expense_approval_rules
  for select to authenticated
  using (private.has_expense_permission(company_id, 'manage') or private.has_expense_permission(company_id, 'read'));
create policy "expense_approval_rules_insert" on public.expense_approval_rules
  for insert to authenticated with check (private.has_expense_permission(company_id, 'manage'));
create policy "expense_approval_rules_update" on public.expense_approval_rules
  for update to authenticated
  using (private.has_expense_permission(company_id, 'manage'))
  with check (private.has_expense_permission(company_id, 'manage'));

create policy "expense_account_mappings_select" on public.expense_account_mappings
  for select to authenticated
  using (private.has_expense_permission(company_id, 'manage') or private.has_expense_permission(company_id, 'read')
    or private.has_expense_permission(company_id, 'close'));
create policy "expense_account_mappings_insert" on public.expense_account_mappings
  for insert to authenticated with check (private.has_expense_permission(company_id, 'manage'));
create policy "expense_account_mappings_update" on public.expense_account_mappings
  for update to authenticated
  using (private.has_expense_permission(company_id, 'manage'))
  with check (private.has_expense_permission(company_id, 'manage'));

create policy "expense_reports_select" on public.expense_reports
  for select to authenticated using (private.can_view_report(id));
create policy "expense_report_items_select" on public.expense_report_items
  for select to authenticated using (private.can_view_report(report_id));
create policy "approval_instances_select" on public.approval_instances
  for select to authenticated using (private.can_view_report(report_id));
create policy "approval_steps_select" on public.approval_steps
  for select to authenticated
  using (exists (select 1 from public.approval_instances ai
    where ai.id = instance_id and private.can_view_report(ai.report_id)));

-- Lotes y paquetes: lectura de gastos o cierre a nivel de empresa.
create policy "accounting_batches_select" on public.accounting_batches
  for select to authenticated
  using (private.has_expense_permission(company_id, 'read') or private.has_expense_permission(company_id, 'close'));
create policy "accounting_batch_lines_select" on public.accounting_batch_lines
  for select to authenticated
  using (private.has_expense_permission(company_id, 'read') or private.has_expense_permission(company_id, 'close'));
create policy "accounting_batch_exclusions_select" on public.accounting_batch_exclusions
  for select to authenticated
  using (private.has_expense_permission(company_id, 'read') or private.has_expense_permission(company_id, 'close'));
create policy "accounting_exports_select" on public.accounting_exports
  for select to authenticated
  using (private.has_expense_permission(company_id, 'read') or private.has_expense_permission(company_id, 'close'));
create policy "accounting_export_events_select" on public.accounting_export_events
  for select to authenticated using (private.has_expense_permission(company_id, 'close'));
