"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { adminAction, FORBIDDEN } from "@/features/admin/action-helpers";
import { getUserContext } from "@/lib/auth/dal";
import { canAccessSection } from "@/lib/auth/permissions";
import { dbErrorMessage, dbErrorState } from "@/lib/db-errors";
import { formToObject, validate, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

import { loadBatchData } from "./data";
import { batchCsv } from "./export/csv";
import { exportFileName } from "./export/names";
import { batchPdf } from "./export/pdf";
import { receiptsZip, type ReceiptFile } from "./export/receipts-zip";
import { assertTotalsMatch } from "./export/totals";
import { batchXlsx } from "./export/xlsx";
import { sha256Hex } from "@/features/expenses/receipt-file";
import {
  closeSchema,
  completeStepSchema,
  correctiveSchema,
  lineDecisionSchema,
  mappingSchema,
  ruleSchema,
  submitReportSchema,
} from "./schemas";

/*
 * Identidad desde la sesión y empresa desde la empresa activa. La base de datos
 * decide quién puede aprobar, cerrar y descargar (RLS y funciones); aquí solo se
 * validan formularios y se generan los archivos con los datos que ella devuelve.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function scope() {
  const ctx = await getUserContext();
  if (!ctx.activeCompanyId || !canAccessSection(ctx, "gastos")) return null;
  return { ctx, companyId: ctx.activeCompanyId };
}

export async function submitReport(_prev: FormState, formData: FormData): Promise<FormState> {
  const s = await scope();
  if (!s) return FORBIDDEN;
  const parsed = validate(submitReportSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_expense_report", {
    p_company: s.companyId,
    p_period: `${parsed.data.period}-01`,
    p_idempotency_key: parsed.data.idempotency_key,
  });
  if (error || !data)
    return error ? dbErrorState(error) : { status: "error", message: "No se pudo enviar." };
  redirect(`/gastos/informes/${data}`);
}

export async function decideLine(_prev: FormState, formData: FormData): Promise<FormState> {
  const s = await scope();
  if (!s) return FORBIDDEN;
  const parsed = validate(lineDecisionSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_report_line", {
    p_item: parsed.data.item_id,
    p_decision: parsed.data.decision,
    p_comment: parsed.data.comment ?? undefined,
  });
  if (error) return dbErrorState(error);
  refresh();
  return { status: "success", message: "Decisión guardada." };
}

const STEP_MESSAGES: Record<string, string> = {
  returned: "Informe devuelto a la persona para que corrija las líneas marcadas.",
  in_review: "Paso aprobado: el informe pasa al siguiente aprobador.",
  approved: "Informe aprobado: queda listo para el cierre contable.",
};

export async function completeStep(_prev: FormState, formData: FormData): Promise<FormState> {
  const s = await scope();
  if (!s) return FORBIDDEN;
  const parsed = validate(completeStepSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_report_step", {
    p_report: parsed.data.report_id,
    p_action: parsed.data.action,
    p_comment: parsed.data.comment ?? undefined,
  });
  if (error) return dbErrorState(error);
  refresh();
  return { status: "success", message: STEP_MESSAGES[data ?? ""] ?? "Hecho." };
}

export async function closePeriod(_prev: FormState, formData: FormData): Promise<FormState> {
  const s = await scope();
  if (!s) return FORBIDDEN;
  const parsed = validate(closeSchema, {
    ...formToObject(formData),
    excluded: formData.getAll("excluded").filter((v): v is string => typeof v === "string"),
  });
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("close_accounting_period", {
    p_company: s.companyId,
    p_period: `${parsed.data.period}-01`,
    p_idempotency_key: parsed.data.idempotency_key,
    p_excluded: parsed.data.excluded,
    p_reason: parsed.data.reason ?? undefined,
  });
  if (error || !data)
    return error ? dbErrorState(error) : { status: "error", message: "No se pudo cerrar." };
  // El paquete se genera a continuación; si falla, se puede volver a generar desde el lote.
  await generateFiles(supabase, data).catch(() => null);
  redirect(`/gastos/contabilidad/lotes/${data}`);
}

/** Descarga los tickets de las líneas del lote (Contabilidad los puede leer por RLS). */
async function loadReceipts(supabase: Supabase, expenseIds: string[]): Promise<ReceiptFile[]> {
  if (expenseIds.length === 0) return [];
  const { data } = await supabase
    .from("expense_receipts")
    .select("expense_id, storage_path, mime_type")
    .in("expense_id", expenseIds);
  const out: ReceiptFile[] = [];
  for (const r of data ?? []) {
    const file = await supabase.storage.from("expense-receipts").download(r.storage_path);
    if (file.error || !file.data) throw new Error("No se pudo leer un justificante");
    out.push({
      expenseId: r.expense_id,
      extension:
        r.mime_type === "application/pdf" ? "pdf" : r.mime_type === "image/png" ? "png" : "jpg",
      bytes: new Uint8Array(await file.data.arrayBuffer()),
    });
  }
  return out;
}

const MIME = {
  pdf: "application/pdf",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
} as const;

/**
 * Genera (o vuelve a generar) PDF, CSV, XLSX y ZIP del lote. Son deterministas:
 * regenerar produce los mismos bytes y la base de datos rechaza cualquier
 * archivo distinto del ya registrado.
 */
async function generateFiles(supabase: Supabase, batchId: string): Promise<FormState> {
  const data = await loadBatchData(supabase, batchId);
  if (!data) return FORBIDDEN;
  assertTotalsMatch(data.lines, data.totals);
  const receipts = await loadReceipts(
    supabase,
    data.lines.map((l) => l.expense_id).filter((id): id is string => id !== null),
  );
  const files: [keyof typeof MIME, Uint8Array][] = [
    ["pdf", await batchPdf(data)],
    ["csv", batchCsv(data)],
    ["xlsx", batchXlsx(data)],
    ["zip", receiptsZip(data, receipts)],
  ];
  const { data: company } = await supabase
    .from("accounting_batches")
    .select("company_id")
    .eq("id", batchId)
    .single();
  for (const [format, bytes] of files) {
    const name = exportFileName(data, format);
    const path = `${company?.company_id}/lotes/${batchId}/${name}`;
    const upload = await supabase.storage
      .from("accounting-exports")
      .upload(path, bytes, { contentType: MIME[format], upsert: false });
    if (upload.error && !/exists|duplicate/i.test(upload.error.message)) {
      return { status: "error", message: "No se pudo guardar el paquete contable." };
    }
    const { error } = await supabase.rpc("register_accounting_export", {
      p_batch: batchId,
      p_format: format,
      p_file_name: name,
      p_path: path,
      p_sha256: sha256Hex(bytes),
      p_size: bytes.length,
    });
    if (error) return dbErrorState(error);
  }
  return {
    status: "success",
    message: "Paquete contable generado: PDF, CSV, XLSX y justificantes.",
  };
}

export async function generateExports(batchId: string): Promise<FormState> {
  const s = await scope();
  if (!s || !z.uuid().safeParse(batchId).success) return FORBIDDEN;
  const supabase = await createClient();
  try {
    const result = await generateFiles(supabase, batchId);
    refresh();
    return result;
  } catch {
    return { status: "error", message: "No se pudo generar el paquete. Inténtalo de nuevo." };
  }
}

export async function createCorrectiveBatch(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const s = await scope();
  if (!s) return FORBIDDEN;
  const parsed = validate(correctiveSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const d = parsed.data;
  const adjustments = d.employee_id
    ? [
        {
          employee_id: d.employee_id,
          category_id: d.category_id,
          currency: d.currency,
          total_cents: d.amount,
          reason: d.reason,
        },
      ]
    : [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_corrective_batch", {
    p_batch: d.batch_id,
    p_idempotency_key: d.idempotency_key,
    p_include_late_reports: d.include_late_reports,
    p_adjustments: adjustments,
    p_note: d.note,
  });
  if (error || !data)
    return error ? dbErrorState(error) : { status: "error", message: "No se pudo crear." };
  await generateFiles(supabase, data).catch(() => null);
  redirect(`/gastos/contabilidad/lotes/${data}`);
}

export async function markAccounted(batchId: string): Promise<FormState> {
  const s = await scope();
  if (!s || !z.uuid().safeParse(batchId).success) return FORBIDDEN;
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_batch_accounted", { p_batch: batchId });
  if (error) return { status: "error", message: dbErrorMessage(error) };
  refresh();
  return { status: "success", message: "Lote marcado como contabilizado." };
}

// -----------------------------------------------------------------------------
// Administración: mapeo contable y reglas de aprobación
// -----------------------------------------------------------------------------

export async function saveMapping(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("gastos", mappingSchema, formData, async ({ ctx, data, supabase }) => {
    let query = supabase
      .from("expense_account_mappings")
      .select("id")
      .eq("company_id", ctx.companyId);
    query = data.category_id
      ? query.eq("category_id", data.category_id)
      : query.is("category_id", null);
    const { data: existing } = await query.maybeSingle();
    const values = {
      account_code: data.account_code,
      tax_account_code: data.tax_account_code,
      counterpart_account_code: data.counterpart_account_code,
    };
    const { error } = existing
      ? await supabase.from("expense_account_mappings").update(values).eq("id", existing.id)
      : await supabase
          .from("expense_account_mappings")
          .insert({ company_id: ctx.companyId, category_id: data.category_id, ...values });
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success", message: "Cuenta contable guardada." };
  });
}

export async function createRule(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("gastos", ruleSchema, formData, async ({ ctx, data, supabase }) => {
    const { error } = await supabase.from("expense_approval_rules").insert({
      company_id: ctx.companyId,
      name: data.name,
      step_order: data.step_order,
      currency: data.currency,
      min_total_cents: data.min_total,
      category_id: data.category_id,
      approver_role: data.approver_role,
    });
    if (error?.code === "23505")
      return { status: "error", message: "Ya hay una regla con ese nombre." };
    if (error) return dbErrorState(error);
    refresh();
    return {
      status: "success",
      message: "Regla creada. Se aplica a los informes que se envíen a partir de ahora.",
    };
  });
}

export async function setRuleStatus(input: {
  id: string;
  status: "active" | "inactive";
}): Promise<FormState> {
  return adminAction(
    "gastos",
    z.object({ id: z.uuid(), status: z.enum(["active", "inactive"]) }),
    input,
    async ({ ctx, data, supabase }) => {
      const { data: rows, error } = await supabase
        .from("expense_approval_rules")
        .update({ status: data.status })
        .eq("id", data.id)
        .eq("company_id", ctx.companyId)
        .select("id");
      if (error) return dbErrorState(error);
      if (!rows?.length) return FORBIDDEN;
      refresh();
      return { status: "success" };
    },
  );
}
