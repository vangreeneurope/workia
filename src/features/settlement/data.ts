import "server-only";

import type { createClient } from "@/lib/supabase/server";

import type { BatchExportData, BatchLine, TotalRow } from "./export/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Datos de un lote leídos con la sesión del usuario (RLS decide qué ve). */
export async function loadBatchData(
  supabase: Supabase,
  batchId: string,
): Promise<BatchExportData | null> {
  const { data: batch } = await supabase
    .from("accounting_batches")
    .select(
      "id, company_id, sequence, kind, period_month, closed_at, note, corrects_batch_id, companies (name, slug)",
    )
    .eq("id", batchId)
    .maybeSingle();
  if (!batch) return null;
  const [linesRes, totalsRes, correctsRes] = await Promise.all([
    supabase
      .from("accounting_batch_lines")
      .select(
        "line_no, employee_code, employee_name, expense_date, category_code, category_name, account_code, tax_account_code, counterpart_account_code, cost_center, project_code, merchant_name, merchant_tax_id, document_number, currency, base_cents, tax_cents, total_cents, adjustment_reason, expense_id",
      )
      .eq("batch_id", batchId)
      .order("line_no"),
    supabase.rpc("accounting_batch_totals", { p_batch: batchId }),
    batch.corrects_batch_id
      ? supabase
          .from("accounting_batches")
          .select("sequence")
          .eq("id", batch.corrects_batch_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (linesRes.error || totalsRes.error) throw new Error("No se pudo cargar el lote.");
  return {
    companyName: batch.companies?.name ?? "",
    companySlug: batch.companies?.slug ?? "empresa",
    batch: {
      id: batch.id,
      sequence: batch.sequence,
      kind: batch.kind,
      periodMonth: batch.period_month,
      closedAt: batch.closed_at,
      correctsSequence: correctsRes.data?.sequence ?? null,
      note: batch.note,
    },
    lines: (linesRes.data ?? []) as BatchLine[],
    totals: (totalsRes.data ?? []).map((t) => ({
      ...t,
      dimension: t.dimension as TotalRow["dimension"],
      base_cents: Number(t.base_cents),
      tax_cents: Number(t.tax_cents),
      total_cents: Number(t.total_cents),
      lines: Number(t.lines),
    })),
  };
}
