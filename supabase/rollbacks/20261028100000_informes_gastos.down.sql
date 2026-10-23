-- =============================================================================
-- Reversión de 20261028100000_informes_gastos.sql
--
-- Deja el esquema exactamente como tras 20261027100000_gastos.sql (verificado
-- por scripts/test-db.sh).
--
-- Pérdida de datos: reglas de aprobación, mapeo contable, informes, decisiones,
-- lotes contables y registro de exportaciones. Aborta si existen, salvo que se
-- ejecute antes:
--   set app.allow_lossy_rollback = 'on';
-- Los archivos del bucket accounting-exports deben borrarse antes con la API de
-- Storage (y solo cuando haya vencido su plazo de conservación).
-- =============================================================================

do $$
begin
  if coalesce(current_setting('app.allow_lossy_rollback', true), 'off') <> 'on' and (
    exists (select 1 from public.expense_approval_rules)
    or exists (select 1 from public.expense_account_mappings)
    or exists (select 1 from public.expense_reports)
    or exists (select 1 from public.accounting_batches)
  ) then
    raise exception 'La reversión perdería informes, lotes o configuración contable. Revisa docs/LIQUIDACION_GASTOS.md y usa app.allow_lossy_rollback si es intencionado.';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'accounting-exports') then
    raise exception 'Quedan paquetes en el bucket accounting-exports: bórralos con la API de Storage antes de revertir.';
  end if;
end;
$$;

drop policy "accounting_exports_select" on storage.objects;
drop policy "accounting_exports_insert" on storage.objects;
delete from storage.buckets where id = 'accounting-exports';

drop function public.log_export_download(uuid);
drop function public.register_accounting_export(uuid, public.accounting_export_format, text, text, text, bigint);
drop function public.accounting_batch_totals(uuid);
drop function public.mark_batch_accounted(uuid);
drop function public.create_corrective_batch(uuid, uuid, boolean, jsonb, text);
drop function public.close_accounting_period(uuid, date, uuid, uuid[], text);
drop function public.accounting_close_blockers(uuid, date);
drop function public.my_pending_expense_approvals(uuid);
drop function public.complete_report_step(uuid, text, text);
drop function public.decide_report_line(uuid, public.report_line_decision, text);
drop function public.submit_expense_report(uuid, date, uuid);
drop function private.insert_batch_lines(uuid, uuid, uuid[], integer);

drop table public.accounting_export_events;
drop table public.accounting_exports;
drop table public.accounting_batch_exclusions;
drop table public.accounting_batch_lines;
drop table public.accounting_batches;
drop table public.approval_steps;
drop table public.approval_instances;
drop table public.expense_report_items;
drop table public.expense_reports;
drop table public.expense_account_mappings;
drop table public.expense_approval_rules;

drop function private.guard_accounting_batch();
drop function private.guard_report_status();
drop function private.guard_report_item();
drop function private.can_view_report(uuid);
drop function private.can_act_on_step(uuid);
drop function private.employee_user(uuid);
drop function private.expense_substitute_of(uuid, uuid);

-- Funciones de 20261027100000_gastos.sql, restauradas tal cual.
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

drop function private.expense_locked(uuid);

drop type public.accounting_export_format;
drop type public.accounting_batch_kind;
drop type public.approval_step_status;
drop type public.report_line_decision;
drop type public.expense_report_status;
