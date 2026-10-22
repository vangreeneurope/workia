"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { adminAction, FORBIDDEN } from "@/features/admin/action-helpers";
import { getUserContext } from "@/lib/auth/dal";
import { canAccessSection } from "@/lib/auth/permissions";
import { addDays } from "@/lib/dates";
import { dbErrorMessage, dbErrorState } from "@/lib/db-errors";
import { formToObject, validate, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

import { checkAttachment } from "./attachments";
import {
  adjustmentSchema,
  assignmentSchema,
  decisionSchema,
  infoResponseSchema,
  policySchema,
  publishSchema,
  requestSchema,
  typeSchema,
  versionSchema,
} from "./schemas";
import { parseAmount, type BalanceUnit } from "./units";

/*
 * La identidad sale de la sesión y la empresa de la empresa activa. La base de
 * datos valida contrato, política, saldo, solapes, festivos y turno, reserva el
 * saldo bajo bloqueo y decide quién aprueba. Los mensajes no incluyen nombres,
 * motivos ni datos de salud.
 */

/** Los text[] de PostgreSQL llegan sin tipo desde el generador: se validan aquí. */
function toStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export type QuoteResult = FormState & {
  amount?: number;
  unit?: BalanceUnit;
  available?: number | null;
  warnings?: string[];
};

/** Simulación antes de enviar: cantidad, saldo disponible y problemas. */
export async function quoteAbsence(formData: FormData): Promise<QuoteResult> {
  const ctx = await getUserContext();
  if (!ctx.activeCompanyId || !canAccessSection(ctx, "ausencias")) return FORBIDDEN;
  const parsed = validate(requestSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const d = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quote_absence_request", {
    p_company: ctx.activeCompanyId,
    p_type: d.type_id,
    p_unit: d.unit,
    p_start: d.start_date,
    p_end: d.end_date,
    p_half: d.half ?? undefined,
    p_start_minute: d.start_time ?? undefined,
    p_end_minute: d.end_time ?? undefined,
  });
  if (error) return { status: "error", message: dbErrorMessage(error) };
  const row = data?.[0];
  if (!row) return { status: "error", message: "No se pudo calcular la solicitud." };
  if (toStrings(row.errors).length > 0)
    return { status: "error", message: toStrings(row.errors).join(". ") };
  return {
    status: "success",
    amount: row.amount,
    unit: row.amount_unit,
    available: row.available,
    warnings: toStrings(row.warnings),
  };
}

async function uploadAttachment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  requestId: string,
  file: File,
): Promise<string | null> {
  const checked = checkAttachment(new Uint8Array(await file.arrayBuffer()));
  if (!checked.ok) return checked.error;
  const { data: request } = await supabase
    .from("absence_requests")
    .select("employee_id")
    .eq("id", requestId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!request) return "Solicitud no encontrada.";
  // Nombre aleatorio: el original no se guarda (puede contener datos sensibles).
  const path = `${companyId}/${request.employee_id}/${requestId}/${crypto.randomUUID()}.${checked.extension}`;
  const { error: uploadError } = await supabase.storage
    .from("absence-attachments")
    .upload(path, checked.bytes, { contentType: checked.mime, upsert: false });
  if (uploadError) return "No se pudo guardar el justificante.";
  const { error } = await supabase.rpc("add_absence_attachment", {
    p_request: requestId,
    p_path: path,
    p_mime: checked.mime,
    p_size: checked.bytes.length,
  });
  return error ? dbErrorMessage(error) : null;
}

export async function submitAbsence(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getUserContext();
  const companyId = ctx.activeCompanyId;
  if (!companyId || !canAccessSection(ctx, "ausencias")) return FORBIDDEN;
  const parsed = validate(requestSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const d = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_absence_request", {
    p_company: companyId,
    p_type: d.type_id,
    p_unit: d.unit,
    p_start: d.start_date,
    p_end: d.end_date,
    p_idempotency_key: d.idempotency_key,
    p_half: d.half ?? undefined,
    p_start_minute: d.start_time ?? undefined,
    p_end_minute: d.end_time ?? undefined,
    p_note: d.note ?? undefined,
  });
  if (error) return dbErrorState(error);
  const result = (data ?? {}) as Record<string, unknown>;
  const requestId = typeof result.request_id === "string" ? result.request_id : null;

  const file = formData.get("attachment");
  let attachmentError: string | null = null;
  if (requestId && file instanceof File && file.size > 0 && !result.duplicate) {
    attachmentError = await uploadAttachment(supabase, companyId, requestId, file);
  }
  refresh();
  const base =
    result.status === "approved"
      ? "Ausencia registrada y aprobada por la regla de tu empresa."
      : result.routing === "manager" || result.routing === "substitute"
        ? "Solicitud enviada a tu aprobador. El saldo queda reservado hasta la decisión."
        : "Solicitud enviada a RR. HH. (no tienes un aprobador asignado). El saldo queda reservado.";
  return {
    status: attachmentError ? "error" : "success",
    message: attachmentError
      ? `${base} Pero el justificante no se ha guardado: ${attachmentError}`
      : base,
  };
}

