"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { adminAction, FORBIDDEN } from "@/features/admin/action-helpers";
import { getOwnEmployeeId } from "@/features/schedules/queries";
import { todayIn } from "@/features/schedules/zoned-time";
import { getUserContext } from "@/lib/auth/dal";
import { canAccessSection } from "@/lib/auth/permissions";
import { dbErrorMessage, dbErrorState } from "@/lib/db-errors";
import { formToObject, validate, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

import { getOcrProvider } from "./ocr/registry";
import { runOcrJob, type OcrQueue } from "./ocr/service";
import { checkReceiptFile } from "./receipt-file";
import {
  categorySchema,
  expenseSchema,
  policySchema,
  reviewedFields,
  statusSchema,
  type ExpenseInput,
} from "./schemas";
import { rateLimited } from "@/lib/rate-limit";

/*
 * La identidad sale de la sesión y la empresa de la empresa activa; los ids que
 * llegan del formulario solo se usan para localizar filas que RLS ya filtra.
 * El ticket se valida en el servidor, se guarda en el bucket privado y el OCR
 * se ejecuta con la sesión de la persona: solo propone datos, que ella confirma.
 * Ningún mensaje ni log incluye el contenido del ticket.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function expenseContext() {
  const ctx = await getUserContext();
  if (!ctx.activeCompanyId || !canAccessSection(ctx, "gastos")) return null;
  return { ctx, companyId: ctx.activeCompanyId };
}

/** Cola de OCR sobre la base de datos y Storage con la sesión del usuario. */
function ocrQueue(supabase: Supabase): OcrQueue {
  return {
    async claim(jobId, providerId) {
      const { data, error } = await supabase.rpc("claim_ocr_job", {
        p_job: jobId,
        p_provider: providerId,
      });
      const row = data?.[0];
      if (error || !row) return null;
      return { runId: row.run_id, storagePath: row.storage_path, mime: row.mime_type };
    },
    async download(storagePath) {
      const { data, error } = await supabase.storage.from("expense-receipts").download(storagePath);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async finish(runId, status, result, errorCode) {
      const { data, error } = await supabase.rpc("finish_ocr_run", {
        p_run: runId,
        p_status: status,
        // El tipo generado de jsonb no admite unknown: el resultado ya está normalizado.
        p_result: (result ?? undefined) as never,
        p_error_code: errorCode ?? undefined,
      });
      if (error) throw new Error("No se pudo guardar el resultado del OCR");
      return data;
    },
  };
}

async function runOcr(supabase: Supabase, jobId: string | null) {
  const provider = getOcrProvider();
  if (!provider || !jobId) return;
  await runOcrJob(jobId, provider, ocrQueue(supabase));
}

/** Sube un ticket: valida, comprueba duplicados, lo guarda y lanza la lectura. */
export async function uploadReceipt(_prev: FormState, formData: FormData): Promise<FormState> {
  const scope = await expenseContext();
  if (!scope) return FORBIDDEN;
  const key = z.uuid().safeParse(formData.get("idempotency_key"));
  const file = formData.get("receipt");
  if (!key.success) return { status: "error", message: "Vuelve a elegir el archivo." };
  if (!(file instanceof File) || file.size === 0) {
    return {
      status: "error",
      message: "Haz una foto del ticket o elige un archivo.",
      fieldErrors: { receipt: ["Elige un archivo"] },
    };
  }
  const limited = await rateLimited(await createClient(), "upload");
  if (limited) return limited;
  const checked = checkReceiptFile({
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    declaredMime: file.type,
  });
  if (!checked.ok)
    return { status: "error", message: checked.error, fieldErrors: { receipt: [checked.error] } };

  const supabase = await createClient();
  const employeeId = await getOwnEmployeeId();
  if (!employeeId)
    return { status: "error", message: "No tienes ficha de empleado en esta empresa." };

  const { data: duplicate, error: dupError } = await supabase.rpc("find_receipt_duplicate", {
    p_company: scope.companyId,
    p_sha256: checked.sha256,
  });
  if (dupError) return dbErrorState(dupError);
  const existing = duplicate?.[0];
  if (existing?.owner === "other") {
    return {
      status: "error",
      message:
        "Este ticket ya está registrado en tu empresa. Si crees que es un error, consulta con Contabilidad.",
    };
  }
  let expenseId = existing?.owner === "own" ? existing.expense_id : null;

  if (!expenseId) {
    const [year, month] = todayIn("Europe/Madrid").split("-");
    // Nombre = clave de idempotencia: un reintento reutiliza el mismo objeto.
    const path = `${scope.companyId}/${employeeId}/${year}/${month}/${key.data}.${checked.extension}`;
    const { error: uploadError } = await supabase.storage
      .from("expense-receipts")
      .upload(path, checked.bytes, { contentType: checked.mime, upsert: false });
    if (uploadError && !/exists|duplicate/i.test(uploadError.message)) {
      return { status: "error", message: "No se pudo guardar el ticket. Inténtalo de nuevo." };
    }
    const { data, error } = await supabase.rpc("register_expense_receipt", {
      p_company: scope.companyId,
      p_idempotency_key: key.data,
      p_path: path,
      p_sha256: checked.sha256,
      p_mime: checked.mime,
      p_size: checked.bytes.length,
      p_enqueue_ocr: getOcrProvider() !== null,
      p_width: checked.width ?? undefined,
      p_height: checked.height ?? undefined,
    });
    if (error) return dbErrorState(error);
    const row = data?.[0];
    if (!row) return { status: "error", message: "No se pudo registrar el ticket." };
    expenseId = row.expense_id;
    if (row.created) await runOcr(supabase, row.job_id);
  }
  redirect(`/gastos/${expenseId}`);
}

/** Gasto sin ticket (kilometraje o manual si la política lo permite). */
export async function createExpenseWithoutReceipt(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const scope = await expenseContext();
  if (!scope) return FORBIDDEN;
  const parsed = z
    .object({ idempotency_key: z.uuid(), source: z.enum(["manual", "mileage"]) })
    .safeParse(formToObject(formData));
  if (!parsed.success) return { status: "error", message: "Vuelve a intentarlo." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_expense", {
    p_company: scope.companyId,
    p_idempotency_key: parsed.data.idempotency_key,
    p_source: parsed.data.source,
  });
  if (error || !data)
    return error ? dbErrorState(error) : { status: "error", message: "No se pudo crear." };
  redirect(`/gastos/${data}`);
}

async function saveFields(supabase: Supabase, d: ExpenseInput): Promise<FormState | null> {
  const { data, error } = await supabase
    .from("expenses")
    .update({
      category_id: d.category_id,
      expense_date: d.expense_date,
      merchant_name: d.merchant_name,
      merchant_tax_id: d.merchant_tax_id,
      document_number: d.document_number,
      currency: d.currency,
      base_cents: d.base_cents,
      tax_cents: d.tax_cents,
      total_cents: d.total_cents,
      payment_method: d.payment_method,
      client_name: d.client_name,
      project_code: d.project_code,
      cost_center: d.cost_center,
      notes: d.notes,
      distance_km_tenths: d.distance_km,
    })
    .eq("id", d.expense_id)
    .select("id");
  if (error) return dbErrorState(error);
  // RLS solo deja editar borradores propios.
  if (!data?.length) return { status: "error", message: "Este gasto ya no se puede editar." };
  return null;
}

export async function saveExpense(_prev: FormState, formData: FormData): Promise<FormState> {
  const scope = await expenseContext();
  if (!scope) return FORBIDDEN;
  const parsed = validate(expenseSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const failed = await saveFields(supabase, parsed.data);
  if (failed) return failed;
  refresh();
  return { status: "success", message: "Borrador guardado. Aún no está listo." };
}

const DEVIATION_LABELS: Record<string, string> = {
  over_category_limit: "supera el límite de la categoría (justificado en las notas)",
  total_differs_from_ocr: "el total no coincide con el leído del ticket",
  possible_duplicate_acknowledged: "has confirmado que no es un duplicado",
};

/** Guarda y confirma: la base de datos aplica las reglas de la política. */
export async function confirmExpense(_prev: FormState, formData: FormData): Promise<FormState> {
  const scope = await expenseContext();
  if (!scope) return FORBIDDEN;
  const parsed = validate(expenseSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const failed = await saveFields(supabase, parsed.data);
  if (failed) return failed;
  const { data, error } = await supabase.rpc("confirm_expense", {
    p_expense: parsed.data.expense_id,
    p_reviewed_fields: reviewedFields(parsed.data),
    p_duplicate_ack: parsed.data.duplicate_ack,
  });
  if (error) {
    refresh();
    return { status: "error", message: dbErrorMessage(error) };
  }
  refresh();
  const notes = (Array.isArray(data) ? data : [])
    .map((d) => (typeof d === "string" ? DEVIATION_LABELS[d] : undefined))
    .filter(Boolean);
  return {
    status: "success",
    message: notes.length
      ? `Gasto listo. Queda registrado que ${notes.join("; ")}.`
      : "Gasto listo.",
  };
}

/** Vuelve a intentar la lectura automática (reintentos limitados en la base de datos). */
export async function retryOcr(expenseId: string): Promise<FormState> {
  const scope = await expenseContext();
  if (!scope || !z.uuid().safeParse(expenseId).success) return FORBIDDEN;
  const supabase = await createClient();
  const { data: jobId, error } = await supabase.rpc("requeue_receipt_ocr", {
    p_expense: expenseId,
  });
  if (error) return dbErrorState(error);
  if (!getOcrProvider()) {
    return {
      status: "error",
      message: "La lectura automática no está disponible. Completa los datos a mano.",
    };
  }
  await runOcr(supabase, jobId);
  refresh();
  return { status: "success" };
}

export async function reopenExpense(expenseId: string): Promise<FormState> {
  const scope = await expenseContext();
  if (!scope || !z.uuid().safeParse(expenseId).success) return FORBIDDEN;
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_expense", { p_expense: expenseId });
  if (error) return dbErrorState(error);
  refresh();
  return { status: "success" };
}

export async function setExpenseDiscarded(
  expenseId: string,
  discarded: boolean,
): Promise<FormState> {
  const scope = await expenseContext();
  if (!scope || !z.uuid().safeParse(expenseId).success) return FORBIDDEN;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_expense_discarded", {
    p_expense: expenseId,
    p_discarded: discarded,
  });
  if (error) return dbErrorState(error);
  refresh();
  return { status: "success" };
}

// -----------------------------------------------------------------------------
// Administración
// -----------------------------------------------------------------------------

export async function createCategory(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("gastos", categorySchema, formData, async ({ ctx, data, supabase }) => {
    const { error } = await supabase.from("expense_categories").insert({
      company_id: ctx.companyId,
      code: data.code,
      name: data.name,
      is_mileage: data.is_mileage,
      max_amount_cents: data.max_amount,
      requires_client: data.requires_client,
      requires_project: data.requires_project,
      requires_cost_center: data.requires_cost_center,
      requires_notes: data.requires_notes,
    });
    if (error?.code === "23505") {
      return {
        status: "error",
        message: "Ya hay una categoría con ese código.",
        fieldErrors: { code: ["Código repetido"] },
      };
    }
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success", message: "Categoría creada." };
  });
}

export async function setCategoryStatus(input: {
  id: string;
  status: "active" | "inactive";
}): Promise<FormState> {
  return adminAction("gastos", statusSchema, input, async ({ ctx, data, supabase }) => {
    const { data: rows, error } = await supabase
      .from("expense_categories")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("company_id", ctx.companyId)
      .select("id");
    if (error) return dbErrorState(error);
    if (!rows?.length) return FORBIDDEN;
    refresh();
    return { status: "success" };
  });
}

export async function savePolicy(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("gastos", policySchema, formData, async ({ ctx, data, supabase }) => {
    const values = {
      max_days_past: data.max_days_past,
      default_currency: data.default_currency,
      allowed_currencies: data.allowed_currencies,
      receipt_required: data.receipt_required,
      mileage_rate_milli: data.mileage_rate,
      ocr_total_tolerance_cents: data.ocr_total_tolerance ?? 0,
      legal_reference: data.legal_reference,
    };
    const { data: existing } = await supabase
      .from("expense_policies")
      .select("id")
      .eq("company_id", ctx.companyId)
      .maybeSingle();
    const { error } = existing
      ? await supabase.from("expense_policies").update(values).eq("id", existing.id)
      : await supabase.from("expense_policies").insert({ company_id: ctx.companyId, ...values });
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success", message: "Política de gastos guardada." };
  });
}
