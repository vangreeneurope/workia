import type { BatchExportData } from "./types";

/** Nombre determinista: liquidacion-<empresa>-<aaaa-mm>-lote-0001[-corrector].<ext> */
export function exportFileName(data: BatchExportData, ext: "pdf" | "csv" | "xlsx" | "zip"): string {
  const base = `liquidacion-${data.companySlug}-${data.batch.periodMonth.slice(0, 7)}-lote-${String(data.batch.sequence).padStart(4, "0")}`;
  const suffix = data.batch.kind === "corrective" ? "-corrector" : "";
  const kind = ext === "zip" ? "-justificantes" : "";
  return `${base}${suffix}${kind}.${ext}`.slice(0, 120);
}

/** Fecha fija de los archivos (la del cierre): mismo lote, mismos bytes. */
export function exportDate(data: BatchExportData): Date {
  return new Date(data.batch.closedAt);
}
