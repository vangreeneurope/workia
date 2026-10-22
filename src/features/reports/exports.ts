import "server-only";

import { sha256Hex } from "@/features/expenses/receipt-file";
import { businessDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

import { REPORT_KEYS, REPORTS, type ReportDef, type ReportKey } from "./catalog";
import { reportCsv, reportPdf, reportXlsx } from "./export/files";
import { filtersFromExport, type ReportFilters } from "./filters";
import { EXPORT_BATCH_SIZE, fetchReport } from "./query";
import type { ReportRow } from "./rows";

/**
 * Generación de exportaciones en segundo plano (after() de la Server Action),
 * SIEMPRE con la sesión de quien la pidió: el archivo contiene exactamente lo
 * que RLS y las funciones de informe le dejan ver. Se guarda en el bucket
 * privado report-exports con su huella SHA-256; la base de datos fija la
 * caducidad (7 días) y registra cada descarga.
 */

export const EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Más filas no caben en un archivo útil (y el PDF sería inmanejable). */
export const MAX_EXPORT_ROWS: Record<ExportFormat, number> = {
  csv: 50_000,
  xlsx: 50_000,
  pdf: 5_000,
};

const MIME: Record<ExportFormat, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export function isReportKey(v: string): v is ReportKey {
  return (REPORT_KEYS as readonly string[]).includes(v);
}

export function exportFileName(
  def: ReportDef,
  f: ReportFilters,
  format: ExportFormat,
  slug: string,
): string {
  const safeSlug =
    slug
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .slice(0, 40) || "empresa";
  const period = def.filters.includes("day") ? f.day : `${f.from}_${f.to}`;
  return `${def.slug}-${safeSlug}-${period}.${format}`;
}

/** Texto de filtros para el archivo: fechas y si hay filtros de persona, equipo… (sin valores personales). */
export function filtersText(def: ReportDef, f: ReportFilters): string {
  const parts: string[] = [];
  if (def.filters.includes("day")) parts.push(`Día ${f.day}`);
  if (def.filters.includes("period")) parts.push(`Periodo ${f.from} a ${f.to}`);
  if (f.employee) parts.push("una persona");
  if (f.team) parts.push("un equipo");
  if (f.center) parts.push("un centro");
  if (f.client) parts.push(`cliente «${f.client}»`);
  if (f.project) parts.push(`proyecto ${f.project}`);
  if (def.filters.includes("group")) parts.push(`agrupado por ${f.group}`);
  if (f.actor) parts.push("un actor");
  if (f.entity) parts.push(`objeto ${f.entity}`);
  if (f.action) parts.push(`acción ${f.action}`);
  if (f.object) parts.push("un identificador");
  return parts.join(" · ");
}

class ExportError extends Error {}

async function collectRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  def: ReportDef,
  f: ReportFilters,
  max: number,
): Promise<ReportRow[]> {
  const rows: ReportRow[] = [];
  for (let offset = 0; ; offset += EXPORT_BATCH_SIZE) {
    const page = await fetchReport(supabase, companyId, def.key, f, EXPORT_BATCH_SIZE, offset);
    if (page.failed) throw new ExportError("query_failed");
    rows.push(...page.rows);
    if (rows.length > max) throw new ExportError("too_many_rows");
    if (!def.paginated || page.rows.length < EXPORT_BATCH_SIZE) return rows;
  }
}

export async function generateReportExport(exportId: string): Promise<void> {
  const supabase = await createClient();
  const { data: started } = await supabase.rpc("start_report_export", { p_export: exportId });
  if (!started) return; // Ya en curso o terminada (reintento o doble envío).
  try {
    const { data: x } = await supabase
      .from("report_exports")
      .select("id, company_id, requested_by, report_key, format, filters, companies (name, slug)")
      .eq("id", exportId)
      .single();
    if (!x || !isReportKey(x.report_key)) throw new ExportError("not_found");
    const format = (EXPORT_FORMATS as readonly string[]).includes(x.format)
      ? (x.format as ExportFormat)
      : null;
    if (!format) throw new ExportError("bad_format");
    const def = REPORTS[x.report_key];
    const f = filtersFromExport(def, x.filters, businessDate());
    const rows = await collectRows(supabase, x.company_id, def, f, MAX_EXPORT_ROWS[format]);
    const meta = {
      companyName: x.companies?.name ?? "Empresa",
      exportId: x.id,
      generatedAt: new Date(),
      filtersText: filtersText(def, f),
    };
    const bytes =
      format === "csv"
        ? reportCsv(def, rows)
        : format === "xlsx"
          ? reportXlsx(def, rows, meta)
          : await reportPdf(def, rows, meta);
    const fileName = exportFileName(def, f, format, x.companies?.slug ?? "empresa");
    const path = `${x.company_id}/${x.requested_by}/${x.id}/${fileName}`;
    const up = await supabase.storage
      .from("report-exports")
      .upload(path, bytes, { contentType: MIME[format], upsert: false });
    if (up.error) throw new ExportError("upload_failed");
    const done = await supabase.rpc("complete_report_export", {
      p_export: x.id,
      p_file_name: fileName,
      p_path: path,
      p_sha256: sha256Hex(bytes),
      p_size: bytes.byteLength,
      p_rows: rows.length,
    });
    if (done.error) throw new ExportError("complete_failed");
  } catch (error) {
    // Solo un código: nunca datos del informe ni mensajes internos.
    const code = error instanceof ExportError ? error.message : "generation_failed";
    await supabase.rpc("fail_report_export", { p_export: exportId, p_error_code: code });
    // Si el archivo llegó a subirse, lo borra la tarea programada (expire_report_exports lo
    // devuelve como huérfano): la sesión del usuario no tiene permiso de borrado en Storage.
  }
}
