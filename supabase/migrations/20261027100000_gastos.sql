-- =============================================================================
-- Gastos: captura de tickets, cola de OCR idempotente con reintentos limitados,
-- control de duplicados, revisión humana obligatoria y reglas de la política de
-- gastos de cada empresa.
--
-- Principios (docs/GASTOS.md):
--  - El OCR solo propone: sus resultados viven en ocr_runs y nunca se copian
--    solos al gasto. El gasto queda "listo" solo cuando la persona lo confirma
--    y ha revisado los campos de baja confianza.
--  - Sin texto completo del ticket en la base de datos ni en registros: solo
--    los campos normalizados con su confianza.
--  - El ticket original es inmutable: corregir datos no lo cambia ni lo borra.
--  - Reintentar no duplica: clave de idempotencia por gasto, un trabajo por
--    ticket (dedupe_key) y un ticket por huella SHA-256 en cada empresa.
--  - La similitud (proveedor, fecha, total y moneda) avisa y pide confirmación
--    expresa; no bloquea por sí sola.
--  - Tickets en el bucket privado expense-receipts, ruta
--    <company_id>/<employee_id>/<año>/<mes>/<uuid>.<ext>, con URL firmada corta.
--
-- Reversión: supabase/rollbacks/20261027100000_gastos.down.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------

create type public.expense_status as enum ('draft', 'ready', 'discarded');
create type public.expense_source as enum ('receipt', 'manual', 'mileage');
create type public.payment_method as enum ('company_card', 'personal_card', 'cash', 'transfer', 'other');
create type public.ocr_status as enum ('pending', 'processing', 'succeeded', 'needs_review', 'failed');
create type public.job_status as enum ('pending', 'processing', 'succeeded', 'failed');

-- -----------------------------------------------------------------------------
-- 2. Permisos de gastos (ADR-042)
-- -----------------------------------------------------------------------------

-- 'read': consultar gastos y tickets del ámbito (Contabilidad y administración
-- de empresa). 'manage': configurar categorías y política. La administración de
-- grupo configura, pero no lee tickets de las personas.
create or replace function private.role_has_expense_permission(p_role public.app_role, p_action text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'company_admin' then p_action in ('read', 'manage')
    when 'accounting' then p_action = 'read'
    else false
  end;
$$;

create or replace function private.has_expense_permission(
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
    (p_action = 'manage' and private.is_group_admin_of_company(p_company))
    or exists (
      select 1
      from public.role_assignments ra
      where ra.company_id = p_company
        and ra.membership_id = private.current_membership_id(p_company)
        and ra.status = 'active'
        and private.is_active_window(ra.valid_from, ra.valid_to)
        and private.role_has_expense_permission(ra.role, p_action)
        and (
          ra.scope_type = 'company'
          or (ra.scope_type = 'work_center' and ra.work_center_id = p_work_center)
          or (ra.scope_type = 'team' and ra.team_id = p_team)
        )
    )
  );
$$;

create or replace function private.employee_expense_permission(p_employee uuid, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.has_expense_permission(e.company_id, p_action, e.work_center_id, e.team_id)
    from public.employees e where e.id = p_employee
  ), false);
$$;

