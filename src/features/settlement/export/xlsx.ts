import { buildXlsx, type XlsxCell } from "@/lib/files/xlsx";

import { CSV_COLUMNS } from "./csv";
import { centsToDecimal } from "./money";
import { exportDate } from "./names";
import type { BatchExportData, TotalRow } from "./types";

/**
 * XLSX de liquidación: hojas "Lineas" y "Totales". Los importes se escriben como
 * texto decimal exacto generado con enteros y, además, en céntimos. Fecha
 * interna fija (la del cierre): mismo lote, mismos bytes.
 */

type Cell = XlsxCell;

const money = (cents: number | null): Cell =>
  cents === null ? null : { n: centsToDecimal(cents), money: true };
const text = (v: string | number | null): Cell =>
  v === null || v === "" ? null : { s: String(v) };

const DIMENSION_LABELS: Record<TotalRow["dimension"], string> = {
  total: "Total",
  employee: "Empleado",
  category: "Categoría",
  account: "Cuenta",
  cost_center: "Centro de coste",
  project: "Proyecto",
};

export function batchXlsx(data: BatchExportData): Uint8Array {
  const b = data.batch;
  const lineRows: Cell[][] = [
    CSV_COLUMNS.map((c) => ({ s: c })),
    ...data.lines.map((l) => [
      { n: String(b.sequence) },
      text(b.kind === "corrective" ? "corrector" : "ordinario"),
      text(b.periodMonth.slice(0, 7)),
      { n: String(l.line_no) },
      text(l.employee_code),
      text(l.employee_name),
      text(l.expense_date),
      text(l.category_code),
      text(l.category_name),
      text(l.account_code),
      text(l.tax_account_code),
      text(l.counterpart_account_code),
      text(l.cost_center),
      text(l.project_code),
      text(l.merchant_name),
      text(l.merchant_tax_id),
      text(l.document_number),
      text(l.currency),
      money(l.base_cents),
      money(l.tax_cents),
      money(l.total_cents),
      { n: String(l.total_cents) },
      text(l.adjustment_reason),
      text(l.expense_id),
    ]),
  ];
  const totalRows: Cell[][] = [
    [
      "agrupacion",
      "clave",
      "nombre",
      "moneda",
      "base",
      "impuestos",
      "total",
      "total_centimos",
      "lineas",
    ].map((s) => ({ s })),
    ...data.totals.map((t) => [
      text(DIMENSION_LABELS[t.dimension]),
      text(t.key),
      text(t.label),
      text(t.currency),
      money(t.base_cents),
      money(t.tax_cents),
      money(t.total_cents),
      { n: String(t.total_cents) },
      { n: String(t.lines) },
    ]),
  ];
  return buildXlsx(
    [
      { name: "Lineas", rows: lineRows },
      { name: "Totales", rows: totalRows },
    ],
    exportDate(data),
  );
}
