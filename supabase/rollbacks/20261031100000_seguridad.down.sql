-- =============================================================================
-- Reversión de 20261031100000_seguridad.sql
--
-- Deja el esquema exactamente como tras 20261030100000_informes.sql
-- (verificado por scripts/test-db.sh). OJO: revertir quita protecciones
-- (MFA por rol, acceso de soporte acotado, evidencias de fichaje restringidas).
--
-- Pérdida de datos: accesos de soporte, retenciones legales, solicitudes de
-- derechos y su registro, contadores de frecuencia y ejecuciones de retención.
-- Aborta si existen, salvo: set app.allow_lossy_rollback = 'on';
-- La auditoría no se borra: si audit_events contiene 'sensitive_read', la
-- restricción original se restaura como NOT VALID.
-- =============================================================================

do $$
begin
  if coalesce(current_setting('app.allow_lossy_rollback', true), 'off') <> 'on' and (
    exists (select 1 from public.support_access_grants)
    or exists (select 1 from public.legal_holds)
    or exists (select 1 from public.data_subject_requests)
  ) then
    raise exception 'La reversión perdería accesos de soporte, retenciones legales o solicitudes de derechos. Revisa docs/PRIVACIDAD.md y usa app.allow_lossy_rollback si es intencionado.';
  end if;
end;
$$;

-- Derechos
drop trigger audit_events_data_subject_requests on public.data_subject_requests;
drop function public.subject_access_package(uuid);
drop function public.complete_data_request(uuid, text);
drop function public.review_data_request(uuid, text, text);
drop function public.submit_data_request(uuid, text, text, uuid);
drop table public.data_subject_requests;
drop function private.guard_data_request();
drop function private.erasure_blockers(uuid);

-- Retención
drop function public.recent_retention_runs(integer);
drop function public.run_retention(text, timestamptz);
drop table private.retention_runs;
drop function public.retention_catalog();
drop function public.release_legal_hold(uuid);
drop function public.place_legal_hold(uuid, text, text, uuid);
drop table public.legal_holds;
drop function private.guard_legal_hold();

-- Evidencias de fichaje
drop policy "punch_selfies_select" on storage.objects;
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
drop function public.open_absence_attachment(uuid);
drop function public.punch_evidence(uuid);
drop function private.can_view_punch_evidence(uuid);
revoke select (id, company_id, employee_id, time_entry_id, kind, server_at, device_at, time_zone, source, device_id,
  kiosk_device_id, idempotency_key, location_status, selfie_purged_at, created_by, created_at)
  on public.punches from authenticated;
grant select on public.punches to authenticated;

-- Soporte
drop policy "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_global_admin()
    or private.can_read_user(id)
    or private.manages_user(id)
  );
drop policy "audit_events_select" on public.audit_events;
create policy "audit_events_select" on public.audit_events
  for select to authenticated
  using (
    (company_id is not null and private.has_permission(company_id, 'audit.read'))
    or (company_id is null and group_id is not null and private.is_group_admin(group_id))
  );
drop policy "role_assignments_select" on public.role_assignments;
create policy "role_assignments_select" on public.role_assignments
  for select to authenticated
  using (private.is_own_membership(membership_id) or private.has_permission(company_id, 'members.read'));
drop policy "memberships_select" on public.company_memberships;
create policy "memberships_select" on public.company_memberships
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.has_permission(company_id, 'members.read')
    or private.manages_membership(id)
  );
drop policy "employees_select" on public.employees;
create policy "employees_select" on public.employees
  for select to authenticated
  using (
    private.is_self_employee(id)
    or private.has_permission(company_id, 'employees.read', work_center_id, team_id)
    or private.manages_employee(id)
  );
drop function public.support_staff();
drop function public.revoke_support_access(uuid);
drop function public.grant_support_access(uuid, uuid, text, integer);
drop table public.support_access_grants;
drop function private.guard_support_access();
drop function private.platform_can_read_profile(uuid);
drop function private.has_support_access(uuid);
drop function private.can_handle_privacy(uuid);
drop function private.has_legal_hold(uuid, uuid, text);
drop function private.retention_delete_allowed(text);

-- Frecuencia
drop function public.check_rate_limit(text);
drop function private.hit_rate_limit(text, integer, interval);
drop table private.rate_limit_hits;

-- Acciones de auditoría
alter table public.audit_events drop constraint audit_events_action_check;
do $$
begin
  if exists (select 1 from public.audit_events where action = 'sensitive_read') then
    alter table public.audit_events add constraint audit_events_action_check check (action in (
        'create', 'update', 'deactivate', 'reactivate', 'terminate', 'export', 'import', 'publish',
        'status_change', 'request_export', 'download'
      )) not valid;
  else
    alter table public.audit_events add constraint audit_events_action_check check (action in (
        'create', 'update', 'deactivate', 'reactivate', 'terminate', 'export', 'import', 'publish',
        'status_change', 'request_export', 'download'
      ));
  end if;
end;
$$;

-- Funciones de permisos, inmutabilidad y OCR originales (sin MFA por rol ni retención)
CREATE OR REPLACE FUNCTION private.is_global_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())
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
    and private.role_has_expense_permission(ra.role, a);
$function$;

CREATE OR REPLACE FUNCTION private.prevent_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'La tabla % es inmutable: no se permite %', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_ocr_run()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.status <> 'processing' then
    raise exception 'La ejecución de OCR ya terminó' using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

drop function public.my_mfa_status();
drop function private.role_auth_ok(public.app_role);
drop function private.role_requires_mfa(public.app_role);
drop function private.strong_auth();
drop table private.security_settings;

-- Privilegios por defecto de Supabase
alter default privileges in schema public grant all on functions to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
