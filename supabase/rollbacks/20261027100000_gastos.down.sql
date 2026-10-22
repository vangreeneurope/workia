-- =============================================================================
-- Reversión de 20261027100000_gastos.sql
--
-- Deja el esquema exactamente como tras 20261026100000_ausencias.sql
-- (verificado por scripts/test-db.sh).
--
-- Pérdida de datos: política y categorías de gastos, gastos, tickets, trabajos,
-- ejecuciones de OCR e historial. Aborta si existen, salvo que se ejecute antes:
--   set app.allow_lossy_rollback = 'on';
-- Los archivos del bucket expense-receipts deben borrarse antes con la API de
-- Storage (y solo cuando haya vencido el plazo de conservación).
-- =============================================================================

do $$
begin
  if coalesce(current_setting('app.allow_lossy_rollback', true), 'off') <> 'on' and (
    exists (select 1 from public.expense_policies)
    or exists (select 1 from public.expense_categories)
    or exists (select 1 from public.expenses)
  ) then
    raise exception 'La reversión perdería la configuración o los gastos. Revisa docs/GASTOS.md y usa app.allow_lossy_rollback si es intencionado.';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'expense-receipts') then
    raise exception 'Quedan tickets en el bucket expense-receipts: bórralos con la API de Storage antes de revertir.';
  end if;
end;
$$;

drop policy "expense_receipts_select" on storage.objects;
drop policy "expense_receipts_insert" on storage.objects;
delete from storage.buckets where id = 'expense-receipts';

drop function public.my_expense_access(uuid);
drop function public.set_expense_discarded(uuid, boolean);
drop function public.reopen_expense(uuid);
drop function public.confirm_expense(uuid, text[], boolean);
drop function public.requeue_receipt_ocr(uuid);
drop function public.finish_ocr_run(uuid, public.ocr_status, jsonb, text);
drop function public.claim_ocr_job(uuid, text);
drop function public.create_expense(uuid, uuid, public.expense_source);
drop function public.register_expense_receipt(uuid, uuid, text, text, text, integer, boolean, integer, integer);
drop function public.find_receipt_duplicate(uuid, text);
drop function private.own_expense_for_update(uuid);

drop table public.expense_events;
drop table public.ocr_runs;
drop table public.jobs;
drop table public.expense_receipts;
drop table public.expenses;
drop table public.expense_categories;
drop table public.expense_policies;

drop function private.can_open_expense_receipt(text);
drop function private.is_own_receipt_folder(text);
drop function private.guard_ocr_run();
drop function private.guard_expense();
drop function private.expense_event(uuid, text, text);
drop function private.ocr_result_valid(jsonb);
drop function private.ocr_low_confidence_fields(jsonb);
drop function private.ocr_confidence_threshold();
drop function private.ocr_fields();
drop function private.can_read_employee_expenses(uuid);
drop function private.employee_expense_permission(uuid, text);
drop function private.has_expense_permission(uuid, text, uuid, uuid);
drop function private.role_has_expense_permission(public.app_role, text);

drop type public.job_status;
drop type public.ocr_status;
drop type public.payment_method;
drop type public.expense_source;
drop type public.expense_status;
