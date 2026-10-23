"use server";

import { hasPermission } from "@/lib/admin/access";
import { adminAreaOrNull, type AdminContext } from "@/lib/admin/context";
import { parseCsv } from "@/lib/csv";
import { dbErrorMessage } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";

import {
  MAX_IMPORT_BYTES,
  suggestMapping,
  toImportPayload,
  validateImport,
  type ColumnMapping,
  type ImportReference,
  type RowResult,
} from "./employees-import";

export type PreviewResult =
  | { ok: true; headers: string[]; sample: string[][]; totalRows: number; mapping: ColumnMapping }
  | { ok: false; message: string };

export type ValidationResult =
  | {
      ok: true;
      validCount: number;
      errorCount: number;
      /** Solo filas con errores: línea, código y motivos (sin nombres ni correos). */
      errors: Pick<RowResult, "line" | "code" | "errors">[];
      problems: string[];
    }
  | { ok: false; message: string };

export type ConfirmResult =
  { ok: true; imported: number } | { ok: false; message: string; validation?: ValidationResult };

const DENIED = { ok: false as const, message: "No tienes permiso para importar personas." };

async function authorize(): Promise<AdminContext | null> {
  const ctx = await adminAreaOrNull("importar");
  return ctx && hasPermission(ctx.permissions, "employees.manage") ? ctx : null;
}

async function loadReference(ctx: AdminContext, codes: string[]): Promise<ImportReference> {
  const supabase = await createClient();
  const [centers, teams] = await Promise.all([
    supabase
      .from("work_centers")
      .select("code")
      .eq("company_id", ctx.companyId)
      .eq("status", "active"),
    supabase.from("teams").select("name").eq("company_id", ctx.companyId).eq("status", "active"),
  ]);
  const existingCodes = new Set<string>();
  for (let i = 0; i < codes.length; i += 200) {
    const { data } = await supabase
      .from("employees")
      .select("employee_code")
      .eq("company_id", ctx.companyId)
      .in("employee_code", codes.slice(i, i + 200));
    for (const row of data ?? []) existingCodes.add(row.employee_code);
  }
  return {
    workCenterCodes: new Set((centers.data ?? []).map((c) => c.code)),
    teamNames: new Set((teams.data ?? []).map((t) => t.name)),
    existingCodes,
  };
}

async function runValidation(ctx: AdminContext, csvText: string, mapping: ColumnMapping) {
  let codes: string[] = [];
  try {
    const index = mapping.employee_code;
    if (typeof index === "number") {
      codes = parseCsv(csvText)
        .rows.map((r) => (r[index] ?? "").trim())
        .filter(Boolean);
    }
  } catch {
    // El error de formato lo informa validateImport.
  }
  return validateImport(csvText, mapping, await loadReference(ctx, codes));
}

export async function previewImport(csvText: string): Promise<PreviewResult> {
  if (!(await authorize())) return DENIED;
  if (typeof csvText !== "string" || csvText.length > MAX_IMPORT_BYTES) {
    return { ok: false, message: "El archivo supera 900 KB. Divídelo en varios." };
  }
  try {
    const parsed = parseCsv(csvText);
    if (parsed.headers.length === 0) return { ok: false, message: "El archivo está vacío." };
    return {
      ok: true,
      headers: parsed.headers,
      sample: parsed.rows.slice(0, 5),
      totalRows: parsed.rows.length,
      mapping: suggestMapping(parsed.headers),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "No se pudo leer el archivo.",
    };
  }
}

export async function validateImportAction(
  csvText: string,
  mapping: ColumnMapping,
): Promise<ValidationResult> {
  const ctx = await authorize();
  if (!ctx) return DENIED;
  const result = await runValidation(ctx, csvText, mapping);
  return {
    ok: true,
    validCount: result.validRows.length,
    errorCount: result.errorCount,
    errors: result.results
      .filter((r) => r.errors.length > 0)
      .map(({ line, code, errors }) => ({ line, code, errors })),
    problems: result.problems,
  };
}

/**
 * Vuelve a validar en el servidor y, solo si no hay ningún error, importa todo
 * en una única transacción (public.import_employees). Nunca escribe a medias.
 */
export async function confirmImport(
  csvText: string,
  mapping: ColumnMapping,
): Promise<ConfirmResult> {
  const ctx = await authorize();
  if (!ctx) return DENIED;
  const result = await runValidation(ctx, csvText, mapping);
  if (result.problems.length > 0 || result.errorCount > 0 || result.validRows.length === 0) {
    return {
      ok: false,
      message:
        "Hay errores: no se ha importado ninguna fila. Corrige el archivo y vuelve a validarlo.",
      validation: {
        ok: true,
        validCount: result.validRows.length,
        errorCount: result.errorCount,
        errors: result.results
          .filter((r) => r.errors.length > 0)
          .map(({ line, code, errors }) => ({ line, code, errors })),
        problems: result.problems,
      },
    };
  }

  const supabase = await createClient();
  const { data: imported, error } = await supabase.rpc("import_employees", {
    p_company: ctx.companyId,
    p_rows: toImportPayload(result.validRows),
  });
  if (error) {
    const rowIndex = Number(/^Fila (\d+)/.exec(error.message ?? "")?.[1]);
    const line = Number.isFinite(rowIndex)
      ? result.results.filter((r) => r.row)[rowIndex - 1]?.line
      : undefined;
    const reason = dbErrorMessage({
      ...error,
      message: (error.message ?? "").replace(/^Fila \d+: /, ""),
    });
    return {
      ok: false,
      message: `${line ? `Línea ${line}: ` : ""}${reason} No se ha importado ninguna fila.`,
    };
  }

  await supabase.rpc("log_admin_event", {
    p_company: ctx.companyId,
    p_action: "import",
    p_entity: "employees",
    p_rows: imported ?? 0,
    p_filters: { format: "csv" },
  });
  return { ok: true, imported: imported ?? 0 };
}
