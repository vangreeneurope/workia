-- =============================================================================
-- Reversión de 20261024100000_calendarios_turnos.sql
--
-- Deja el esquema exactamente como tras 20261023100000_administracion.sql
-- (verificado por scripts/test-db.sh). La función de auditoría se restaura con
-- el texto literal de esa migración.
--
-- Pérdida de datos: calendarios, festivos, plantillas y sus versiones,
-- asignaciones de turno, ausencias integradas y eventos de horario. Aborta si
-- existen, salvo que se ejecute antes:  set app.allow_lossy_rollback = 'on';
-- La auditoría (audit_events, audit_log) no se borra nunca.
-- =============================================================================

do $$
begin
  if coalesce(current_setting('app.allow_lossy_rollback', true), 'off') <> 'on' and (
    exists (select 1 from public.holiday_calendars)
    or exists (select 1 from public.shift_templates)
    or exists (select 1 from public.shift_assignments)
    or exists (select 1 from public.leave_periods)
    or exists (select 1 from public.schedule_events)
    or exists (select 1 from public.audit_events where action = 'publish')
  ) then
    raise exception 'La reversión perdería calendarios, plantillas, asignaciones o eventos de horario. Revisa docs/HORARIOS.md y usa app.allow_lossy_rollback si es intencionado.';
  end if;
end;
$$;

drop table public.schedule_events;
drop table public.leave_periods;
drop table public.shift_assignment_days;
drop table public.shift_assignments;
drop table public.shift_template_segments;
drop table public.shift_template_versions;
drop table public.shift_templates;
drop table public.holidays;
drop table public.work_center_holiday_calendars;
drop table public.holiday_calendars;

alter table public.employment_terms drop constraint employment_terms_id_company_employee_key;
alter table public.companies drop constraint companies_timezone_check;
alter table public.work_centers drop constraint work_centers_timezone_check;

drop function public.my_schedule_access(uuid);
drop function public.publish_shift_template_version(uuid, date);
drop function public.save_shift_template_draft(uuid, public.shift_kind, integer, integer, integer, jsonb, integer, integer);
drop function public.close_shift_assignment(uuid, date);
drop function public.publish_shift_assignment(uuid, boolean);
drop function public.save_shift_assignment(public.shift_assignment_scope, date, smallint, uuid[], uuid, uuid, uuid, uuid, date, date, text);
drop function public.shift_assignment_conflicts(uuid);
drop function private.assignment_conflicts_internal(uuid);
drop function private.assignment_recipients(uuid);
drop function private.guard_calendar_link();
drop function private.guard_holiday();
drop function private.guard_assignment_day();
drop function private.guard_shift_assignment();
drop function private.guard_template_segment();
drop function private.guard_template_version();
drop function private.template_version_problems(uuid);
drop function private.planning_open_from(uuid);
drop function private.can_read_team_schedule(uuid);
drop function private.can_read_employee_schedule(uuid);
drop function private.team_schedule_permission(uuid, text);
drop function private.employee_schedule_permission(uuid, text);
drop function private.has_schedule_permission(uuid, text, uuid, uuid);
drop function private.role_has_schedule_permission(public.app_role, text);
drop function private.is_valid_time_zone(text);

drop type public.shift_assignment_scope;
drop type public.schedule_status;
drop type public.segment_kind;
drop type public.shift_kind;
drop type public.calendar_scope;

-- audit_events es inmutable: sus filas se conservan tal cual (también las de las
-- tablas eliminadas). Si hay publicaciones registradas, la restricción anterior
-- se restaura sin validar el histórico (NOT VALID) para no alterarlo.
alter table public.audit_events drop constraint audit_events_action_check;
do $$
begin
  if exists (select 1 from public.audit_events where action = 'publish') then
    alter table public.audit_events add constraint audit_events_action_check check (action in (
        'create', 'update', 'deactivate', 'reactivate', 'terminate', 'export', 'import'
      )) not valid;
  else
    alter table public.audit_events add constraint audit_events_action_check check (action in (
        'create', 'update', 'deactivate', 'reactivate', 'terminate', 'export', 'import'
      ));
  end if;
end;
$$;

-- Texto literal de 20261023100000_administracion.sql
create or replace function private.audit_event_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_column text := nullif(tg_argv[0], '');
  group_column text := nullif(tg_argv[1], '');
  old_data jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  new_data jsonb := to_jsonb(new);
  ignored text[] := array['created_at', 'updated_at', 'granted_by'];
  changed text[];
  event_action text;
  company uuid;
  grp uuid;
begin
  if tg_op = 'INSERT' then
    select coalesce(array_agg(key order by key), '{}') into changed
    from jsonb_each(new_data) where key <> all (ignored) and value <> 'null'::jsonb;
    event_action := 'create';
  else
    select coalesce(array_agg(key order by key), '{}') into changed
    from jsonb_each(new_data) n
    where n.key <> all (ignored) and n.value is distinct from old_data -> n.key;
    if cardinality(changed) = 0 then
      return null;
    end if;
    event_action := case
      when 'end_date' = any (changed) and new_data ->> 'end_date' is not null then 'terminate'
      when 'end_date' = any (changed) then 'reactivate'
      when 'status' = any (changed) and new_data ->> 'status' = 'active' then 'reactivate'
      when 'status' = any (changed) then 'deactivate'
      else 'update'
    end;
  end if;

  if company_column is not null then
    company := (new_data ->> company_column)::uuid;
  end if;
  if group_column is not null then
    grp := (new_data ->> group_column)::uuid;
  elsif company is not null then
    select c.group_id into grp from public.companies c where c.id = company;
  end if;

  insert into public.audit_events (
    actor_id, company_id, group_id, entity, entity_id, action, changed_fields, before, after
  )
  values (
    (select auth.uid()), company, grp, tg_table_name, new_data ->> 'id', event_action, changed,
    case when tg_op = 'UPDATE' then private.minimize_audit_data(
      (select jsonb_object_agg(key, value) from jsonb_each(old_data) where key = any (changed))
    ) end,
    private.minimize_audit_data(
      (select jsonb_object_agg(key, value) from jsonb_each(new_data) where key = any (changed))
    )
  );
  return null;
end;
$$;
