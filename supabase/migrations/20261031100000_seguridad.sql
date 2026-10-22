-- =============================================================================
-- Endurecimiento de seguridad y privacidad (docs/SEGURIDAD.md, docs/PRIVACIDAD.md).
--
--  1. Privilegios: secuencias y privilegios por defecto sin anon/authenticated;
--     funciones de trigger sin execute público.
--  2. MFA por rol (ADR-053): los permisos de company_admin, hr, accounting y
--     auditor, y la administración de grupo y de plataforma, solo cuentan con
--     sesión aal2. Sin MFA la persona conserva lo suyo (fichar, ausencias…).
--  3. Límites de frecuencia por persona y acción.
--  4. Acceso de soporte temporal (≤ 24 h), concedido por la empresa y auditado;
--     la plataforma deja de ver perfiles de toda la base.
--  5. Evidencias de fichaje (coordenadas y selfie): fuera de la lectura
--     general; solo la persona, su manager y RR. HH. con gestión, con registro.
--  6. Retención: catálogo, retenciones legales y ejecución simulable.
--  7. Derechos de las personas (acceso, rectificación, supresión, limitación,
--     portabilidad, oposición) con revisión humana y bloqueos legales.
--
-- Reversión: supabase/rollbacks/20261031100000_seguridad.down.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Privilegios
-- -----------------------------------------------------------------------------

-- Las secuencias de identidad no necesitan privilegios para insertar; con ellos
-- se podría leer su valor (recuentos globales de todas las empresas).
revoke all on all sequences in schema public from anon, authenticated;
-- Lo que se cree en adelante no queda expuesto por defecto: cada migración
-- concede explícitamente lo que necesita.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Revisado: private.handle_new_user y handle_user_email_change (funciones de
-- trigger: no se pueden invocar directamente) y private.current_request_id
-- (sin privilegios) conservan su execute por defecto; anon no tiene USAGE sobre
-- el esquema private.

-- -----------------------------------------------------------------------------
-- 2. MFA por rol
-- -----------------------------------------------------------------------------

-- Ajuste de plataforma (una fila). Solo se cambia con una migración o por el
-- propietario de la base de datos siguiendo docs/RUNBOOKS.md (degradación).
create table private.security_settings (
  id           smallint primary key default 1 check (id = 1),
  mfa_enforced boolean not null default true,
  updated_at   timestamptz not null default now()
);
insert into private.security_settings default values;

-- ¿Sesión con segundo factor verificado? (aal2, firmado por Supabase Auth). No
-- es un permiso: los permisos siguen viviendo en tablas (regla 3, ADR-053).
create or replace function private.strong_auth()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not coalesce((select s.mfa_enforced from private.security_settings s where s.id = 1), true)
    or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') = 'aal2';
$$;

-- Roles con acceso amplio a datos de otras personas: exigen MFA.
create or replace function private.role_requires_mfa(p_role public.app_role)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_role in ('company_admin', 'hr', 'accounting', 'auditor');
$$;

