-- =============================================================================
-- Reversión de 20261026100000_ausencias.sql
--
-- Deja el esquema exactamente como tras 20261025100000_control_horario.sql
-- (verificado por scripts/test-db.sh).
--
-- Pérdida de datos: tipos, políticas, saldos y su libro, solicitudes, decisiones
-- y justificantes. Aborta si existen, salvo que se ejecute antes:
--   set app.allow_lossy_rollback = 'on';
-- Los archivos del bucket absence-attachments deben borrarse antes con la API de
-- Storage. Los avisos de ausencias en work_events se conservan (inmutables): si
-- los hay, la restricción anterior se restaura sin validar el histórico.
-- =============================================================================

do $$
begin
  if coalesce(current_setting('app.allow_lossy_rollback', true), 'off') <> 'on' and (
    exists (select 1 from public.absence_types)
    or exists (select 1 from public.absence_requests)
    or exists (select 1 from public.vacation_balances)
  ) then
    raise exception 'La reversión perdería tipos, saldos o solicitudes de ausencia. Revisa docs/AUSENCIAS.md y usa app.allow_lossy_rollback si es intencionado.';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'absence-attachments') then
    raise exception 'Quedan justificantes en el bucket absence-attachments: bórralos con la API de Storage antes de revertir.';
  end if;
end;
$$;

drop policy "absence_attachments_select" on storage.objects;
drop policy "absence_attachments_insert" on storage.objects;
delete from storage.buckets where id = 'absence-attachments';

update public.leave_periods set absence_request_id = null where absence_request_id is not null;
alter table public.leave_periods drop constraint leave_periods_absence_request_fkey;
alter table public.leave_periods drop column absence_request_id;

alter table public.work_events drop constraint work_events_event_type_check;
do $$
begin
  if exists (select 1 from public.work_events where event_type in ('absence_decided', 'absence_info_requested')) then
    alter table public.work_events add constraint work_events_event_type_check check (event_type in (
        'reminder_open_entry', 'reminder_missing_start', 'incident_detected', 'correction_decided'
      )) not valid;
  else
    alter table public.work_events add constraint work_events_event_type_check check (event_type in (
        'reminder_open_entry', 'reminder_missing_start', 'incident_detected', 'correction_decided'
      ));
  end if;
end;
$$;

drop function public.settle_vacation_balances();
drop function public.publish_vacation_policy_version(uuid, date);
drop function public.my_absence_access(uuid);
drop function public.absence_calendar(uuid, date, date);
drop function public.my_vacation_balances(uuid, date);
drop function public.adjust_vacation_balance(uuid, uuid, date, integer, text);
drop function public.add_absence_attachment(uuid, text, text, integer);
drop function public.cancel_absence_request(uuid);
drop function public.respond_absence_info(uuid, text);
drop function public.decide_absence_request(uuid, text, text);
drop function public.submit_absence_request(uuid, uuid, public.absence_unit, date, date, uuid, text, integer, integer, text);
drop function public.quote_absence_request(uuid, uuid, public.absence_unit, date, date, text, integer, integer);

drop table public.absence_attachments;
drop table public.absence_request_events;
drop table public.absence_approvals;
drop table public.balance_movements;
drop table public.absence_requests;
drop table public.vacation_balances;
drop table public.policy_assignments;
drop table public.vacation_policy_versions;
drop table public.vacation_policies;
drop table public.absence_types;

drop function private.can_open_absence_attachment(text);
drop function private.object_request_id(text);
drop function private.guard_absence_request();
drop function private.guard_policy_assignment();
drop function private.guard_policy_version();
drop function private.own_employee(uuid);
drop function private.absence_event(uuid, text, text);
drop function private.absence_work_event(uuid, text);
drop function private.evaluate_absence(uuid, uuid, public.absence_unit, date, date, text, integer, integer, uuid);
drop function private.ensure_balance(uuid, uuid, date);
drop function private.settle_balance(uuid, date);
drop function private.post_movement(uuid, public.balance_movement_kind, integer, date, text, uuid, text, date);
drop function private.balance_available(uuid);
drop function private.period_start_for(uuid, date);
drop function private.policy_version_at(uuid, date);
drop function private.policy_for(uuid, uuid, date);
drop function private.employed_days(uuid, date, date);
drop function private.employment_covers(uuid, date, date);
drop function private.is_working_day(uuid, date);
drop function private.employee_today(uuid);
drop function private.round_ratio(bigint, bigint, integer, public.rounding_mode);
drop function private.can_decide_absences(uuid);
drop function private.can_read_employee_absences(uuid);
drop function private.absence_approver(uuid);
drop function private.employee_absence_permission(uuid, text);
drop function private.has_absence_permission(uuid, text, uuid, uuid);
drop function private.role_has_absence_permission(public.app_role, text);

drop type public.policy_scope;
drop type public.balance_movement_kind;
drop type public.absence_request_status;
drop type public.rounding_mode;
drop type public.proration_method;
drop type public.accrual_method;
drop type public.day_count_basis;
drop type public.balance_unit;
drop type public.absence_unit;