-- La persona, quien la supervisa (o su suplente) y Contabilidad de su ámbito.
create or replace function private.can_read_employee_expenses(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_self_employee(p_employee)
    or private.manages_employee(p_employee)
    or private.employee_expense_permission(p_employee, 'read');
$$;

-- -----------------------------------------------------------------------------
-- 3. Configuración: política y categorías
-- -----------------------------------------------------------------------------

-- Una política por empresa. Los valores los decide la empresa (convenio,
-- acuerdo, criterio fiscal de su asesoría); la plataforma no fija ninguno legal.
create table public.expense_policies (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies (id) on delete restrict,
  max_days_past             integer not null default 90 check (max_days_past between 0 and 730),
  default_currency          text not null default 'EUR' check (default_currency ~ '^[A-Z]{3}$'),
  allowed_currencies        text[] not null default '{EUR}'
    check (cardinality(allowed_currencies) between 1 and 20),
  receipt_required          boolean not null default true,
  -- Kilometraje: milésimas de la moneda por km (0,26 €/km = 260). Null = sin kilometraje.
  mileage_rate_milli        integer check (mileage_rate_milli is null or mileage_rate_milli between 1 and 100000),
  -- Diferencia admitida entre el total leído por OCR y el confirmado antes de avisar.
  ocr_total_tolerance_cents integer not null default 0 check (ocr_total_tolerance_cents between 0 and 100000),
  legal_reference           text check (legal_reference is null or char_length(legal_reference) <= 200),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (company_id),
  unique (id, company_id),
  constraint expense_policies_default_allowed check (default_currency = any (allowed_currencies))
);

create table public.expense_categories (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete restrict,
  code                 text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name                 text not null check (char_length(btrim(name)) between 2 and 80),
  is_mileage           boolean not null default false,
  -- Importe a partir del cual hay que justificar la desviación en las notas.
  max_amount_cents     bigint check (max_amount_cents is null or max_amount_cents > 0),
  requires_client      boolean not null default false,
  requires_project     boolean not null default false,
  requires_cost_center boolean not null default false,
  requires_notes       boolean not null default false,
  status               text not null default 'active' check (status in ('active', 'inactive')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, code),
  unique (id, company_id)
);

-- -----------------------------------------------------------------------------
-- 4. Gastos, tickets, trabajos y ejecuciones de OCR
-- -----------------------------------------------------------------------------

create table public.expenses (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete restrict,
  employee_id        uuid not null,
  source             public.expense_source not null,
  status             public.expense_status not null default 'draft',
  idempotency_key    uuid not null,
  category_id        uuid,
  expense_date       date,
  merchant_name      text check (merchant_name is null or char_length(merchant_name) <= 120),
  -- Clave para comparar proveedores (minúsculas, solo letras y cifras).
  merchant_key       text generated always as (
    lower(regexp_replace(coalesce(merchant_name, ''), '[^[:alnum:]]+', '', 'g'))
  ) stored,
  merchant_tax_id    text check (merchant_tax_id is null or merchant_tax_id ~ '^[A-Z0-9]{5,20}$'),
  document_number    text check (document_number is null or char_length(document_number) <= 40),
  currency           text check (currency is null or currency ~ '^[A-Z]{3}$'),
  base_cents         bigint check (base_cents is null or base_cents >= 0),
  tax_cents          bigint check (tax_cents is null or tax_cents >= 0),
  total_cents        bigint check (total_cents is null or total_cents > 0),
  payment_method     public.payment_method,
  client_name        text check (client_name is null or char_length(client_name) <= 120),
  project_code       text check (project_code is null or char_length(project_code) <= 60),
  cost_center        text check (cost_center is null or char_length(cost_center) <= 60),
  notes              text check (notes is null or char_length(notes) <= 1000),
  -- Kilometraje en décimas de km (12,5 km = 125) y tarifa aplicada al confirmar.
  distance_km_tenths integer check (distance_km_tenths is null or distance_km_tenths between 1 and 100000),
  mileage_rate_milli integer,
  reviewed_fields    text[] not null default '{}',
  duplicate_ack      boolean not null default false,
  -- Desviaciones aceptadas al confirmar (códigos, sin datos personales).
  deviations         text[] not null default '{}',
  confirmed_at       timestamptz,
  confirmed_by       uuid references public.profiles (id) on delete set null,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, employee_id, idempotency_key),
  unique (id, company_id, employee_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (category_id, company_id) references public.expense_categories (id, company_id),
  constraint expenses_ready_complete check (
    status <> 'ready' or (
      expense_date is not null and total_cents is not null and currency is not null
      and category_id is not null and confirmed_at is not null
      and (source = 'mileage' or payment_method is not null)
    )
  )
);
create index expenses_employee_idx on public.expenses (employee_id, created_at desc);
create index expenses_company_idx on public.expenses (company_id, status, expense_date);
create index expenses_similar_idx on public.expenses (employee_id, merchant_key, expense_date, total_cents);

-- Un ticket por gasto; la huella SHA-256 es única en cada empresa (duplicado exacto).
create table public.expense_receipts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete restrict,
  employee_id  uuid not null,
  expense_id   uuid not null,
  storage_path text not null unique,
  mime_type    text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes   integer not null check (size_bytes between 1 and 10485760),
  width        integer check (width is null or width between 1 and 20000),
  height       integer check (height is null or height between 1 and 20000),
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (company_id, sha256),
  unique (expense_id),
  unique (id, company_id, employee_id),
  foreign key (expense_id, company_id, employee_id) references public.expenses (id, company_id, employee_id)
);

-- Cola de trabajos en segundo plano (de momento solo OCR de tickets).
create table public.jobs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  employee_id     uuid not null,
  kind            text not null check (kind in ('ocr_receipt')),
  dedupe_key      text not null check (char_length(dedupe_key) between 1 and 100),
  -- Solo identificadores: nunca contenido del ticket.
  payload         jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  status          public.job_status not null default 'pending',
  attempts        integer not null default 0 check (attempts >= 0),
  max_attempts    integer not null default 3 check (max_attempts between 1 and 10),
  requeues        integer not null default 0 check (requeues between 0 and 2),
  run_after       timestamptz not null default now(),
  locked_at       timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z_]{1,40}$'),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, kind, dedupe_key),
  unique (id, company_id, employee_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  constraint jobs_attempts_limit check (attempts <= max_attempts)
);
create index jobs_pending_idx on public.jobs (status, run_after) where status in ('pending', 'processing');

create table public.ocr_runs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  employee_id uuid not null,
  receipt_id  uuid not null,
  job_id      uuid not null,
  attempt     integer not null check (attempt >= 1),
  provider    text not null check (provider ~ '^[a-z0-9_-]{1,40}$'),
  status      public.ocr_status not null default 'processing',
  -- Campos normalizados con su confianza: {"total_cents": {"value": "1234", "confidence": 0.93}, …}
  result      jsonb check (result is null or (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 8192)),
  error_code  text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  unique (job_id, attempt),
  foreign key (receipt_id, company_id, employee_id) references public.expense_receipts (id, company_id, employee_id),
  foreign key (job_id, company_id, employee_id) references public.jobs (id, company_id, employee_id)
);
create index ocr_runs_receipt_idx on public.ocr_runs (receipt_id, started_at desc);

