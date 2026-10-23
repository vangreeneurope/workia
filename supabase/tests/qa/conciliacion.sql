-- Conciliación contable (auditoría QA) sobre la base poblada:
--  1. En cada lote, cada dimensión de accounting_batch_totals suma lo mismo que el total.
--  2. Cada línea de un lote procedente de un informe tiene el importe del gasto de origen.
--  3. Las líneas de los lotes suman lo mismo que los gastos aprobados que incluyen.
--  4. El informe de gastos (report_expenses) suma lo mismo que los gastos que RLS deja ver.
\set QUIET on
create temp table qa_rec (check_name text, ok boolean, detail text);
grant all on qa_rec to public;
select test.act_as(test.u(9));  -- Contabilidad de A (aal2)
set role authenticated;
insert into qa_rec
select 'dimensiones = total por moneda (lote ' || b.id || ')',
  bool_and(d.s = t.total_cents and d.n = t.lines),
  string_agg(t.currency || ' ' || d.dimension || ':' || d.s || '/' || t.total_cents, ' ')
from public.accounting_batches b
cross join lateral (select currency, total_cents, lines from public.accounting_batch_totals(b.id) where dimension = 'total') t
cross join lateral (select dimension, sum(total_cents) s, sum(lines) n from public.accounting_batch_totals(b.id) x
  where x.dimension <> 'total' and x.currency = t.currency group by dimension) d
group by b.id;
reset role;
insert into qa_rec
select 'línea = gasto de origen', count(*) = 0, count(*) || ' líneas con importe distinto del gasto'
from public.accounting_batch_lines l
join public.expense_report_items i on i.id = l.report_item_id
join public.expenses x on x.id = i.expense_id
where l.total_cents <> x.total_cents or l.expense_id is distinct from x.id;
insert into qa_rec
select 'lote = suma de gastos incluidos', bool_and(s_lines = s_exp), string_agg(s_lines || '/' || s_exp, ' ')
from (select l.batch_id, sum(l.total_cents) filter (where l.report_item_id is not null) s_lines,
        sum(x.total_cents) filter (where l.report_item_id is not null) s_exp
      from public.accounting_batch_lines l left join public.expenses x on x.id = l.expense_id group by l.batch_id) q;
select test.act_as(test.u(9));
set role authenticated;
insert into qa_rec
select 'informe de gastos = gastos visibles', coalesce(r.s, 0) = coalesce(x.s, 0), coalesce(r.s, 0) || '/' || coalesce(x.s, 0)
from (select sum(total_cents) s from public.report_expenses(test.co('A'), current_date - 365, current_date, 'employee')) r,
     (select sum(total_cents) s from public.expenses where company_id = test.co('A') and status = 'ready'
        and expense_date between current_date - 365 and current_date) x;
reset role;
\set QUIET off
select check_name, ok, left(detail, 120) from qa_rec order by 1;
do $$ begin
  if (select count(*) from qa_rec) < 3 then raise exception 'Conciliación sin datos suficientes'; end if;
  if exists (select 1 from qa_rec where not ok) then raise exception 'DESCUADRE contable: %',
    (select string_agg(check_name, '; ') from qa_rec where not ok); end if;
end $$;
