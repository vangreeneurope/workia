-- =============================================================================
-- Reversión de 20261029100000_avisos.sql
--
-- Deja el esquema exactamente como tras 20261028100000_informes_gastos.sql
-- (verificado por scripts/test-db.sh).
--
-- Pérdida de datos: outbox, avisos, preferencias, entregas de correo, eventos de
-- webhook y registro de tareas. Aborta si existen avisos o preferencias, salvo:
--   set app.allow_lossy_rollback = 'on';
-- =============================================================================

do $$
begin
  if coalesce(current_setting('app.allow_lossy_rollback', true), 'off') <> 'on' and (
    exists (select 1 from public.notification_outbox)
    or exists (select 1 from public.notification_preferences)
  ) then
    raise exception 'La reversión perdería avisos o preferencias. Revisa docs/AVISOS.md y usa app.allow_lossy_rollback si es intencionado.';
  end if;
end;
$$;

drop trigger notify_absence_request_events on public.absence_request_events;
drop trigger notify_approval_steps on public.approval_steps;
drop trigger notify_expense_reports on public.expense_reports;
drop trigger notify_work_events on public.work_events;
drop trigger notify_schedule_events on public.schedule_events;

drop function public.recent_job_runs(integer);
drop function public.record_job_run(text, timestamptz, boolean, jsonb, text);
drop function public.run_scheduled_reminders(timestamptz);
drop function public.notification_support_summary(uuid);
drop function public.mark_notifications_read(uuid, uuid[]);
drop function public.open_notification(uuid);
drop function public.retry_email_delivery(uuid);
drop function public.record_email_event(text, text, text, text, timestamptz);
drop function public.complete_email_delivery(uuid, text, text, text, text, boolean);
drop function public.claim_email_deliveries(integer);
drop function public.process_notification_outbox(integer);
drop function private.notification_target_allowed(uuid);
drop function private.outbox_params(public.notification_outbox);
drop function private.outbox_link(public.notification_outbox);
drop function private.outbox_recipients(bigint);

drop table private.scheduled_job_runs;
drop table public.email_delivery_events;
drop table public.email_deliveries;
drop table public.notification_preferences;
drop table public.notifications;
drop table public.notification_outbox;

drop function private.guard_notification();
drop function private.users_with_role_over(uuid, public.app_role[]);
drop function private.user_is_current_member(uuid, uuid);
drop function private.notify_from_schedule_event();
drop function private.notify_from_work_event();
drop function private.notify_from_expense_report();
drop function private.notify_from_approval_step();
drop function private.notify_from_absence_event();
drop function private.enqueue_notification(uuid, text, text, uuid, uuid, text, jsonb);
drop function private.notification_event_is_reminder(text);
drop function private.notification_event_mandatory(text);
drop function private.notification_event_types();