-- Historial del gasto (sin importes, proveedores ni notas: solo códigos).
create table public.expense_events (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies (id) on delete restrict,
  employee_id uuid not null,
  expense_id  uuid not null,
  action      text not null check (action in (
    'created', 'ocr_finished', 'ocr_requeued', 'confirmed', 'reopened', 'discarded', 'restored'
  )),
  detail      text check (detail is null or detail ~ '^[a-z_:,]{1,120}$'),
  actor_id    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  foreign key (expense_id, company_id, employee_id) references public.expenses (id, company_id, employee_id)
);
create index expense_events_expense_idx on public.expense_events (expense_id, id);

-- -----------------------------------------------------------------------------
-- 5. Funciones internas
-- -----------------------------------------------------------------------------

-- Campos que puede proponer el OCR.
create or replace function private.ocr_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['expense_date', 'merchant_name', 'merchant_tax_id', 'base_cents', 'tax_cents', 'total_cents',
    'currency', 'document_number'];
$$;

-- Umbral por debajo del cual un campo exige revisión explícita.
create or replace function private.ocr_confidence_threshold()
returns numeric
language sql
immutable
set search_path = ''
as $$ select 0.8::numeric $$;

-- Campos con valor propuesto y confianza baja en un resultado de OCR.
create or replace function private.ocr_low_confidence_fields(p_result jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(k order by k), '{}')
  from jsonb_each(coalesce(p_result, '{}')) as f(k, v)
  where jsonb_typeof(v) = 'object'
    and coalesce(v ->> 'value', '') <> ''
    and coalesce((v ->> 'confidence')::numeric, 0) < private.ocr_confidence_threshold();
$$;