export async function attachToRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getUserContext();
  if (!ctx.activeCompanyId) return FORBIDDEN;
  const requestId = formData.get("request_id");
  const file = formData.get("attachment");
  if (typeof requestId !== "string" || !z.uuid().safeParse(requestId).success) return FORBIDDEN;
  if (!(file instanceof File) || file.size === 0) {
    return {
      status: "error",
      message: "Elige un archivo.",
      fieldErrors: { attachment: ["Elige un archivo"] },
    };
  }
  const supabase = await createClient();
  const error = await uploadAttachment(supabase, ctx.activeCompanyId, requestId, file);
  if (error) return { status: "error", message: error };
  refresh();
  return { status: "success", message: "Justificante añadido." };
}

export async function decideAbsence(_prev: FormState, formData: FormData): Promise<FormState> {
  await getUserContext();
  const parsed = validate(decisionSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_absence_request", {
    p_request: parsed.data.request_id,
    p_decision: parsed.data.decision,
    p_message: parsed.data.message ?? undefined,
  });
  if (error) return dbErrorState(error);
  refresh();
  const messages = {
    approve: "Solicitud aprobada: la reserva pasa a uso.",
    reject: "Solicitud rechazada: el saldo reservado se libera.",
    request_info: "Se ha pedido más información a la persona.",
  } as const;
  return { status: "success", message: messages[parsed.data.decision] };
}

export async function respondInfo(_prev: FormState, formData: FormData): Promise<FormState> {
  await getUserContext();
  const parsed = validate(infoResponseSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_absence_info", {
    p_request: parsed.data.request_id,
    p_message: parsed.data.message,
  });
  if (error) return dbErrorState(error);
  refresh();
  return { status: "success", message: "Respuesta enviada." };
}

export async function cancelAbsence(id: string): Promise<FormState> {
  await getUserContext();
  const parsed = validate(z.object({ id: z.uuid() }), { id });
  if (!parsed.ok) return parsed.state;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_absence_request", {
    p_request: parsed.data.id,
  });
  if (error) return dbErrorState(error);
  refresh();
  return {
    status: "success",
    message:
      data === "withdrawn" ? "Ausencia retirada: el saldo se devuelve." : "Solicitud cancelada.",
  };
}

// ---------------------------------------------------------------------------
// Administración (tipos, políticas, versiones, asignaciones, ajustes)
// ---------------------------------------------------------------------------

export async function createType(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("ausencias", typeSchema, formData, async ({ ctx, data, supabase }) => {
    const units = [
      data.unit_day ? "day" : null,
      data.unit_half_day ? "half_day" : null,
      data.unit_hour ? "hour" : null,
    ].filter((u): u is "day" | "half_day" | "hour" => u !== null);
    const { error } = await supabase.from("absence_types").insert({
      company_id: ctx.companyId,
      code: data.code,
      name: data.name,
      allowed_units: units,
      count_basis: data.count_basis,
      uses_balance: data.uses_balance,
      requires_approval: data.requires_approval,
      approval_exemption_ref: data.requires_approval ? null : data.approval_exemption_ref,
      requires_attachment: data.requires_attachment,
      attachment_sensitive: data.attachment_sensitive,
      is_private: data.is_private,
      max_past_days: data.max_past_days,
      legal_reference: data.legal_reference,
    });
    if (error?.code === "23505") {
      return {
        status: "error",
        message: "Ya hay un tipo con ese código.",
        fieldErrors: { code: ["Código repetido"] },
      };
    }
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success", message: "Tipo de ausencia creado." };
  });
}

const statusSchema = z.object({ id: z.uuid(), status: z.enum(["active", "inactive"]) });

