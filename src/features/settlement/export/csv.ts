import { csvCell } from "@/lib/csv";

import { centsToDecimal } from "./money";
import type { BatchExportData } from "./types";

/**
 * Columnas del CSV de liquidación (esquema documentado en docs/LIQUIDACION_GASTOS.md).
 * Genérico: no imita el formato de ningún ERP; las cuentas salen del mapeo
 * configurado por la empresa.
 */
export const CSV_COLUMNS = [
  "lote",
  "tipo_lote",
  "periodo",
  "linea",
  "codigo_empleado",
  "empleado",
  "fecha",
  "categoria_codigo",
  "categoria",
  "cuenta",
  "cuenta_impuestos",
  "cuenta_contrapartida",
  "centro_coste",
  "proyecto",
  "proveedor",
  "nif_proveedor",
  "documento",
  "moneda",
  "base",
  "impuestos",
  "total",
  "total_centimos",
  "motivo_ajuste",
  "id_gasto",
] as const;

/** Importes: punto decimal y dos decimales, generados con aritmética entera. */
function amount(cents: number | null): string {
  return cents === null ? "" : centsToDecimal(cents);
}

export function batchCsv(data: BatchExportData): Uint8Array {
  const b = data.batch;
  const rows = data.lines.map((l) =>
    [
      csvCell(b.sequence),
      csvCell(b.kind === "corrective" ? "corrector" : "ordinario"),
      csvCell(b.periodMonth.slice(0, 7)),
      csvCell(l.line_no),
      csvCell(l.employee_code),
      csvCell(l.employee_name),
      csvCell(l.expense_date),
      csvCell(l.category_code),
      csvCell(l.category_name),
      csvCell(l.account_code),
      csvCell(l.tax_account_code),
      csvCell(l.counterpart_account_code),
      csvCell(l.cost_center),
      csvCell(l.project_code),
      csvCell(l.merchant_name),
      csvCell(l.merchant_tax_id),
      csvCell(l.document_number),
      csvCell(l.currency),
      // Los importes son números generados aquí: no se neutralizan como texto.
      amount(l.base_cents),
      amount(l.tax_cents),
      amount(l.total_cents),
      String(l.total_cents),
      csvCell(l.adjustment_reason),
      csvCell(l.expense_id),
    ].join(";"),
  );
  const text = `﻿${[CSV_COLUMNS.join(";"), ...rows].join("\r\n")}\r\n`;
  return new TextEncoder().encode(text);
}
