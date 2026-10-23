import { zipSync } from "fflate";

import { sha256Hex } from "@/features/expenses/receipt-file";
import { csvCell } from "@/lib/csv";

import { exportDate } from "./names";
import type { BatchExportData } from "./types";

export type ReceiptFile = {
  expenseId: string;
  extension: "pdf" | "jpg" | "png";
  bytes: Uint8Array;
};

/**
 * ZIP de justificantes: un archivo por línea con ticket, con nombre
 * determinista (<empleado>/<fecha>_<línea>_<gasto>.<ext>) y un índice CSV con
 * la huella de cada uno. Sin compresión de las imágenes (ya lo están) y fecha
 * interna fija: mismo lote y mismos tickets, mismos bytes.
 */
export function receiptsZip(data: BatchExportData, receipts: ReceiptFile[]): Uint8Array {
  const byExpense = new Map(receipts.map((r) => [r.expenseId, r]));
  const mtime = exportDate(data);
  const files: Record<string, [Uint8Array, { mtime: Date; level: 0 }]> = {};
  const index: string[] = ["linea;archivo;sha256;id_gasto"];
  for (const l of data.lines) {
    const r = l.expense_id ? byExpense.get(l.expense_id) : undefined;
    if (!r) continue;
    const code = l.employee_code.replace(/[^A-Za-z0-9_-]/g, "_");
    const name = `${code}/${l.expense_date}_${String(l.line_no).padStart(4, "0")}_${r.expenseId.slice(0, 8)}.${r.extension}`;
    files[name] = [r.bytes, { mtime, level: 0 }];
    index.push([l.line_no, csvCell(name), sha256Hex(r.bytes), r.expenseId].join(";"));
  }
  files["indice.csv"] = [
    new TextEncoder().encode(`${index.join("\r\n")}\r\n`),
    { mtime, level: 0 },
  ];
  // Orden estable de las entradas.
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  return zipSync(sorted, { mtime });
}
