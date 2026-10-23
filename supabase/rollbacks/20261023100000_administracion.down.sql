-- =============================================================================
-- Reversión de 20261023100000_administracion.sql
--
-- Deja el esquema exactamente como tras 20261022100100_empleados.sql
-- (verificado por scripts/test-db.sh). Generado a partir del texto literal de
-- las migraciones anteriores para restaurar funciones idénticas.
--
-- Pérdida de datos: suplencias, auditoría minimizada (audit_events), fechas de
-- baja y asignaciones por equipo o por tipo de solicitud. Aborta si existen,
-- salvo que se ejecute antes:  set app.allow_lossy_rollback = 'on';
-- =============================================================================

do $$
begin
  if coalesce(current_setting('app.allow_lossy_rollback', true), 'off') <> 'on' and (
    exists (select 1 from public.approver_substitutions)
    or exists (select 1 from public.audit_events)
    or exists (select 1 from public.employees where end_date is not null)
    or exists (select 1 from public.manager_assignments
               where scope_type <> 'employee' or request_type <> 'all')
  ) then
    raise exception 'La reversión perdería suplencias, auditoría, bajas o asignaciones. Revisa docs/BASE_DATOS.md y usa app.allow_lossy_rollback si es intencionado.';
  end if;
end;
$$;

drop policy "manager_assignments_select" on public.manager_assignments;
drop policy "manager_assignments_insert" on public.manager_assignments;
drop policy "manager_assignments_update" on public.manager_assignments;

drop trigger audit_events_companies on public.companies;
drop trigger audit_events_group_admins on public.group_admins;
drop trigger audit_events_work_centers on public.work_centers;
drop trigger audit_events_teams on public.teams;
drop trigger audit_events_company_memberships on public.company_memberships;
drop trigger audit_events_role_assignments on public.role_assignments;
drop trigger audit_events_employees on public.employees;
drop trigger audit_events_employment_terms on public.employment_terms;
drop trigger audit_events_manager_assignments on public.manager_assignments;
drop trigger manager_assignments_employment on public.manager_assignments;
drop trigger employment_terms_employment on public.employment_terms;
drop trigger manager_assignments_keys on public.manager_assignments;

drop table public.approver_substitutions;
drop table public.audit_events;

drop function public.change_employment_terms(uuid, date, public.contract_type, public.working_time, numeric, text);
drop function public.group_user_labels(uuid, uuid[]);
drop function public.find_group_user_by_email(uuid, text);
drop function public.import_employees(uuid, jsonb);
drop function public.log_admin_event(uuid, text, text, integer, jsonb);
drop function public.reactivate_employee(uuid);
drop function public.terminate_employee(uuid, date);
drop function public.resolve_approver(uuid, public.approval_type, timestamptz);
drop function public.my_company_permissions(uuid);
drop function private.audit_event_row();
drop function private.minimize_audit_data(jsonb);
drop function private.resolve_approver_internal(uuid, public.approval_type, timestamptz);
drop function private.assignment_permission(uuid, uuid, private.app_permission);
drop function private.team_permission(uuid, private.app_permission);
drop function private.user_manages_employee(uuid, uuid, timestamptz);
drop function private.check_assignment_within_employment();
drop function private.check_terms_within_employment();
drop function private.employment_end_instant(date);
drop function private.employee_active_on(uuid, date);

-- Asignaciones: vuelven a ser solo por persona y para cualquier solicitud.
delete from public.manager_assignments where scope_type = 'team';
alter table public.manager_assignments
  drop constraint manager_assignments_employee_excl,
  drop constraint manager_assignments_team_excl,
  drop constraint manager_assignments_scope_check,
  drop constraint manager_assignments_team_fkey,
  drop column scope_type,
  drop column team_id,
  drop column request_type,
  alter column employee_id set not null;
create unique index manager_assignments_active_uidx on public.manager_assignments
  (company_id, manager_user_id, employee_id) where status = 'active';
create trigger manager_assignments_keys before update on public.manager_assignments
  for each row execute function private.prevent_key_change(
    'id', 'company_id', 'employee_id', 'manager_user_id'
  );

alter table public.employees drop column end_date;

drop type public.assignment_scope;
drop type public.approval_type;

-- Funciones y políticas de las migraciones anteriores (texto literal)
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
    private.is_global_admin()
    or private.is_group_admin_of_company(p_company)
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
  select private.is_global_admin()
    or private.is_group_admin_of_company(p_company)
    or private.has_company_role(p_company, array['company_admin']::public.app_role[])
    or (
      p_role in ('employee', 'manager')
      and private.has_company_role(p_company, array['hr']::public.app_role[])
    );
$$;

create or replace function private.manages_employee(p_employee uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.manager_assignments a
    join public.companies c on c.id = a.company_id
    where a.employee_id = p_employee
      and a.manager_user_id = (select auth.uid())
      and a.status = 'active'
      and private.is_active_window(a.valid_from, a.valid_to)
      and c.status = 'active'
      and private.has_current_membership_in_group(c.group_id)
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
    select 1 from public.manager_assignments a
    where a.company_id = target_company
      and a.manager_user_id = (select auth.uid())
      and private.manages_employee(a.employee_id)
  );
$$;

drop policy "companies_insert" on public.companies;
create policy "companies_insert" on public.companies
  for insert to authenticated
  with check (private.is_global_admin() or private.is_group_admin(group_id));

drop policy "audit_log_select" on public.audit_log;
create policy "audit_log_select" on public.audit_log
  for select to authenticated
  using (
    private.is_global_admin()
    or (group_id is not null and private.is_group_admin(group_id))
    or (company_id is not null and private.has_permission(company_id, 'audit.read'))
  );

create policy "manager_assignments_select" on public.manager_assignments
  for select to authenticated
  using (
    manager_user_id = (select auth.uid())
    or private.is_self_employee(employee_id)
    or private.employee_permission(employee_id, 'employees.read')
  );

create policy "manager_assignments_insert" on public.manager_assignments
  for insert to authenticated
  with check (
    private.employee_permission(employee_id, 'assignments.manage')
    and manager_user_id <> (select auth.uid())
    and not private.employee_belongs_to_user(manager_user_id, employee_id)
    and private.is_eligible_manager(manager_user_id, company_id)
  );

create policy "manager_assignments_update" on public.manager_assignments
  for update to authenticated
  using (
    private.employee_permission(employee_id, 'assignments.manage')
    and manager_user_id <> (select auth.uid())
  )
  with check (
    private.employee_permission(employee_id, 'assignments.manage')
    and manager_user_id <> (select auth.uid())
  );