export async function setTypeStatus(input: {
  id: string;
  status: "active" | "inactive";
}): Promise<FormState> {
  return adminAction("ausencias", statusSchema, input, async ({ ctx, data, supabase }) => {
    const { data: rows, error } = await supabase
      .from("absence_types")
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

export async function createPolicy(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("ausencias", policySchema, formData, async ({ ctx, data, supabase }) => {
    const { error } = await supabase
      .from("vacation_policies")
      .insert({ company_id: ctx.companyId, ...data });
    if (error?.code === "23505") {
      return {
        status: "error",
        message: "Ya hay una política con ese código.",
        fieldErrors: { code: ["Código repetido"] },
      };
    }
    if (error) return dbErrorState(error);
    refresh();
    return {
      status: "success",
      message: "Política creada. Define su primera versión y publícala.",
    };
  });
}

/** Crea o actualiza el borrador de versión de una política. */
export async function saveVersionDraft(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("ausencias", versionSchema, formData, async ({ ctx, data, supabase }) => {
    const { data: versions } = await supabase
      .from("vacation_policy_versions")
      .select("id, version, status")
      .eq("policy_id", data.policy_id)
      .eq("company_id", ctx.companyId)
      .order("version", { ascending: false });
    const { policy_id, ...values } = data;
    const draft = versions?.find((v) => v.status === "draft");
    const { error } = draft
      ? await supabase.from("vacation_policy_versions").update(values).eq("id", draft.id)
      : await supabase.from("vacation_policy_versions").insert({
          company_id: ctx.companyId,
          policy_id,
          version: (versions?.[0]?.version ?? 0) + 1,
          created_by: ctx.user.userId,
          ...values,
        });
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success", message: "Borrador guardado. Aún no se aplica a nadie." };
  });
}

export async function publishVersion(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("ausencias", publishSchema, formData, async ({ ctx, data, supabase }) => {
    const { data: version } = await supabase
      .from("vacation_policy_versions")
      .select("id")
      .eq("id", data.version_id)
      .eq("company_id", ctx.companyId)
      .maybeSingle();
    if (!version) return FORBIDDEN;
    const { error } = await supabase.rpc("publish_vacation_policy_version", {
      p_version: data.version_id,
      p_valid_from: data.valid_from,
    });
    if (error) return dbErrorState(error);
    refresh();
    return {
      status: "success",
      message:
        "Versión publicada. Los periodos ya abiertos conservan las reglas con las que se abrieron.",
    };
  });
}

export async function createAssignment(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("ausencias", assignmentSchema, formData, async ({ ctx, data, supabase }) => {
    const { data: policy } = await supabase
      .from("vacation_policies")
      .select("id, absence_type_id")
      .eq("id", data.policy_id)
      .eq("company_id", ctx.companyId)
      .maybeSingle();
    if (!policy) return FORBIDDEN;
    const { error } = await supabase.from("policy_assignments").insert({
      company_id: ctx.companyId,
      policy_id: policy.id,
      absence_type_id: policy.absence_type_id,
      scope_type: data.scope_type,
      employee_id: data.scope_type === "employee" ? data.employee_id : null,
      team_id: data.scope_type === "team" ? data.team_id : null,
      work_center_id: data.scope_type === "work_center" ? data.work_center_id : null,
      valid_from: data.valid_from,
      valid_to: data.last_day ? addDays(data.last_day, 1) : null,
      created_by: ctx.user.userId,
    });
    if (error?.code === "23P01") {
      return {
        status: "error",
        message:
          "Ya hay una política de ese tipo para ese mismo ámbito en esas fechas. Cierra la actual antes.",
      };
    }
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success", message: "Política asignada." };
  });
}

export async function endAssignment(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction(
    "ausencias",
    z.object({
      id: z.uuid(),
      last_day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida"),
    }),
    formData,
    async ({ ctx, data, supabase }) => {
      const { data: rows, error } = await supabase
        .from("policy_assignments")
        .update({ valid_to: addDays(data.last_day, 1) })
        .eq("id", data.id)
        .eq("company_id", ctx.companyId)
        .select("id");
      if (error) return dbErrorState(error);
      if (!rows?.length) return FORBIDDEN;
      refresh();
      return { status: "success", message: "Asignación finalizada." };
    },
  );
}

export async function adjustBalance(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("ausencias", adjustmentSchema, formData, async ({ ctx, data, supabase }) => {
    const { data: employee } = await supabase
      .from("employees")
      .select("id")
      .eq("id", data.employee_id)
      .eq("company_id", ctx.companyId)
      .maybeSingle();
    if (!employee) return FORBIDDEN;
    const { data: versions } = await supabase
      .from("vacation_policy_versions")
      .select("unit")
      .eq("policy_id", data.policy_id)
      .eq("company_id", ctx.companyId)
      .eq("status", "published")
      .order("version", { ascending: false })
      .limit(1);
    const unit = versions?.[0]?.unit;
    if (!unit) return { status: "error", message: "La política no tiene versiones publicadas." };
    const amount = parseAmount(data.amount, unit);
    if (amount === null || amount === 0) {
      return {
        status: "error",
        message: "Cantidad no válida.",
        fieldErrors: {
          amount: [
            unit === "half_days" ? "Días, admite ,5 y signo (-1,5)" : "Horas HH:MM, admite signo",
          ],
        },
      };
    }
    const { error } = await supabase.rpc("adjust_vacation_balance", {
      p_employee: data.employee_id,
      p_policy: data.policy_id,
      p_day: new Date().toISOString().slice(0, 10),
      p_amount: amount,
      p_reason: data.reason,
    });
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success", message: "Ajuste registrado en el libro de saldos." };
  });
}
