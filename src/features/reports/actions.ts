"use server";

import { after } from "next/server";
import { z } from "zod";

import { FORBIDDEN } from "@/features/admin/action-helpers";
import { getUserContext } from "@/lib/auth/dal";
import { canAccessSection } from "@/lib/auth/permissions";
import { businessDate } from "@/lib/dates";
import { dbErrorState } from "@/lib/db-errors";
import { formToObject, validate, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

import { REPORT_KEYS, REPORTS, reportVisible } from "./catalog";
import { EXPORT_FORMATS, generateReportExport } from "./exports";
import { exportFilters, parseFilters } from "./filters";

const requestSchema = z.object({
  report: z.enum(REPORT_KEYS, { message: "Informe no válido" }),
  format: z.enum(EXPORT_FORMATS, { message: "Elige un formato" }),
  // Los mismos parámetros de la URL; se vuelven a validar con el esquema de filtros.
  query: z.string().max(2000).default(""),
  idempotency_key: z.uuid(),
});

/**
 * Pide una exportación. Se registra al instante (solicitante, filtros
 * validados, request_id) y el archivo se genera después de responder, con la
 * misma sesión, para no bloquear la pantalla ni cargar el informe en el
 * navegador. La empresa es siempre la activa del servidor.
 */
export async function requestReportExport(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await getUserContext();
  const companyId = ctx.activeCompanyId;
  const parsed = validate(requestSchema, formToObject(formData));
  if (!parsed.ok) return parsed.state;
  const { report, format, query, idempotency_key } = parsed.data;
  const section = report === "audit" ? "auditoria" : "informes";
  if (!companyId || !canAccessSection(ctx, section) || !reportVisible(ctx, report))
    return FORBIDDEN;
  const def = REPORTS[report];
  const search = Object.fromEntries(new URLSearchParams(query).entries());
  const { filters } = parseFilters(def, search, businessDate());
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("request_report_export", {
    p_company: companyId,
    p_report: report,
    p_format: format,
    p_filters: exportFilters(def, filters),
    p_idempotency_key: idempotency_key,
  });
  if (error || !id)
    return error ? dbErrorState(error) : { status: "error", message: "No se pudo exportar." };
  after(() => generateReportExport(id));
  return {
    status: "success",
    message: "Exportación en preparación. La encontrarás en «Mis exportaciones» en unos segundos.",
  };
}
