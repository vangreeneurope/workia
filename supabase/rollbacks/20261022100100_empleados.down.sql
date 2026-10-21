-- =============================================================================
-- Reversión de 20261022100100_empleados.sql
--
-- Deja el esquema exactamente como tras 20261022100000_modelo_multiempresa.sql
-- (verificado por scripts/test-db.sh, comprobación de reversibilidad).
--
-- Pérdida de datos: elimina employees y employment_terms. Las asignaciones de
-- manager se trasladan de nuevo a membresías; job_title vuelve a la membresía
-- desde las condiciones activas. Si hay datos que no caben en el modelo
-- anterior, aborta salvo que se ejecute antes:
--   set app.allow_lossy_rollback = 'on';
-- La extensión btree_gist se conserva (puede usarla otro objeto).
-- =============================================================================

do $$
begin
  if coalesce(current_setting('app.allow_lossy_rollback', true), 'off') <> 'on' and (
    exists (select 1 from public.employees)
    or exists (select 1 from public.manager_assignments ma
               join public.employees e on e.id = ma.employee_id
               where e.membership_id is null)
  ) then
    raise exception 'La reversión eliminaría empleados o asignaciones. Revisa docs/BASE_DATOS.md y usa app.allow_lossy_rollback si es intencionado.';
  end if;
end;
$$;

-- Políticas de la versión nueva
drop policy "employees_select" on public.employees;
drop policy "employees_insert" on public.employees;
drop policy "employees_update" on public.employees;
drop policy "employment_terms_select" on public.employment_terms;
drop policy "employment_terms_insert" on public.employment_terms;
drop policy "employment_terms_update" on public.employment_terms;
drop policy "manager_assignments_select" on public.manager_assignments;
drop policy "manager_assignments_insert" on public.manager_assignments;
drop policy "manager_assignments_update" on public.manager_assignments;

drop trigger manager_assignments_updated_at on public.manager_assignments;
drop trigger manager_assignments_keys on public.manager_assignments;
drop trigger manager_assignments_granted_by on public.manager_assignments;

-- job_title vuelve a la membresía
alter table public.company_memberships
  add column job_title text check (job_title is null or char_length(job_title) <= 120);

update public.company_memberships m
set job_title = t.job_title
from public.employees e
join public.employment_terms t on t.employee_id = e.id and t.status = 'active'
where e.membership_id = m.id and t.job_title is not null;

-- manager_assignments vuelve a referenciar membresías
alter table public.manager_assignments add column employee_membership_id uuid;
update public.manager_assignments ma
set employee_membership_id = e.membership_id
from public.employees e
where e.id = ma.employee_id;
delete from public.manager_assignments where employee_membership_id is null;

alter table public.manager_assignments
  drop column employee_id,
  drop column status,
  drop column valid_from,
  drop column valid_to,
  drop column updated_at;
alter table public.manager_assignments rename column granted_by to created_by;
alter table public.manager_assignments
  alter column employee_membership_id set not null,
  add unique (manager_user_id, employee_membership_id),
  add foreign key (employee_membership_id, company_id)
    references public.company_memberships (id, company_id) on delete cascade;

-- Tablas y tipos nuevos
drop table public.employment_terms;
drop table public.employees;
drop type public.terms_status;
drop type public.working_time;
drop type public.contract_type;

drop function private.manages_employee(uuid);
drop function private.is_eligible_manager(uuid, uuid);
drop function private.employee_permission(uuid, private.app_permission);
drop function private.employee_belongs_to_user(uuid, uuid);
drop function private.is_self_employee(uuid);

-- Funciones de supervisión de la migración anterior
create or replace function private.manages_in_company(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.manager_assignments a
    join public.company_memberships m on m.id = a.employee_membership_id
    join public.companies c on c.id = a.company_id
    where a.company_id = target_company
      and a.manager_user_id = (select auth.uid())
      and m.status = 'active'
      and private.is_active_window(m.valid_from, m.valid_to)
      and private.has_current_membership_in_group(c.group_id)
  );
$$;

create or replace function private.manages_membership(target_membership uuid)
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
    where a.employee_membership_id = target_membership
      and a.manager_user_id = (select auth.uid())
      and private.has_current_membership_in_group(c.group_id)
  );
$$;

create or replace function private.manages_user(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.manager_assignments a
    join public.company_memberships m on m.id = a.employee_membership_id
    join public.companies c on c.id = a.company_id
    where m.user_id = target_user
      and a.manager_user_id = (select auth.uid())
      and private.has_current_membership_in_group(c.group_id)
  );
$$;

create or replace function private.check_manager_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee_user uuid;
begin
  select m.user_id into employee_user
  from public.company_memberships m
  where m.id = new.employee_membership_id;

  if employee_user = new.manager_user_id then
    raise exception 'Un usuario no puede ser su propio manager'
      using errcode = 'check_violation';
  end if;

  if new.created_by is null then
    new.created_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger manager_assignments_check before insert or update on public.manager_assignments
  for each row execute function private.check_manager_assignment();

-- check_manager_assignment conserva los privilegios por defecto, como en la migración base.

-- Privilegios de la migración anterior
revoke all on public.manager_assignments from anon, authenticated;
grant select, insert, delete on public.manager_assignments to authenticated;
grant insert (job_title), update (job_title) on public.company_memberships to authenticated;

create policy "manager_assignments_select" on public.manager_assignments
  for select to authenticated
  using (
    manager_user_id = (select auth.uid())
    or private.has_permission(company_id, 'members.read')
    or private.is_own_membership(employee_membership_id)
  );

create policy "manager_assignments_insert" on public.manager_assignments
  for insert to authenticated
  with check (
    private.has_permission(company_id, 'assignments.manage')
    and manager_user_id <> (select auth.uid())
  );

create policy "manager_assignments_delete" on public.manager_assignments
  for delete to authenticated
  using (private.has_permission(company_id, 'assignments.manage'));