-- Valida la forma de un resultado: solo campos conocidos, valor texto o null y
-- confianza entre 0 y 1. Rechaza cualquier otra clave (p. ej., texto completo).
create or replace function private.ocr_result_valid(p_result jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_result is not null and jsonb_typeof(p_result) = 'object' and not exists (
    select 1 from jsonb_each(p_result) as f(k, v)
    where not (k = any (private.ocr_fields()))
      or jsonb_typeof(v) <> 'object'
      or exists (select 1 from jsonb_object_keys(v) as kk where kk not in ('value', 'confidence'))
      or jsonb_typeof(v -> 'value') not in ('string', 'null')
      or char_length(coalesce(v ->> 'value', '')) > 120
      or jsonb_typeof(v -> 'confidence') <> 'number'
      or (v ->> 'confidence')::numeric not between 0 and 1
  );
$$;

create or replace function private.expense_event(p_expense uuid, p_action text, p_detail text default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.expense_events (company_id, employee_id, expense_id, action, detail, actor_id)
  select x.company_id, x.employee_id, x.id, p_action, p_detail, (select auth.uid())
  from public.expenses x where x.id = p_expense;
$$;

-- Gasto propio en borrador, bloqueado para modificarlo.
create or replace function private.own_expense_for_update(p_expense uuid)
returns public.expenses
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  x public.expenses;
begin
  select * into x from public.expenses where id = p_expense for update;
  if x.id is null or not private.is_self_employee(x.employee_id) then
    raise exception 'Gasto no encontrado' using errcode = 'P0002';
  end if;
  return x;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Operaciones (RPC)
-- -----------------------------------------------------------------------------

-- ¿Ya existe este ticket (misma huella) en la empresa? Devuelve el gasto si es
-- propio; si es de otra persona, solo que existe (sin datos de quién).
create or replace function public.find_receipt_duplicate(p_company uuid, p_sha256 text)
returns table (expense_id uuid, owner text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := private.own_employee(p_company);
begin
  if me is null then
    raise exception 'No tienes ficha de empleado en esta empresa' using errcode = 'P0002';
  end if;
  return query
    select case when r.employee_id = me then r.expense_id end,
           case when r.employee_id = me then 'own' else 'other' end
    from public.expense_receipts r
    where r.company_id = p_company and r.sha256 = lower(p_sha256);
end;
$$;

-- Registra un ticket ya subido a Storage y crea el gasto en borrador. Idempotente:
-- la misma clave o el mismo archivo devuelven el gasto existente.
create or replace function public.register_expense_receipt(
  p_company uuid,
  p_idempotency_key uuid,
  p_path text,
  p_sha256 text,
  p_mime text,
  p_size integer,
  p_enqueue_ocr boolean,
  p_width integer default null,
  p_height integer default null
)
returns table (expense_id uuid, job_id uuid, created boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.own_employee(p_company);
  existing public.expenses;
  dup public.expense_receipts;
  today date;
  path_month date;
  ext text;
  new_expense uuid;
  new_receipt uuid;
  new_job uuid;
begin
  if me is null then
    raise exception 'No tienes ficha de empleado en esta empresa' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('expense:' || me));

  select * into existing from public.expenses x
  where x.company_id = p_company and x.employee_id = me and x.idempotency_key = p_idempotency_key;
  if existing.id is not null then
    return query select existing.id, (select j.id from public.jobs j
      join public.expense_receipts r on j.dedupe_key = r.id::text
      where r.expense_id = existing.id and j.kind = 'ocr_receipt'), false;
    return;
  end if;

  select * into dup from public.expense_receipts r where r.company_id = p_company and r.sha256 = lower(p_sha256);
  if dup.id is not null then
    if dup.employee_id = me then
      return query select dup.expense_id, (select j.id from public.jobs j
        where j.company_id = p_company and j.kind = 'ocr_receipt' and j.dedupe_key = dup.id::text), false;
      return;
    end if;
    raise exception 'Este ticket ya está registrado en tu empresa' using errcode = 'P0001';
  end if;

  today := private.employee_today(me);
  if p_path !~ ('^' || p_company || '/' || me || '/[0-9]{4}/(0[1-9]|1[0-2])/' || p_idempotency_key || '\.(pdf|jpg|png)$') then
    raise exception 'Archivo no válido' using errcode = '22023';
  end if;
  path_month := to_date(split_part(p_path, '/', 3) || '-' || split_part(p_path, '/', 4) || '-01', 'YYYY-MM-DD');
  if path_month not in (date_trunc('month', today)::date, (date_trunc('month', today) - interval '1 month')::date) then
    raise exception 'Archivo no válido' using errcode = '22023';
  end if;
  ext := substring(p_path from '\.([a-z]+)$');
  if (ext, p_mime) not in (('pdf', 'application/pdf'), ('jpg', 'image/jpeg'), ('png', 'image/png'))
     or p_size not between 1 and 10485760
     or (p_mime = 'application/pdf' and (p_width is not null or p_height is not null))
     or (p_mime <> 'application/pdf' and (coalesce(p_width, 0) not between 200 and 12000
       or coalesce(p_height, 0) not between 200 and 12000))
     or lower(p_sha256) !~ '^[0-9a-f]{64}$' then
    raise exception 'Archivo no válido' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'expense-receipts' and o.name = p_path) then
    raise exception 'El archivo no se ha subido' using errcode = '22023';
  end if;

  insert into public.expenses (company_id, employee_id, source, idempotency_key, created_by)
  values (p_company, me, 'receipt', p_idempotency_key, (select auth.uid()))
  returning id into new_expense;
  insert into public.expense_receipts (company_id, employee_id, expense_id, storage_path, mime_type, size_bytes,
    width, height, sha256, created_by)
  values (p_company, me, new_expense, p_path, p_mime, p_size, p_width, p_height, lower(p_sha256), (select auth.uid()))
  returning id into new_receipt;
  perform private.expense_event(new_expense, 'created', 'receipt');

  if p_enqueue_ocr then
    insert into public.jobs (company_id, employee_id, kind, dedupe_key, payload, created_by)
    values (p_company, me, 'ocr_receipt', new_receipt::text, jsonb_build_object('receipt_id', new_receipt),
      (select auth.uid()))
    on conflict (company_id, kind, dedupe_key) do nothing
    returning id into new_job;
  end if;
  return query select new_expense, new_job, true;
end;
$$;

-- Gasto sin ticket (manual o kilometraje). Idempotente por clave.
create or replace function public.create_expense(p_company uuid, p_idempotency_key uuid, p_source public.expense_source)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := private.own_employee(p_company);
  result uuid;
begin
  if me is null then
    raise exception 'No tienes ficha de empleado en esta empresa' using errcode = 'P0002';
  end if;
  if p_source not in ('manual', 'mileage') then
    raise exception 'Los gastos con ticket se crean al subir el ticket' using errcode = '22023';
  end if;
  insert into public.expenses (company_id, employee_id, source, idempotency_key, created_by)
  values (p_company, me, p_source, p_idempotency_key, (select auth.uid()))
  on conflict (company_id, employee_id, idempotency_key) do nothing
  returning id into result;
  if result is null then
    select x.id into result from public.expenses x
    where x.company_id = p_company and x.employee_id = me and x.idempotency_key = p_idempotency_key;
  else
    perform private.expense_event(result, 'created', p_source::text);
  end if;
  return result;
end;
$$;

-- Toma un trabajo de OCR si se puede ejecutar ahora (pendiente y vencido, o
-- bloqueado hace más de 5 minutos). Devuelve la ejecución creada o nada.
create or replace function public.claim_ocr_job(p_job uuid, p_provider text)
returns table (run_id uuid, attempt integer, storage_path text, mime_type text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  j public.jobs;
  receipt public.expense_receipts;
  new_run uuid;
  run_number integer;
begin
  select * into j from public.jobs where id = p_job for update;
  if j.id is null or not private.is_self_employee(j.employee_id) then
    raise exception 'Trabajo no encontrado' using errcode = 'P0002';
  end if;
  if p_provider !~ '^[a-z0-9_-]{1,40}$' then
    raise exception 'Proveedor no válido' using errcode = '22023';
  end if;
  if j.attempts >= j.max_attempts
     or not ((j.status = 'pending' and j.run_after <= now())
       or (j.status = 'processing' and j.locked_at < now() - interval '5 minutes')) then
    return;
  end if;
  if j.status = 'processing' then
    update public.ocr_runs r set status = 'failed', error_code = 'timeout', finished_at = now()
    where r.job_id = j.id and r.status = 'processing';
  end if;
  select * into receipt from public.expense_receipts r where r.id = (j.payload ->> 'receipt_id')::uuid;
  -- Número de ejecución global del trabajo (también tras un reencolado).
  select count(*) + 1 into run_number from public.ocr_runs r where r.job_id = j.id;
  update public.jobs set status = 'processing', attempts = j.attempts + 1, locked_at = now() where id = j.id;
  insert into public.ocr_runs (company_id, employee_id, receipt_id, job_id, attempt, provider)
  values (j.company_id, j.employee_id, receipt.id, j.id, run_number, p_provider)
  returning id into new_run;
  return query select new_run, run_number, receipt.storage_path, receipt.mime_type;
end;
$$;

-- Cierra una ejecución. Si falla y quedan intentos, el trabajo vuelve a la cola
-- con espera creciente (30 s, 60 s, 120 s…); si no, queda fallido y el gasto se
-- completa a mano.
create or replace function public.finish_ocr_run(
  p_run uuid,
  p_status public.ocr_status,
  p_result jsonb default null,
  p_error_code text default null
)
returns public.ocr_status
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.ocr_runs;
  j public.jobs;
  final_status public.ocr_status := p_status;
  expense uuid;
begin
  select * into r from public.ocr_runs where id = p_run for update;
  if r.id is null or not private.is_self_employee(r.employee_id) then
    raise exception 'Ejecución no encontrada' using errcode = 'P0002';
  end if;
  if r.status <> 'processing' then
    return r.status;
  end if;
  if p_status not in ('succeeded', 'needs_review', 'failed') then
    raise exception 'Estado no válido' using errcode = '22023';
  end if;
  if p_status = 'failed' then
    if p_error_code is null or p_error_code !~ '^[a-z_]{1,40}$' then
      raise exception 'Indica el código de error' using errcode = '22023';
    end if;
  elsif not private.ocr_result_valid(p_result) then
    raise exception 'Resultado de OCR no válido' using errcode = '22023';
  elsif cardinality(private.ocr_low_confidence_fields(p_result)) > 0
     or coalesce(p_result -> 'total_cents' ->> 'value', '') = '' then
    final_status := 'needs_review';
  end if;

  update public.ocr_runs
  set status = final_status,
      result = case when final_status = 'failed' then null else p_result end,
      error_code = case when final_status = 'failed' then p_error_code end,
      finished_at = now()
  where id = r.id;

  select * into j from public.jobs where id = r.job_id for update;
  if final_status = 'failed' then
    if j.attempts < j.max_attempts then
      update public.jobs set status = 'pending', locked_at = null, last_error_code = p_error_code,
        run_after = now() + make_interval(secs => 30 * power(2, j.attempts - 1))
      where id = j.id;
    else
      update public.jobs set status = 'failed', locked_at = null, last_error_code = p_error_code where id = j.id;
    end if;
  else
    update public.jobs set status = 'succeeded', locked_at = null, last_error_code = null where id = j.id;
  end if;

  select rc.expense_id into expense from public.expense_receipts rc where rc.id = r.receipt_id;
  perform private.expense_event(expense, 'ocr_finished',
    final_status::text || coalesce(':' || case when final_status = 'failed' then p_error_code end, ''));
  return final_status;
end;
$$;

-- La persona vuelve a pedir la lectura de un ticket cuyo OCR falló (hasta 2 veces).
create or replace function public.requeue_receipt_ocr(p_expense uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  x public.expenses := private.own_expense_for_update(p_expense);
  j public.jobs;
begin
  if x.status <> 'draft' then
    raise exception 'Solo se puede releer un gasto en borrador' using errcode = 'P0001';
  end if;
  select jb.* into j from public.jobs jb
  join public.expense_receipts r on jb.company_id = r.company_id and jb.dedupe_key = r.id::text
  where r.expense_id = x.id and jb.kind = 'ocr_receipt'
  for update of jb;
  if j.id is null then
    raise exception 'Este gasto no tiene lectura automática' using errcode = 'P0001';
  end if;
  if j.status = 'failed' then
    if j.requeues >= 2 then
      raise exception 'Ya no quedan reintentos: completa los datos a mano' using errcode = 'P0001';
    end if;
    update public.jobs set status = 'pending', attempts = 0, requeues = j.requeues + 1, run_after = now(),
      last_error_code = null
    where id = j.id;
    perform private.expense_event(x.id, 'ocr_requeued');
  elsif j.status = 'pending' and j.run_after > now() then
    update public.jobs set run_after = now() where id = j.id;
  end if;
  return j.id;
end;
$$;

-- Confirmación humana: aplica las reglas de la política y marca el gasto como
-- listo. Devuelve las desviaciones aceptadas (avisos).
create or replace function public.confirm_expense(
  p_expense uuid,
  p_reviewed_fields text[],
  p_duplicate_ack boolean
)
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  x public.expenses := private.own_expense_for_update(p_expense);
  cat public.expense_categories;
  pol public.expense_policies;
  today date;
  ocr jsonb;
  low text[];
  missing text[];
  devs text[] := '{}';
  total bigint;
  ocr_total bigint;
  labels constant jsonb := '{"expense_date": "fecha", "merchant_name": "proveedor", "merchant_tax_id": "NIF",
    "base_cents": "base", "tax_cents": "impuestos", "total_cents": "total", "currency": "moneda",
    "document_number": "número de documento"}';
begin
  if x.status <> 'draft' then
    raise exception 'El gasto no está en borrador' using errcode = 'P0001';
  end if;
  today := private.employee_today(x.employee_id);
  select * into pol from public.expense_policies where company_id = x.company_id;
  select * into cat from public.expense_categories where id = x.category_id;
  if cat.id is null or cat.status <> 'active' then
    raise exception 'Elige una categoría activa' using errcode = '22023';
  end if;
  if x.expense_date is null then
    raise exception 'Indica la fecha del gasto' using errcode = '22023';
  end if;
  if x.expense_date > today then
    raise exception 'La fecha del gasto no puede ser futura' using errcode = '22023';
  end if;
  if x.expense_date < today - coalesce(pol.max_days_past, 90) then
    raise exception 'El gasto tiene más de % días: la política no admite gastos tan antiguos',
      coalesce(pol.max_days_past, 90) using errcode = '22023';
  end if;
  if x.currency is null or not (x.currency = any (coalesce(pol.allowed_currencies, '{EUR}'))) then
    raise exception 'Moneda no admitida por la política de gastos' using errcode = '22023';
  end if;

  if x.source = 'mileage' then
    if not cat.is_mileage then
      raise exception 'Elige una categoría de kilometraje' using errcode = '22023';
    end if;
    if pol.mileage_rate_milli is null then
      raise exception 'Tu empresa no ha configurado el precio por kilómetro' using errcode = '22023';
    end if;
    if x.distance_km_tenths is null then
      raise exception 'Indica los kilómetros' using errcode = '22023';
    end if;
    total := round(x.distance_km_tenths::numeric * pol.mileage_rate_milli / 100);
    if total <= 0 then
      raise exception 'El importe del kilometraje es cero' using errcode = '22023';
    end if;
  else
    if cat.is_mileage then
      raise exception 'Esta categoría es de kilometraje: crea un gasto de kilometraje' using errcode = '22023';
    end if;
    if x.source = 'manual' and coalesce(pol.receipt_required, true) then
      raise exception 'La política de gastos exige adjuntar el ticket' using errcode = '22023';
    end if;
    if x.total_cents is null then
      raise exception 'Indica el importe total' using errcode = '22023';
    end if;
    if x.payment_method is null then
      raise exception 'Indica la forma de pago' using errcode = '22023';
    end if;
    if x.source = 'receipt' and coalesce(btrim(x.merchant_name), '') = '' then
      raise exception 'Indica el proveedor' using errcode = '22023';
    end if;
    if x.tax_cents is not null and x.tax_cents > x.total_cents then
      raise exception 'Los impuestos no pueden superar el total' using errcode = '22023';
    end if;
    if x.base_cents is not null and x.tax_cents is not null and abs(x.base_cents + x.tax_cents - x.total_cents) > 1 then
      raise exception 'La base más los impuestos no coincide con el total' using errcode = '22023';
    end if;
    total := x.total_cents;
  end if;

  if cat.requires_client and coalesce(btrim(x.client_name), '') = '' then
    raise exception 'Esta categoría exige indicar el cliente' using errcode = '22023';
  end if;
  if cat.requires_project and coalesce(btrim(x.project_code), '') = '' then
    raise exception 'Esta categoría exige indicar el proyecto' using errcode = '22023';
  end if;
  if cat.requires_cost_center and coalesce(btrim(x.cost_center), '') = '' then
    raise exception 'Esta categoría exige indicar el centro de coste' using errcode = '22023';
  end if;
  if cat.requires_notes and char_length(coalesce(btrim(x.notes), '')) < 5 then
    raise exception 'Esta categoría exige una nota' using errcode = '22023';
  end if;
  if cat.max_amount_cents is not null and total > cat.max_amount_cents then
    if char_length(coalesce(btrim(x.notes), '')) < 10 then
      raise exception 'El importe supera el límite de la categoría: explica el motivo en las notas'
        using errcode = '22023';
    end if;
    devs := array_append(devs, 'over_category_limit');
  end if;

  -- Campos de baja confianza del último OCR: hay que revisarlos uno a uno.
  select o.result into ocr from public.ocr_runs o
  join public.expense_receipts rc on rc.id = o.receipt_id
  where rc.expense_id = x.id and o.status in ('succeeded', 'needs_review')
  order by o.finished_at desc limit 1;
  low := private.ocr_low_confidence_fields(ocr);
  select coalesce(array_agg(labels ->> f order by f), '{}') into missing
  from unnest(low) as f where not (f = any (coalesce(p_reviewed_fields, '{}')));
  if cardinality(missing) > 0 then
    raise exception 'Confirma que has revisado: %', array_to_string(missing, ', ') using errcode = '22023';
  end if;
  ocr_total := nullif(ocr -> 'total_cents' ->> 'value', '')::bigint;
  if ocr_total is not null and abs(ocr_total - total) > coalesce(pol.ocr_total_tolerance_cents, 0) then
    devs := array_append(devs, 'total_differs_from_ocr');
  end if;

  -- Posible duplicado (mismo proveedor, fecha, total y moneda): pide confirmación expresa.
  if x.source <> 'mileage' and x.merchant_key <> '' and exists (
    select 1 from public.expenses o
    where o.employee_id = x.employee_id and o.id <> x.id and o.status <> 'discarded'
      and o.merchant_key = x.merchant_key and o.expense_date = x.expense_date
      and o.total_cents = total and o.currency = x.currency
  ) then
    if not coalesce(p_duplicate_ack, false) then
      raise exception 'Hay otro gasto con el mismo proveedor, fecha, total y moneda: compruébalo y confirma que no es un duplicado'
        using errcode = '22023';
    end if;
    devs := array_append(devs, 'possible_duplicate_acknowledged');
  end if;

  update public.expenses
  set status = 'ready',
      total_cents = total,
      mileage_rate_milli = case when x.source = 'mileage' then pol.mileage_rate_milli end,
      reviewed_fields = coalesce(p_reviewed_fields, '{}'),
      duplicate_ack = coalesce(p_duplicate_ack, false),
      deviations = devs,
      confirmed_at = now(),
      confirmed_by = (select auth.uid())
  where id = x.id;
  perform private.expense_event(x.id, 'confirmed', nullif(array_to_string(devs, ','), ''));
  return devs;
end;
$$;

-- Volver a borrador para corregir datos (el ticket original no cambia).
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
  update public.expenses set status = 'draft', confirmed_at = null, confirmed_by = null where id = x.id;
  perform private.expense_event(x.id, 'reopened');
end;
$$;

-- Descartar (o recuperar) un borrador. No se borra nada.
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
  cross join unnest(array['read', 'manage']) as a
  where ra.company_id = p_company
    and ra.membership_id = private.current_membership_id(p_company)
    and ra.status = 'active'
    and private.is_active_window(ra.valid_from, ra.valid_to)
    and private.role_has_expense_permission(ra.role, a);
$$;

-- -----------------------------------------------------------------------------
-- 7. Integridad
-- -----------------------------------------------------------------------------

-- Solo se editan los datos de un borrador; el estado cambia mediante funciones.
create or replace function private.guard_expense()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' and new.status = old.status then
    raise exception 'Solo se pueden modificar gastos en borrador' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Una ejecución terminada no cambia.
create or replace function private.guard_ocr_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'processing' then
    raise exception 'La ejecución de OCR ya terminó' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger expenses_guard before update on public.expenses
  for each row execute function private.guard_expense();
create trigger ocr_runs_guard before update on public.ocr_runs
  for each row execute function private.guard_ocr_run();
create trigger expense_receipts_immutable before update or delete on public.expense_receipts
  for each row execute function private.prevent_mutation();
create trigger expense_events_immutable before update or delete on public.expense_events
  for each row execute function private.prevent_mutation();
create trigger expenses_no_delete before delete on public.expenses
  for each row execute function private.prevent_mutation();
create trigger ocr_runs_no_delete before delete on public.ocr_runs
  for each row execute function private.prevent_mutation();
create trigger jobs_no_delete before delete on public.jobs
  for each row execute function private.prevent_mutation();

create trigger expense_policies_updated_at before update on public.expense_policies
  for each row execute function private.set_updated_at();
create trigger expense_categories_updated_at before update on public.expense_categories
  for each row execute function private.set_updated_at();
create trigger expenses_updated_at before update on public.expenses
  for each row execute function private.set_updated_at();
create trigger jobs_updated_at before update on public.jobs
  for each row execute function private.set_updated_at();

create trigger expense_policies_keys before update on public.expense_policies
  for each row execute function private.prevent_key_change('id', 'company_id');
create trigger expense_categories_keys before update on public.expense_categories
  for each row execute function private.prevent_key_change('id', 'company_id', 'code', 'is_mileage');
create trigger expenses_keys before update on public.expenses
  for each row execute function private.prevent_key_change('id', 'company_id', 'employee_id', 'source', 'idempotency_key');
create trigger jobs_keys before update on public.jobs
  for each row execute function private.prevent_key_change('id', 'company_id', 'employee_id', 'kind', 'dedupe_key', 'payload');
create trigger ocr_runs_keys before update on public.ocr_runs
  for each row execute function private.prevent_key_change('id', 'company_id', 'employee_id', 'receipt_id', 'job_id', 'attempt', 'provider');

-- Auditoría: configuración y cada cambio de un gasto (correcciones trazables).
-- Los resultados de OCR no van a audit_log.
create trigger audit_expense_policies after insert or update on public.expense_policies
  for each row execute function private.audit_row_change('company_id');
create trigger audit_expense_categories after insert or update on public.expense_categories
  for each row execute function private.audit_row_change('company_id');
create trigger audit_expenses after insert or update on public.expenses
  for each row execute function private.audit_row_change('company_id');

-- -----------------------------------------------------------------------------
-- 8. Storage: tickets en un bucket privado
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-receipts', 'expense-receipts', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Ruta: <company_id>/<employee_id>/<año>/<mes>/<uuid>.<ext>
-- ¿Es la carpeta de la propia ficha del usuario en esa empresa?
create or replace function private.is_own_receipt_folder(p_object text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    where e.id = private.object_employee_id(p_object)
      and e.company_id = private.object_company_id(p_object)
      and private.is_self_employee(e.id)
  );
$$;

create or replace function private.can_open_expense_receipt(p_object text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.expense_receipts r
    where r.storage_path = p_object
      and r.company_id = private.object_company_id(p_object)
      and r.employee_id = private.object_employee_id(p_object)
      and private.can_read_employee_expenses(r.employee_id)
  ) or private.is_own_receipt_folder(p_object);
$$;

create policy "expense_receipts_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'expense-receipts' and private.can_open_expense_receipt(name));

create policy "expense_receipts_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expense-receipts'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]{4}/(0[1-9]|1[0-2])/[0-9a-f-]{36}\.(pdf|jpg|png)$'
    and private.is_own_receipt_folder(name)
  );

-- -----------------------------------------------------------------------------
-- 9. Privilegios
-- -----------------------------------------------------------------------------

revoke all on function
  private.role_has_expense_permission(public.app_role, text),
  private.has_expense_permission(uuid, text, uuid, uuid),
  private.employee_expense_permission(uuid, text),
  private.can_read_employee_expenses(uuid),
  private.ocr_fields(),
  private.ocr_confidence_threshold(),
  private.ocr_low_confidence_fields(jsonb),
  private.ocr_result_valid(jsonb),
  private.expense_event(uuid, text, text),
  private.own_expense_for_update(uuid),
  private.guard_expense(),
  private.guard_ocr_run(),
  private.is_own_receipt_folder(text),
  private.can_open_expense_receipt(text)
from public;

grant execute on function
  private.role_has_expense_permission(public.app_role, text),
  private.has_expense_permission(uuid, text, uuid, uuid),
  private.employee_expense_permission(uuid, text),
  private.can_read_employee_expenses(uuid),
  private.is_own_receipt_folder(text),
  private.can_open_expense_receipt(text)
to authenticated, service_role;

revoke all on function
  public.find_receipt_duplicate(uuid, text),
  public.register_expense_receipt(uuid, uuid, text, text, text, integer, boolean, integer, integer),
  public.create_expense(uuid, uuid, public.expense_source),
  public.claim_ocr_job(uuid, text),
  public.finish_ocr_run(uuid, public.ocr_status, jsonb, text),
  public.requeue_receipt_ocr(uuid),
  public.confirm_expense(uuid, text[], boolean),
  public.reopen_expense(uuid),
  public.set_expense_discarded(uuid, boolean),
  public.my_expense_access(uuid)
from public, anon, authenticated;

grant execute on function
  public.find_receipt_duplicate(uuid, text),
  public.register_expense_receipt(uuid, uuid, text, text, text, integer, boolean, integer, integer),
  public.create_expense(uuid, uuid, public.expense_source),
  public.claim_ocr_job(uuid, text),
  public.finish_ocr_run(uuid, public.ocr_status, jsonb, text),
  public.requeue_receipt_ocr(uuid),
  public.confirm_expense(uuid, text[], boolean),
  public.reopen_expense(uuid),
  public.set_expense_discarded(uuid, boolean),
  public.my_expense_access(uuid)
to authenticated, service_role;

revoke all on public.expense_policies, public.expense_categories, public.expenses, public.expense_receipts,
  public.jobs, public.ocr_runs, public.expense_events
from anon, authenticated;

grant select on public.expense_policies, public.expense_categories, public.expenses, public.expense_receipts,
  public.jobs, public.ocr_runs, public.expense_events
to authenticated;

-- Configuración: escritura directa con RLS (gestión de gastos).
grant insert (company_id, max_days_past, default_currency, allowed_currencies, receipt_required,
  mileage_rate_milli, ocr_total_tolerance_cents, legal_reference) on public.expense_policies to authenticated;
grant update (max_days_past, default_currency, allowed_currencies, receipt_required, mileage_rate_milli,
  ocr_total_tolerance_cents, legal_reference) on public.expense_policies to authenticated;
grant insert (company_id, code, name, is_mileage, max_amount_cents, requires_client, requires_project,
  requires_cost_center, requires_notes) on public.expense_categories to authenticated;
grant update (name, max_amount_cents, requires_client, requires_project, requires_cost_center, requires_notes, status)
  on public.expense_categories to authenticated;
-- Borrador: la persona edita sus datos; estado, tickets, trabajos y OCR solo mediante funciones.
grant update (category_id, expense_date, merchant_name, merchant_tax_id, document_number, currency, base_cents,
  tax_cents, total_cents, payment_method, client_name, project_code, cost_center, notes, distance_km_tenths)
  on public.expenses to authenticated;

-- -----------------------------------------------------------------------------
-- 10. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.expense_policies enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_receipts enable row level security;
alter table public.jobs enable row level security;
alter table public.ocr_runs enable row level security;
alter table public.expense_events enable row level security;

create policy "expense_policies_select" on public.expense_policies
  for select to authenticated
  using (private.is_company_member(company_id) or private.has_expense_permission(company_id, 'manage'));
create policy "expense_policies_insert" on public.expense_policies
  for insert to authenticated with check (private.has_expense_permission(company_id, 'manage'));
create policy "expense_policies_update" on public.expense_policies
  for update to authenticated
  using (private.has_expense_permission(company_id, 'manage'))
  with check (private.has_expense_permission(company_id, 'manage'));

create policy "expense_categories_select" on public.expense_categories
  for select to authenticated
  using (private.is_company_member(company_id) or private.has_expense_permission(company_id, 'manage'));
create policy "expense_categories_insert" on public.expense_categories
  for insert to authenticated with check (private.has_expense_permission(company_id, 'manage'));
create policy "expense_categories_update" on public.expense_categories
  for update to authenticated
  using (private.has_expense_permission(company_id, 'manage'))
  with check (private.has_expense_permission(company_id, 'manage'));

create policy "expenses_select" on public.expenses
  for select to authenticated using (private.can_read_employee_expenses(employee_id));
create policy "expenses_update" on public.expenses
  for update to authenticated
  using (status = 'draft' and private.is_self_employee(employee_id))
  with check (status = 'draft' and private.is_self_employee(employee_id));

create policy "expense_receipts_select" on public.expense_receipts
  for select to authenticated using (private.can_read_employee_expenses(employee_id));
create policy "jobs_select" on public.jobs
  for select to authenticated using (private.can_read_employee_expenses(employee_id));
create policy "ocr_runs_select" on public.ocr_runs
  for select to authenticated using (private.can_read_employee_expenses(employee_id));
create policy "expense_events_select" on public.expense_events
  for select to authenticated using (private.can_read_employee_expenses(employee_id));