create or replace function private.role_auth_ok(p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not private.role_requires_mfa(p_role) or private.strong_auth();
$$;

-- Estado para la interfaz: ¿tiene roles que exigen MFA y la sesión aún no lo cumple?
create or replace function public.my_mfa_status()
returns table (required boolean, satisfied boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with req as (
    select exists (
      select 1 from public.role_assignments ra
      join public.company_memberships m on m.id = ra.membership_id
      where m.user_id = (select auth.uid()) and ra.status = 'active'
        and private.is_active_window(ra.valid_from, ra.valid_to)
        and private.is_active_window(m.valid_from, m.valid_to)
        and private.role_requires_mfa(ra.role)
    )
    or exists (select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()))
    or exists (select 1 from public.group_admins ga where ga.user_id = (select auth.uid())
      and ga.status = 'active' and private.is_active_window(ga.valid_from, ga.valid_to)) as r
  )
  select req.r, private.strong_auth() from req;
$$;

CREATE OR REPLACE FUNCTION private.is_global_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = (select auth.uid()) and private.strong_auth()
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_group_admin(p_group uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.group_admins ga
    join public.groups g on g.id = ga.group_id
    where ga.group_id = p_group
      and ga.user_id = (select auth.uid())
      and ga.status = 'active'
      and private.is_active_window(ga.valid_from, ga.valid_to)
      and g.status = 'active'
      and private.strong_auth()
  );
$function$;

CREATE OR REPLACE FUNCTION private.has_permission(p_company uuid, p_permission private.app_permission, p_work_center uuid DEFAULT NULL::uuid, p_team uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_company is not null and (
    private.is_group_admin_of_company(p_company)
    or exists (
      select 1
      from public.role_assignments ra
      where ra.company_id = p_company
        and ra.membership_id = private.current_membership_id(p_company)
        and ra.status = 'active'
        and private.is_active_window(ra.valid_from, ra.valid_to)
        and private.role_auth_ok(ra.role)
        and private.role_has_permission(ra.role, p_permission)
        and (
          ra.scope_type = 'company'
          or (ra.scope_type = 'work_center' and ra.work_center_id = p_work_center)
          or (ra.scope_type = 'team' and ra.team_id = p_team)
        )
    )
  );
$function$;

CREATE OR REPLACE FUNCTION private.has_company_role(p_company uuid, p_roles app_role[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.role_assignments ra
    where ra.company_id = p_company
      and ra.membership_id = private.current_membership_id(p_company)
      and ra.status = 'active'
      and private.is_active_window(ra.valid_from, ra.valid_to)
      and private.role_auth_ok(ra.role)
      and ra.scope_type = 'company'
      and ra.role = any (p_roles)
  );
$function$;

CREATE OR REPLACE FUNCTION public.my_company_permissions(p_company uuid)
 RETURNS TABLE(permission text, scope_type text, work_center_id uuid, team_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and private.role_auth_ok(ra.role)
    and private.role_has_permission(ra.role, p);
$function$;

CREATE OR REPLACE FUNCTION private.has_schedule_permission(p_company uuid, p_action text, p_work_center uuid DEFAULT NULL::uuid, p_team uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_company is not null and (
    private.is_group_admin_of_company(p_company)
    or exists (
      select 1
      from public.role_assignments ra
      where ra.company_id = p_company
        and ra.membership_id = private.current_membership_id(p_company)
        and ra.status = 'active'
        and private.is_active_window(ra.valid_from, ra.valid_to)
        and private.role_auth_ok(ra.role)
        and private.role_has_schedule_permission(ra.role, p_action)
        and (
          ra.scope_type = 'company'
          or (ra.scope_type = 'work_center' and ra.work_center_id = p_work_center)
          or (ra.scope_type = 'team' and ra.team_id = p_team)
        )
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.my_schedule_access(p_company uuid)
 RETURNS TABLE(action text, scope_type text, work_center_id uuid, team_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and private.role_auth_ok(ra.role)
    and private.role_has_schedule_permission(ra.role, a);
$function$;

CREATE OR REPLACE FUNCTION private.has_time_permission(p_company uuid, p_action text, p_work_center uuid DEFAULT NULL::uuid, p_team uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_company is not null and (
    private.is_group_admin_of_company(p_company)
    or exists (
      select 1
      from public.role_assignments ra
      where ra.company_id = p_company
        and ra.membership_id = private.current_membership_id(p_company)
        and ra.status = 'active'
        and private.is_active_window(ra.valid_from, ra.valid_to)
        and private.role_auth_ok(ra.role)
        and private.role_has_time_permission(ra.role, p_action)
        and (
          ra.scope_type = 'company'
          or (ra.scope_type = 'work_center' and ra.work_center_id = p_work_center)
          or (ra.scope_type = 'team' and ra.team_id = p_team)
        )
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.my_time_access(p_company uuid)
 RETURNS TABLE(action text, scope_type text, work_center_id uuid, team_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and private.role_auth_ok(ra.role)
    and private.role_has_time_permission(ra.role, a);
$function$;

CREATE OR REPLACE FUNCTION private.has_absence_permission(p_company uuid, p_action text, p_work_center uuid DEFAULT NULL::uuid, p_team uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_company is not null and (
    (p_action <> 'attachments' and private.is_group_admin_of_company(p_company))
    or exists (
      select 1
      from public.role_assignments ra
      where ra.company_id = p_company
        and ra.membership_id = private.current_membership_id(p_company)
        and ra.status = 'active'
        and private.is_active_window(ra.valid_from, ra.valid_to)
        and private.role_auth_ok(ra.role)
        and private.role_has_absence_permission(ra.role, p_action)
        and (
          ra.scope_type = 'company'
          or (ra.scope_type = 'work_center' and ra.work_center_id = p_work_center)
          or (ra.scope_type = 'team' and ra.team_id = p_team)
        )
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.my_absence_access(p_company uuid)
 RETURNS TABLE(action text, scope_type text, work_center_id uuid, team_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and private.role_auth_ok(ra.role)
    and private.role_has_absence_permission(ra.role, a);
$function$;

CREATE OR REPLACE FUNCTION private.has_expense_permission(p_company uuid, p_action text, p_work_center uuid DEFAULT NULL::uuid, p_team uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_company is not null and (
    (p_action = 'manage' and private.is_group_admin_of_company(p_company))
    or exists (
      select 1
      from public.role_assignments ra
      where ra.company_id = p_company
        and ra.membership_id = private.current_membership_id(p_company)
        and ra.status = 'active'
        and private.is_active_window(ra.valid_from, ra.valid_to)
        and private.role_auth_ok(ra.role)
        and private.role_has_expense_permission(ra.role, p_action)
        and (
          ra.scope_type = 'company'
          or (ra.scope_type = 'work_center' and ra.work_center_id = p_work_center)
          or (ra.scope_type = 'team' and ra.team_id = p_team)
        )
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.my_expense_access(p_company uuid)
 RETURNS TABLE(action text, scope_type text, work_center_id uuid, team_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and private.role_auth_ok(ra.role)
    and private.role_has_expense_permission(ra.role, a);
$function$;

-- -----------------------------------------------------------------------------
-- 3. Límites de frecuencia
-- -----------------------------------------------------------------------------

-- Contadores por persona, acción y ventana fija. Solo recuentos (sin contenido).
create table private.rate_limit_hits (
  user_id      uuid not null,
  bucket       text not null check (bucket ~ '^[a-z_]{1,40}$'),
  window_start timestamptz not null,
  hits         integer not null default 1,
  primary key (user_id, bucket, window_start)
);

create or replace function private.hit_rate_limit(p_bucket text, p_limit integer, p_window interval)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  secs double precision := extract(epoch from p_window);
  win timestamptz := to_timestamp(floor(extract(epoch from now()) / secs) * secs);
  n integer;
begin
  if (select auth.uid()) is null then
    return; -- Tareas de sistema: sin límite por persona.
  end if;
  insert into private.rate_limit_hits (user_id, bucket, window_start)
  values ((select auth.uid()), p_bucket, win)
  on conflict (user_id, bucket, window_start) do update set hits = private.rate_limit_hits.hits + 1
  returning hits into n;
  if n > p_limit then
    raise exception 'Demasiadas solicitudes seguidas: espera unos minutos y vuelve a intentarlo'
      using errcode = 'P0001';
  end if;
end;
$$;

-- Límites de la aplicación (las Server Actions lo llaman antes de subir,
-- exportar o descargar). Los límites viven aquí, no en el cliente.
create or replace function public.check_rate_limit(p_action text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  case p_action
    when 'upload' then perform private.hit_rate_limit('upload', 60, interval '1 hour');
    when 'export' then perform private.hit_rate_limit('export', 30, interval '1 hour');
    when 'download' then perform private.hit_rate_limit('download', 120, interval '1 hour');
    when 'mfa' then perform private.hit_rate_limit('mfa', 10, interval '15 minutes');
    else raise exception 'Acción no válida' using errcode = '22023';
  end case;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Acceso de soporte temporal y auditado
-- -----------------------------------------------------------------------------

create table public.support_access_grants (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  support_user_id uuid not null references public.profiles (id) on delete restrict,
  granted_by      uuid not null references public.profiles (id) on delete restrict,
  reason          text not null check (char_length(btrim(reason)) between 10 and 500),
  starts_at       timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  revoked_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (id, company_id),
  constraint support_access_window check (expires_at > starts_at and expires_at <= starts_at + interval '24 hours'),
  constraint support_access_not_self check (support_user_id <> granted_by)
);
create index support_access_grants_company_idx on public.support_access_grants (company_id, expires_at desc);
create index support_access_grants_user_idx on public.support_access_grants (support_user_id, expires_at desc);

-- ¿Tiene el usuario actual (plataforma, con MFA) un acceso de soporte vigente a la empresa?
create or replace function private.has_support_access(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_company is not null and private.is_global_admin() and exists (
    select 1 from public.support_access_grants g
    where g.company_id = p_company and g.support_user_id = (select auth.uid())
      and g.revoked_at is null and now() >= g.starts_at and now() < g.expires_at
  );
$$;

-- La plataforma solo ve perfiles de administración (plataforma y grupos) y de
-- empresas con acceso de soporte vigente; no la base completa de personas.
create or replace function private.platform_can_read_profile(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_global_admin() and (
    exists (select 1 from public.platform_admins pa where pa.user_id = p_user)
    or exists (select 1 from public.group_admins ga where ga.user_id = p_user)
    or exists (
      select 1 from public.company_memberships m
      where m.user_id = p_user and private.has_support_access(m.company_id)
    )
  );
$$;

-- Lo concede la administración de la empresa (o de su grupo), con MFA, a una
-- persona de la plataforma, por un motivo y como mucho 24 horas.
create or replace function public.grant_support_access(p_company uuid, p_support_user uuid, p_reason text,
  p_hours integer default 4)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  created uuid;
begin
  if not (private.has_company_role(p_company, '{company_admin}') or private.is_group_admin_of_company(p_company)) then
    raise exception 'Solo la administración de la empresa concede acceso de soporte' using errcode = '42501';
  end if;
  if not exists (select 1 from public.platform_admins pa where pa.user_id = p_support_user) then
    raise exception 'El acceso de soporte solo se concede a personas de la plataforma' using errcode = 'P0001';
  end if;
  if p_hours is null or p_hours not between 1 and 24 then
    raise exception 'La duración es de 1 a 24 horas' using errcode = '22023';
  end if;
  perform private.hit_rate_limit('support_grant', 10, interval '1 day');
  insert into public.support_access_grants (company_id, support_user_id, granted_by, reason, expires_at)
  values (p_company, p_support_user, (select auth.uid()), btrim(p_reason), now() + make_interval(hours => p_hours))
  returning id into created;
  return created;
end;
$$;

-- Personas de soporte (plataforma) que la administración de una empresa puede
-- elegir al conceder acceso. Solo nombre: sin correo ni otros datos.
create or replace function public.support_staff()
returns table (user_id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select pa.user_id, p.full_name
  from public.platform_admins pa join public.profiles p on p.id = pa.user_id
  where exists (
    select 1 from public.company_memberships m
    where m.user_id = (select auth.uid()) and private.has_company_role(m.company_id, '{company_admin}')
  ) or exists (
    select 1 from public.group_admins ga where ga.user_id = (select auth.uid()) and private.is_group_admin(ga.group_id)
  )
  order by p.full_name;
$$;

-- Lo revoca quien administra la empresa o la propia persona de soporte.
create or replace function public.revoke_support_access(p_grant uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  g public.support_access_grants;
begin
  select * into g from public.support_access_grants where id = p_grant for update;
  if g.id is null or not (g.support_user_id = (select auth.uid())
      or private.has_company_role(g.company_id, '{company_admin}') or private.is_group_admin_of_company(g.company_id)) then
    raise exception 'Acceso de soporte no encontrado' using errcode = 'P0002';
  end if;
  if g.revoked_at is null and g.expires_at > now() then
    update public.support_access_grants set revoked_at = now(), revoked_by = (select auth.uid()) where id = g.id;
  end if;
end;
$$;

create or replace function private.guard_support_access()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'revoked_at' - 'revoked_by') is distinct from (to_jsonb(old) - 'revoked_at' - 'revoked_by')
     or old.revoked_at is not null then
    raise exception 'Un acceso de soporte no se modifica; solo se revoca' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger support_access_grants_guard before update on public.support_access_grants
  for each row execute function private.guard_support_access();
create trigger support_access_grants_no_delete before delete on public.support_access_grants
  for each row execute function private.prevent_mutation();
create trigger support_access_grants_keys before update on public.support_access_grants
  for each row execute function private.prevent_key_change('id', 'company_id', 'support_user_id', 'granted_by');
create trigger audit_events_support_access_grants after insert or update on public.support_access_grants
  for each row execute function private.audit_event_row('company_id', '');

-- Lectura de soporte (solo lectura) mientras el acceso está vigente.
drop policy "employees_select" on public.employees;
create policy "employees_select" on public.employees
  for select to authenticated
  using (
    private.is_self_employee(id)
    or private.has_permission(company_id, 'employees.read', work_center_id, team_id)
    or private.manages_employee(id)
    or private.has_support_access(company_id)
  );
drop policy "memberships_select" on public.company_memberships;
create policy "memberships_select" on public.company_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_permission(company_id, 'members.read')
    or private.manages_membership(id)
    or private.has_support_access(company_id)
  );
drop policy "role_assignments_select" on public.role_assignments;
create policy "role_assignments_select" on public.role_assignments
  for select to authenticated
  using (
    private.is_own_membership(membership_id)
    or private.has_permission(company_id, 'members.read')
    or private.has_support_access(company_id)
  );
drop policy "audit_events_select" on public.audit_events;
create policy "audit_events_select" on public.audit_events
  for select to authenticated
  using (
    (company_id is not null and (private.has_permission(company_id, 'audit.read') or private.has_support_access(company_id)))
    or (company_id is null and group_id is not null and private.is_group_admin(group_id))
  );
drop policy "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.platform_can_read_profile(id)
    or private.can_read_user(id)
    or private.manages_user(id)
  );

-- -----------------------------------------------------------------------------
-- 5. Evidencias de fichaje (ubicación y selfie)
-- -----------------------------------------------------------------------------

revoke select on public.punches from authenticated;
grant select (id, company_id, employee_id, time_entry_id, kind, server_at, device_at, time_zone, source, device_id,
  kiosk_device_id, idempotency_key, location_status, selfie_purged_at, created_by, created_at)
  on public.punches to authenticated;

-- La persona, su manager vigente o RR. HH. con gestión de tiempo en su ámbito
-- (no auditoría ni lectura general).
create or replace function private.can_view_punch_evidence(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_self_employee(p_employee)
    or private.manages_employee(p_employee)
    or private.employee_time_permission(p_employee, 'manage');
$$;

-- Consulta de la evidencia de un fichaje: queda registrada en audit_events.
create or replace function public.punch_evidence(p_punch uuid)
returns table (location_status text, latitude numeric, longitude numeric, accuracy_m integer, selfie_path text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.punches;
begin
  select * into p from public.punches where id = p_punch;
  if p.id is null or not private.can_view_punch_evidence(p.employee_id) then
    raise exception 'Fichaje no encontrado' using errcode = 'P0002';
  end if;
  perform private.hit_rate_limit('evidence', 120, interval '1 hour');
  insert into public.audit_events (actor_id, company_id, group_id, entity, entity_id, action, changed_fields)
  select (select auth.uid()), p.company_id, c.group_id, 'punches', p.id::text, 'sensitive_read',
    array_remove(array[case when p.latitude is not null then 'location' end,
      case when p.selfie_path is not null and p.selfie_purged_at is null then 'selfie' end], null)
  from public.companies c where c.id = p.company_id;
  return query select p.location_status::text, p.latitude, p.longitude, p.accuracy_m,
    case when p.selfie_purged_at is null then p.selfie_path end;
end;
$$;

-- Justificantes de ausencia (documentos sensibles): abrir uno queda registrado.
create or replace function public.open_absence_attachment(p_attachment uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.absence_attachments;
begin
  select * into a from public.absence_attachments where id = p_attachment;
  if a.id is null or not private.can_open_absence_attachment(a.storage_path) then
    raise exception 'Justificante no encontrado' using errcode = 'P0002';
  end if;
  insert into public.audit_events (actor_id, company_id, group_id, entity, entity_id, action, changed_fields)
  select (select auth.uid()), a.company_id, c.group_id, 'absence_attachments', a.id::text, 'sensitive_read',
    array['document']
  from public.companies c where c.id = a.company_id;
  return a.storage_path;
end;
$$;

drop policy "punch_selfies_select" on storage.objects;
create policy "punch_selfies_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'punch-selfies'
    and private.can_view_punch_evidence(private.object_employee_id(name))
    and exists (
      select 1 from public.employees e
      where e.id = private.object_employee_id(name) and e.company_id = private.object_company_id(name)
    )
  );

alter table public.audit_events drop constraint audit_events_action_check;
alter table public.audit_events add constraint audit_events_action_check check (action in (
  'create', 'update', 'deactivate', 'reactivate', 'terminate', 'export', 'import', 'publish',
  'status_change', 'request_export', 'download', 'sensitive_read'
));

-- -----------------------------------------------------------------------------
-- 6. Retención
-- -----------------------------------------------------------------------------

-- Quién gestiona privacidad en la empresa: gestión de personas con ámbito de
-- empresa (RR. HH. de empresa, administración de empresa o de grupo), con MFA.
create or replace function private.can_handle_privacy(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_company, 'employees.manage');
$$;

-- Retención legal (litigio, inspección, requerimiento): bloquea la retención
-- automática y las supresiones de la persona (o de toda la empresa).
create table public.legal_holds (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete restrict,
  employee_id uuid,
  category    text not null check (category in ('all', 'time', 'absences', 'expenses', 'notifications')),
  reason      text not null check (char_length(btrim(reason)) between 10 and 500),
  created_by  uuid not null references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references public.profiles (id) on delete set null,
  unique (id, company_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);
create index legal_holds_company_idx on public.legal_holds (company_id, released_at);

create or replace function private.has_legal_hold(p_company uuid, p_employee uuid, p_category text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.legal_holds h
    where h.company_id = p_company and h.released_at is null
      and (h.employee_id is null or h.employee_id = p_employee)
      and h.category in ('all', p_category)
  );
$$;

create or replace function public.place_legal_hold(p_company uuid, p_category text, p_reason text,
  p_employee uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  created uuid;
begin
  if not private.can_handle_privacy(p_company) then
    raise exception 'No tienes permiso para gestionar retenciones legales' using errcode = '42501';
  end if;
  insert into public.legal_holds (company_id, employee_id, category, reason, created_by)
  values (p_company, p_employee, p_category, btrim(p_reason), (select auth.uid()))
  returning id into created;
  return created;
end;
$$;

create or replace function public.release_legal_hold(p_hold uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  h public.legal_holds;
begin
  select * into h from public.legal_holds where id = p_hold for update;
  if h.id is null or not private.can_handle_privacy(h.company_id) then
    raise exception 'Retención no encontrada' using errcode = 'P0002';
  end if;
  if h.released_at is null then
    update public.legal_holds set released_at = now(), released_by = (select auth.uid()) where id = h.id;
  end if;
end;
$$;

create or replace function private.guard_legal_hold()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'released_at' - 'released_by') is distinct from (to_jsonb(old) - 'released_at' - 'released_by')
     or old.released_at is not null then
    raise exception 'Una retención legal no se modifica; solo se levanta' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger legal_holds_guard before update on public.legal_holds
  for each row execute function private.guard_legal_hold();
create trigger legal_holds_no_delete before delete on public.legal_holds
  for each row execute function private.prevent_mutation();
create trigger legal_holds_keys before update on public.legal_holds
  for each row execute function private.prevent_key_change('id', 'company_id', 'employee_id', 'created_by');
create trigger audit_events_legal_holds after insert or update on public.legal_holds
  for each row execute function private.audit_event_row('company_id', '');

-- Matriz de retención ejecutable (la completa, con plazos legales pendientes,
-- está en docs/PRIVACIDAD.md). automatic = la tarea programada la aplica.
create or replace function public.retention_catalog()
returns table (category text, data text, keep text, action text, automatic boolean)
language sql
immutable
set search_path = ''
as $$
  values
    ('selfies', 'Selfies de fichaje', '30 días', 'Borrado del archivo', true),
    ('ocr_raw', 'Lectura OCR de tickets', '90 días desde que el gasto se confirma o descarta', 'Se conservan solo las confianzas', true),
    ('notifications', 'Avisos leídos y entregas de correo', '12 meses', 'Borrado', true),
    ('kiosk_attempts', 'Intentos en el terminal', '90 días', 'Borrado', true),
    ('rate_limits', 'Contadores de frecuencia', '2 días', 'Borrado', true),
    ('job_runs', 'Registro de tareas programadas', '90 días', 'Borrado', true),
    ('report_exports', 'Archivos exportados', '7 días', 'Borrado del archivo (el registro se conserva)', true),
    ('time_records', 'Registro de jornada', 'Mínimo 4 años (art. 34.9 ET)', 'Revisión manual: pendiente de decisión', false),
    ('expenses', 'Gastos y tickets', 'Plazo contable y fiscal (pendiente de validar)', 'Revisión manual: pendiente de decisión', false),
    ('absence_documents', 'Justificantes de ausencias', 'Pendiente de validar', 'Revisión manual: pendiente de decisión', false),
    ('audit', 'Auditoría', 'Pendiente de validar', 'Se conserva', false);
$$;

create table private.retention_runs (
  id      bigint generated always as identity primary key,
  mode    text not null check (mode in ('simulate', 'execute')),
  run_at  timestamptz not null default now(),
  results jsonb not null
);

-- Las tablas inmutables solo admiten borrar filas caducadas dentro de una
-- ejecución de retención (marca de transacción y rol propietario, nunca la API).
create or replace function private.retention_delete_allowed(p_table text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_setting('app.retention_run', true) = 'on'
    and current_user not in ('anon', 'authenticated')
    and p_table in ('notifications', 'email_deliveries', 'email_delivery_events');
$$;

create or replace function private.prevent_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' and private.retention_delete_allowed(tg_table_name) then
    return old;
  end if;
  raise exception 'La tabla % es inmutable: no se permite %', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$function$;

create or replace function private.guard_ocr_run()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- Retención: solo se puede vaciar la lectura (result) de una ejecución terminada.
  if current_setting('app.retention_run', true) = 'on' and current_user not in ('anon', 'authenticated')
     and (to_jsonb(new) - 'result') = (to_jsonb(old) - 'result') then
    return new;
  end if;
  if old.status <> 'processing' then
    raise exception 'La ejecución de OCR ya terminó' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

-- Ejecuta (o simula) la retención automática. Simular no cambia nada y
-- devuelve lo que se haría; ejecutar respeta las retenciones legales. Solo la
-- tarea programada (service_role). Las categorías no automáticas solo se cuentan.
create or replace function public.run_retention(p_mode text default 'simulate', p_now timestamptz default now())
returns table (category text, affected bigint, held bigint, executed boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  exec boolean := p_mode = 'execute';
  n bigint;
  h bigint;
  results jsonb := '{}';
begin
  if p_mode not in ('simulate', 'execute') then
    raise exception 'Modo no válido' using errcode = '22023';
  end if;
  perform set_config('app.retention_run', 'on', true);

  -- Lectura OCR: 90 días desde que el gasto dejó de ser borrador.
  select count(*) filter (where not private.has_legal_hold(r.company_id, r.employee_id, 'expenses')),
         count(*) filter (where private.has_legal_hold(r.company_id, r.employee_id, 'expenses'))
    into n, h
  from public.ocr_runs r
  join public.expense_receipts er on er.id = r.receipt_id
  join public.expenses x on x.id = er.expense_id
  where r.result is not null and r.status <> 'processing' and x.status <> 'draft'
    and coalesce(x.confirmed_at, x.updated_at) < p_now - interval '90 days'
    and exists (select 1 from jsonb_each(r.result) e where e.value ? 'value');
  if exec and n > 0 then
    update public.ocr_runs r
    set result = (select jsonb_object_agg(e.key, jsonb_build_object('confidence', e.value -> 'confidence'))
                  from jsonb_each(r.result) e)
    from public.expense_receipts er, public.expenses x
    where er.id = r.receipt_id and x.id = er.expense_id
      and r.result is not null and r.status <> 'processing' and x.status <> 'draft'
      and coalesce(x.confirmed_at, x.updated_at) < p_now - interval '90 days'
      and exists (select 1 from jsonb_each(r.result) e where e.value ? 'value')
      and not private.has_legal_hold(r.company_id, r.employee_id, 'expenses');
  end if;
  category := 'ocr_raw'; affected := n; held := h; executed := exec; return next;
  results := results || jsonb_build_object('ocr_raw', jsonb_build_object('affected', n, 'held', h));

  -- Avisos leídos de más de 12 meses, con sus entregas de correo y eventos.
  if to_regclass('pg_temp.retention_notifications') is null then
    create temporary table retention_notifications (id uuid primary key) on commit drop;
  end if;
  truncate pg_temp.retention_notifications;
  insert into pg_temp.retention_notifications
  select nt.id from public.notifications nt
  where nt.created_at < p_now - interval '12 months' and nt.read_at is not null
    and not private.has_legal_hold(nt.company_id, null, 'notifications');
  select count(*) into n from pg_temp.retention_notifications;
  select count(*) into h from public.notifications nt
  where nt.created_at < p_now - interval '12 months' and nt.read_at is not null
    and private.has_legal_hold(nt.company_id, null, 'notifications');
  if exec and n > 0 then
    delete from public.email_delivery_events ev using public.email_deliveries d
    where ev.delivery_id = d.id and d.notification_id in (select id from pg_temp.retention_notifications);
    delete from public.email_deliveries d where d.notification_id in (select id from pg_temp.retention_notifications);
    delete from public.notifications nt where nt.id in (select id from pg_temp.retention_notifications);
  end if;
  category := 'notifications'; affected := n; held := h; executed := exec; return next;
  results := results || jsonb_build_object('notifications', jsonb_build_object('affected', n, 'held', h));

  -- Intentos del terminal (90 días), contadores (2 días) y registro de tareas (90 días).
  select count(*) into n from public.kiosk_attempts a where a.created_at < p_now - interval '90 days';
  if exec and n > 0 then
    delete from public.kiosk_attempts a where a.created_at < p_now - interval '90 days';
  end if;
  category := 'kiosk_attempts'; affected := n; held := 0; executed := exec; return next;
  results := results || jsonb_build_object('kiosk_attempts', jsonb_build_object('affected', n));

  select count(*) into n from private.rate_limit_hits r where r.window_start < p_now - interval '2 days';
  if exec and n > 0 then
    delete from private.rate_limit_hits r where r.window_start < p_now - interval '2 days';
  end if;
  category := 'rate_limits'; affected := n; held := 0; executed := exec; return next;

  select count(*) into n from private.scheduled_job_runs j where j.finished_at < p_now - interval '90 days';
  if exec and n > 0 then
    delete from private.scheduled_job_runs j where j.finished_at < p_now - interval '90 days';
  end if;
  category := 'job_runs'; affected := n; held := 0; executed := exec; return next;

  -- No automáticas: solo se cuenta lo que ya supera el plazo mínimo, para revisión.
  select count(*) into n from public.time_entries t where t.work_date < (p_now - interval '4 years')::date;
  category := 'time_records'; affected := n; held := 0; executed := false; return next;
  results := results || jsonb_build_object('time_records_review', n);

  insert into private.retention_runs (mode, run_at, results) values (p_mode, p_now, results);
  perform set_config('app.retention_run', 'off', true);
end;
$$;

-- Últimas ejecuciones (solo administración de plataforma: son recuentos globales).
create or replace function public.recent_retention_runs(p_limit integer default 20)
returns table (id bigint, mode text, run_at timestamptz, results jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.mode, r.run_at, r.results from private.retention_runs r
  where private.is_global_admin()
  order by r.run_at desc limit least(greatest(p_limit, 1), 100);
$$;

-- -----------------------------------------------------------------------------
-- 7. Derechos de las personas (RGPD arts. 15 a 22)
-- -----------------------------------------------------------------------------

create table public.data_subject_requests (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete restrict,
  employee_id     uuid not null,
  requested_by    uuid not null references public.profiles (id) on delete restrict,
  kind            text not null check (kind in ('access', 'rectification', 'erasure', 'restriction', 'portability', 'objection')),
  -- Lo que la persona pide (p. ej., qué dato rectificar). Solo lo ven ella y quien gestiona privacidad.
  details         text check (details is null or char_length(details) <= 1000),
  status          text not null default 'received'
    check (status in ('received', 'in_review', 'approved', 'partially_approved', 'rejected', 'completed')),
  due_at          timestamptz not null default now() + interval '1 month',
  reviewer_id     uuid references public.profiles (id) on delete set null,
  decision_note   text check (decision_note is null or char_length(btrim(decision_note)) between 5 and 1000),
  -- Obligaciones que impiden suprimir (calculadas al decidir; sin datos personales).
  blockers        jsonb not null default '[]' check (jsonb_typeof(blockers) = 'array'),
  idempotency_key uuid not null,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  completed_at    timestamptz,
  unique (company_id, requested_by, idempotency_key),
  unique (id, company_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);
create index data_subject_requests_company_idx on public.data_subject_requests (company_id, status, due_at);

-- Qué obligaciones impiden suprimir datos de una persona (orientativo: la
-- decisión final es humana y los plazos están pendientes de validar).
create or replace function private.erasure_blockers(p_employee uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(b order by b ->> 'category'), '[]')
  from (
    select jsonb_build_object('category', 'time_records', 'basis', 'Art. 34.9 ET: registro de jornada 4 años',
      'until', (max(t.work_date) + interval '4 years')::date) as b
    from public.time_entries t
    where t.employee_id = p_employee and t.work_date >= (now() - interval '4 years')::date
    having count(*) > 0
    union all
    select jsonb_build_object('category', 'expenses', 'basis', 'Normativa contable y fiscal (plazo pendiente de validar)',
      'until', (max(x.expense_date) + interval '6 years')::date)
    from public.expenses x
    where x.employee_id = p_employee and x.status = 'ready' and x.expense_date >= (now() - interval '6 years')::date
    having count(*) > 0
    union all
    select jsonb_build_object('category', 'legal_hold', 'basis', 'Retención legal activa', 'until', null)
    from public.employees e
    where e.id = p_employee and private.has_legal_hold(e.company_id, e.id, 'all')
    union all
    select jsonb_build_object('category', 'employment', 'basis', 'Relación laboral vigente', 'until', null)
    from public.employees e
    where e.id = p_employee and e.status = 'active'
  ) s;
$$;

-- La persona presenta su solicitud (solo sobre sí misma).
create or replace function public.submit_data_request(p_company uuid, p_kind text, p_details text,
  p_idempotency_key uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  employee uuid := private.own_employee(p_company);
  existing uuid;
  created uuid;
begin
  if employee is null then
    raise exception 'Solo puedes presentar solicitudes sobre tus propios datos' using errcode = '42501';
  end if;
  select r.id into existing from public.data_subject_requests r
  where r.company_id = p_company and r.requested_by = (select auth.uid()) and r.idempotency_key = p_idempotency_key;
  if existing is not null then
    return existing;
  end if;
  perform private.hit_rate_limit('rights_request', 5, interval '1 day');
  insert into public.data_subject_requests (company_id, employee_id, requested_by, kind, details, idempotency_key)
  values (p_company, employee, (select auth.uid()), p_kind, nullif(btrim(coalesce(p_details, '')), ''), p_idempotency_key)
  returning id into created;
  return created;
end;
$$;

-- Revisión humana: quien gestiona privacidad (nunca la propia persona) decide.
-- Una supresión o limitación con obligaciones pendientes solo puede aprobarse
-- parcialmente y queda constancia de qué la impide.
create or replace function public.review_data_request(p_request uuid, p_status text, p_note text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.data_subject_requests;
  b jsonb;
begin
  select * into r from public.data_subject_requests where id = p_request for update;
  if r.id is null or not private.can_handle_privacy(r.company_id) then
    raise exception 'Solicitud no encontrada' using errcode = 'P0002';
  end if;
  if r.requested_by = (select auth.uid()) or private.is_self_employee(r.employee_id) then
    raise exception 'Nadie resuelve sus propias solicitudes' using errcode = '42501';
  end if;
  if r.status not in ('received', 'in_review') then
    raise exception 'La solicitud ya está resuelta' using errcode = 'P0001';
  end if;
  if p_status not in ('in_review', 'approved', 'partially_approved', 'rejected') then
    raise exception 'Estado no válido' using errcode = '22023';
  end if;
  if p_status <> 'in_review' and char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Explica la decisión (mínimo 5 caracteres)' using errcode = 'P0001';
  end if;
  b := case when r.kind in ('erasure', 'restriction') then private.erasure_blockers(r.employee_id) else '[]' end;
  if p_status = 'approved' and jsonb_array_length(b) > 0 then
    raise exception 'Hay obligaciones de conservación: solo cabe una aprobación parcial' using errcode = 'P0001';
  end if;
  update public.data_subject_requests
  set status = p_status, reviewer_id = (select auth.uid()), blockers = b,
      decision_note = case when p_status = 'in_review' then decision_note else btrim(p_note) end,
      decided_at = case when p_status = 'in_review' then null else now() end
  where id = r.id;
  return p_status;
end;
$$;

create or replace function public.complete_data_request(p_request uuid, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.data_subject_requests;
begin
  select * into r from public.data_subject_requests where id = p_request for update;
  if r.id is null or not private.can_handle_privacy(r.company_id) or private.is_self_employee(r.employee_id) then
    raise exception 'Solicitud no encontrada' using errcode = 'P0002';
  end if;
  if r.status not in ('approved', 'partially_approved') then
    raise exception 'Solo se completa una solicitud aprobada' using errcode = 'P0001';
  end if;
  update public.data_subject_requests
  set status = 'completed', completed_at = now(),
      decision_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), decision_note)
  where id = r.id;
end;
$$;

-- Copia de los datos de la persona (acceso y portabilidad), solo para una
-- solicitud aprobada y para quien la revisa. Sin archivos ni datos de terceros.
create or replace function public.subject_access_package(p_request uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.data_subject_requests;
  e public.employees;
  pkg jsonb;
begin
  select * into r from public.data_subject_requests where id = p_request;
  if r.id is null or not private.can_handle_privacy(r.company_id) or private.is_self_employee(r.employee_id) then
    raise exception 'Solicitud no encontrada' using errcode = 'P0002';
  end if;
  if r.kind not in ('access', 'portability') or r.status not in ('approved', 'partially_approved') then
    raise exception 'La copia de datos solo se genera para una solicitud de acceso o portabilidad aprobada'
      using errcode = 'P0001';
  end if;
  perform private.hit_rate_limit('export', 30, interval '1 hour');
  select * into e from public.employees where id = r.employee_id;
  pkg := jsonb_build_object(
    'generated_at', now(),
    'request_id', r.id,
    'profile', (select jsonb_build_object('full_name', p.full_name, 'email', p.email, 'phone', p.phone)
      from public.company_memberships m join public.profiles p on p.id = m.user_id where m.id = e.membership_id),
    'employee', jsonb_build_object('code', e.employee_code, 'first_name', e.first_name, 'last_name', e.last_name,
      'work_email', e.work_email, 'status', e.status, 'created_at', e.created_at),
    'employment_terms', (select coalesce(jsonb_agg(jsonb_build_object('contract_type', t.contract_type,
      'weekly_hours', t.weekly_hours, 'job_title', t.job_title, 'valid_from', t.valid_from, 'valid_to', t.valid_to)
      order by t.valid_from), '[]') from public.employment_terms t where t.employee_id = e.id),
    'time_entries', (select coalesce(jsonb_agg(jsonb_build_object('work_date', t.work_date, 'status', t.status,
      'started_at', t.started_at, 'ended_at', t.ended_at, 'worked_seconds', t.worked_seconds,
      'break_seconds', t.break_seconds, 'punches', (select coalesce(jsonb_agg(jsonb_build_object('kind', p.kind,
        'server_at', p.server_at, 'source', p.source, 'location_status', p.location_status,
        'latitude', p.latitude, 'longitude', p.longitude, 'selfie_kept', p.selfie_path is not null and p.selfie_purged_at is null)
        order by p.server_at), '[]') from public.punches p where p.time_entry_id = t.id)) order by t.work_date), '[]')
      from public.time_entries t where t.employee_id = e.id and t.work_date >= (now() - interval '5 years')::date),
    'absence_requests', (select coalesce(jsonb_agg(jsonb_build_object('type', at.name, 'start_date', a.start_date,
      'end_date', a.end_date, 'amount', a.amount, 'unit', a.amount_unit, 'status', a.status,
      'employee_note', a.employee_note, 'submitted_at', a.submitted_at) order by a.start_date), '[]')
      from public.absence_requests a join public.absence_types at on at.id = a.absence_type_id
      where a.employee_id = e.id),
    'expenses', (select coalesce(jsonb_agg(jsonb_build_object('date', x.expense_date, 'merchant', x.merchant_name,
      'currency', x.currency, 'total_cents', x.total_cents, 'status', x.status, 'project', x.project_code,
      'client', x.client_name, 'notes', x.notes) order by x.expense_date), '[]')
      from public.expenses x where x.employee_id = e.id),
    'data_requests', (select coalesce(jsonb_agg(jsonb_build_object('kind', d.kind, 'status', d.status,
      'created_at', d.created_at) order by d.created_at), '[]')
      from public.data_subject_requests d where d.employee_id = e.id)
  );
  insert into public.audit_events (actor_id, company_id, group_id, entity, entity_id, action, changed_fields)
  select (select auth.uid()), r.company_id, c.group_id, 'data_subject_requests', r.id::text, 'export',
    array['subject_access_package']
  from public.companies c where c.id = r.company_id;
  return pkg;
end;
$$;

create or replace function private.guard_data_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.company_id, new.employee_id, new.requested_by, new.kind, new.details, new.idempotency_key, new.created_at,
      new.due_at)
     is distinct from (old.company_id, old.employee_id, old.requested_by, old.kind, old.details,
      old.idempotency_key, old.created_at, old.due_at)
     or old.status in ('rejected', 'completed') then
    raise exception 'Una solicitud resuelta no se modifica' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger data_subject_requests_guard before update on public.data_subject_requests
  for each row execute function private.guard_data_request();
create trigger data_subject_requests_no_delete before delete on public.data_subject_requests
  for each row execute function private.prevent_mutation();
create trigger data_subject_requests_keys before update on public.data_subject_requests
  for each row execute function private.prevent_key_change('id', 'company_id', 'employee_id', 'requested_by');
-- Solo el estado (sin el texto de la persona).
create trigger audit_events_data_subject_requests after insert or update of status on public.data_subject_requests
  for each row execute function private.audit_status_event();

-- -----------------------------------------------------------------------------
-- 8. Privilegios y RLS de lo nuevo
-- -----------------------------------------------------------------------------

revoke all on table private.security_settings, private.rate_limit_hits, private.retention_runs
  from anon, authenticated;

revoke all on function
  private.strong_auth(), private.role_requires_mfa(public.app_role), private.role_auth_ok(public.app_role),
  private.hit_rate_limit(text, integer, interval), private.has_support_access(uuid),
  private.platform_can_read_profile(uuid), private.guard_support_access(), private.can_view_punch_evidence(uuid),
  private.can_handle_privacy(uuid), private.has_legal_hold(uuid, uuid, text), private.guard_legal_hold(),
  private.retention_delete_allowed(text), private.erasure_blockers(uuid), private.guard_data_request()
from public;
grant execute on function
  private.strong_auth(), private.role_requires_mfa(public.app_role), private.role_auth_ok(public.app_role),
  private.has_support_access(uuid), private.platform_can_read_profile(uuid), private.can_view_punch_evidence(uuid),
  private.can_handle_privacy(uuid), private.has_legal_hold(uuid, uuid, text), private.erasure_blockers(uuid)
to authenticated, service_role;

revoke all on function
  public.my_mfa_status(), public.check_rate_limit(text),
  public.grant_support_access(uuid, uuid, text, integer), public.revoke_support_access(uuid), public.support_staff(),
  public.punch_evidence(uuid), public.open_absence_attachment(uuid),
  public.place_legal_hold(uuid, text, text, uuid), public.release_legal_hold(uuid),
  public.retention_catalog(), public.run_retention(text, timestamptz), public.recent_retention_runs(integer),
  public.submit_data_request(uuid, text, text, uuid), public.review_data_request(uuid, text, text),
  public.complete_data_request(uuid, text), public.subject_access_package(uuid)
from public, anon, authenticated;
grant execute on function
  public.my_mfa_status(), public.check_rate_limit(text),
  public.grant_support_access(uuid, uuid, text, integer), public.revoke_support_access(uuid), public.support_staff(),
  public.punch_evidence(uuid), public.open_absence_attachment(uuid),
  public.place_legal_hold(uuid, text, text, uuid), public.release_legal_hold(uuid),
  public.retention_catalog(), public.recent_retention_runs(integer),
  public.submit_data_request(uuid, text, text, uuid), public.review_data_request(uuid, text, text),
  public.complete_data_request(uuid, text), public.subject_access_package(uuid)
to authenticated, service_role;
grant execute on function public.run_retention(text, timestamptz) to service_role;

revoke all on public.support_access_grants, public.legal_holds, public.data_subject_requests from anon, authenticated;
grant select on public.support_access_grants, public.legal_holds, public.data_subject_requests to authenticated;

alter table public.support_access_grants enable row level security;
alter table public.legal_holds enable row level security;
alter table public.data_subject_requests enable row level security;

create policy "support_access_grants_select" on public.support_access_grants
  for select to authenticated
  using (support_user_id = (select auth.uid())
    or private.has_company_role(company_id, '{company_admin}') or private.is_group_admin_of_company(company_id)
    or private.has_permission(company_id, 'audit.read'));
create policy "legal_holds_select" on public.legal_holds
  for select to authenticated
  using (private.can_handle_privacy(company_id) or private.has_permission(company_id, 'audit.read'));
create policy "data_subject_requests_select" on public.data_subject_requests
  for select to authenticated
  using ((requested_by = (select auth.uid()) and private.is_company_member(company_id))
    or private.can_handle_privacy(company_id));
