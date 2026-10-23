import { PDFDocument, StandardFonts } from "pdf-lib";

import { MARGIN, MUTED, PdfWriter, safe } from "@/lib/files/pdf-writer";

import { centsToEs } from "./money";
import { exportDate } from "./names";
import type { BatchExportData, TotalRow } from "./types";

/**
 * PDF de liquidación legible (A4, Helvetica). Determinista: sin metadatos
 * automáticos y con la fecha del cierre como fecha del documento. Todos los
 * importes salen de las líneas y totales del lote (los mismos del CSV/XLSX).
 */

const DIMENSIONS: [TotalRow["dimension"], string][] = [
  ["employee", "Por empleado"],
  ["category", "Por categoría"],
  ["account", "Por cuenta"],
  ["cost_center", "Por centro de coste"],
  ["project", "Por proyecto"],
];

export async function batchPdf(data: BatchExportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const date = exportDate(data);
  const b = data.batch;
  const seq = String(b.sequence).padStart(4, "0");
  doc.setTitle(safe(`Liquidación de gastos · lote ${seq}`), { showInWindowTitleBar: false });
  doc.setAuthor(safe(data.companyName));
  doc.setCreator("Portal del empleado");
  doc.setProducer("Portal del empleado");
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new PdfWriter(doc, font, bold);

  w.text("Liquidación de gastos", { size: 16, bold: true });
  w.text(data.companyName, { size: 11 });
  w.text(
    `Lote ${seq} · ${b.kind === "corrective" ? `corrector del lote ${String(b.correctsSequence ?? 0).padStart(4, "0")}` : "ordinario"} · periodo ${b.periodMonth.slice(0, 7)} · cerrado el ${b.closedAt.slice(0, 10)}`,
    { color: MUTED },
  );
  if (b.note) w.text(`Motivo: ${b.note}`, { color: MUTED });
  w.gap();

  const grand = data.totals.filter((t) => t.dimension === "total");
  w.text("Totales del lote", { size: 11, bold: true });
  w.table(
    [
      { title: "Moneda", width: 80 },
      { title: "Base", width: 110, align: "right" },
      { title: "Impuestos", width: 110, align: "right" },
      { title: "Total", width: 120, align: "right" },
      { title: "Líneas", width: 60, align: "right" },
    ],
    grand.map((t) => [
      t.currency,
      centsToEs(t.base_cents),
      centsToEs(t.tax_cents),
      centsToEs(t.total_cents),
      String(t.lines),
    ]),
    9,
  );
  w.text(
    "Las monedas no se suman entre sí. Base e impuestos solo constan si figuran en el ticket.",
    {
      size: 7,
      color: MUTED,
    },
  );

  for (const [dimension, title] of DIMENSIONS) {
    const rows = data.totals.filter((t) => t.dimension === dimension);
    if (rows.length === 0) continue;
    w.gap();
    w.text(title, { size: 11, bold: true });
    w.table(
      [
        { title: "Clave", width: 90 },
        { title: "Nombre", width: 200 },
        { title: "Moneda", width: 55 },
        { title: "Total", width: 110, align: "right" },
        { title: "Líneas", width: 60, align: "right" },
      ],
      rows.map((t) => [
        t.key || "—",
        t.label,
        t.currency,
        centsToEs(t.total_cents),
        String(t.lines),
      ]),
    );
  }

  w.gap();
  w.text("Detalle de líneas", { size: 11, bold: true });
  w.table(
    [
      { title: "Nº", width: 26 },
      { title: "Fecha", width: 52 },
      { title: "Empleado", width: 52 },
      { title: "Categoría", width: 80 },
      { title: "Proveedor o motivo", width: 125 },
      { title: "Cuenta", width: 45 },
      { title: "Proyecto", width: 45 },
      { title: "Mon.", width: 30 },
      { title: "Total", width: 60, align: "right" },
    ],
    data.lines.map((l) => [
      String(l.line_no),
      l.expense_date,
      l.employee_code,
      l.category_name,
      l.adjustment_reason ? `Ajuste: ${l.adjustment_reason}` : (l.merchant_name ?? ""),
      l.account_code,
      l.project_code ?? "",
      l.currency,
      centsToEs(l.total_cents),
    ]),
  );

  const total = w.pages.length;
  w.pages.forEach((p, i) => {
    const footer = safe(`${data.companyName} · lote ${seq} · página ${i + 1} de ${total}`);
    p.drawText(footer, { x: MARGIN, y: MARGIN - 18, size: 7, font, color: MUTED });
  });
  return doc.save({ useObjectStreams: false });
}
