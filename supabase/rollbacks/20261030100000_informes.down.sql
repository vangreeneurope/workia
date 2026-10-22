-- =============================================================================
-- Reversión de 20261030100000_informes.sql
--
-- Deja el esquema exactamente como tras 20261029100000_avisos.sql
-- (verificado por scripts/test-db.sh).
--
-- Pérdida de datos: registro de exportaciones y descargas, y la columna
-- request_id de audit_events. Aborta si existen exportaciones, salvo:
--   set app.allow_lossy_rollback = 'on';
-- La auditoría no se borra: si audit_events ya contiene acciones de esta
-- migración (status_change, request_export, download), la restricción original
-- se restaura como NOT VALID (mismo criterio que la reversión de horarios).
-- Los archivos del bucket report-exports deben borrarse antes con la API de
-- Storage.
-- =============================================================================

do $$
begin
  if coalesce(current_setting('app.allow_lossy_rollback', true), 'off') <> 'on'
     and exists (select 1 from public.report_exports) then
    raise exception 'La reversión perdería el registro de exportaciones. Revisa docs/INFORMES.md y usa app.allow_lossy_rollback si es intencionado.';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'report-exports') then
    raise exception 'Quedan archivos en el bucket report-exports: bórralos con la API de Storage antes de revertir.';
  end if;
end;
$$;

drop policy "report_exports_select" on storage.objects;
drop policy "report_exports_insert" on storage.objects;
delete from storage.buckets where id = 'report-exports';

drop function public.expire_report_exports();
drop function public.log_report_download(uuid);
drop function public.fail_report_export(uuid, text);
drop function public.complete_report_export(uuid, text, text, text, bigint, integer);
drop function public.start_report_export(uuid);
drop function public.request_report_export(uuid, text, text, jsonb, uuid);
drop function private.report_export_event(uuid, text);

drop table public.report_export_downloads;
drop table public.report_exports;
drop function private.guard_report_export();
drop function private.can_read_report_export(text);
drop function private.can_write_report_export(text);

drop function public.report_audit(uuid, date, date, uuid, text, text, text, integer, integer);
drop function public.report_closures(uuid, date, date);
drop function public.report_approvals(uuid, date, date);
drop function public.report_expenses(uuid, date, date, text, uuid, uuid, uuid, text, text, integer, integer);
drop function public.report_absence_requests(uuid, date, date, uuid, uuid, uuid, integer, integer);
drop function public.report_absence_balances(uuid, date, uuid, uuid, uuid, integer, integer);
drop function public.report_time_register(uuid, date, date, uuid, uuid, uuid, integer, integer);
drop function public.report_time_summary(uuid, date, date, uuid, uuid, uuid, integer, integer);
drop function public.report_time_daily(uuid, date, date, uuid, uuid, uuid, integer, integer);
drop function private.report_scope(uuid, text);
drop function private.report_check(date, date, integer, integer, integer);

drop index public.accounting_batches_company_period_idx;
drop index public.time_adjustments_company_idx;
drop index public.absence_requests_company_start_idx;
drop index public.expenses_company_date_idx;

drop trigger audit_events_time_correction_requests on public.time_correction_requests;
drop trigger audit_events_time_adjustments on public.time_adjustments;
drop trigger audit_events_accounting_batches on public.accounting_batches;
drop trigger audit_events_expense_reports on public.expense_reports;
drop trigger audit_events_absence_requests on public.absence_requests;
drop function private.audit_status_event();

drop index public.audit_events_entity_time_idx;
drop index public.audit_events_actor_idx;
alter table public.audit_events drop constraint audit_events_action_check;
do $$
begin
  if exists (select 1 from public.audit_events where action in ('status_change', 'request_export', 'download')) then
    alter table public.audit_events add constraint audit_events_action_check check (action in (
        'create', 'update', 'deactivate', 'reactivate', 'terminate', 'export', 'import', 'publish'
      )) not valid;
  else
    alter table public.audit_events add constraint audit_events_action_check check (action in (
        'create', 'update', 'deactivate', 'reactivate', 'terminate', 'export', 'import', 'publish'
      ));
  end if;
end;
$$;
alter table public.audit_events drop column request_id;
drop function private.current_request_id();

-- Minimización original (20261023100000_administracion.sql).
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
                   'tax_id', 'reason', 'address_line')
        and value <> 'null'::jsonb then to_jsonb('[dato personal]'::text)
      else value
    end
  ), '{}'::jsonb)
  from jsonb_each(p_data);
$$;
