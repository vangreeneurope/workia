import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

import { centsToEs } from "./money";
import { exportDate } from "./names";
import type { BatchExportData, TotalRow } from "./types";

/**
 * PDF de liquidación legible (A4, Helvetica). Determinista: sin metadatos
 * automáticos y con la fecha del cierre como fecha del documento. Todos los
 * importes salen de las líneas y totales del lote (los mismos del CSV/XLSX).
 */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;
const INK = rgb(0.12, 0.16, 0.14);
const MUTED = rgb(0.4, 0.44, 0.42);
const RULE = rgb(0.82, 0.86, 0.83);

// Helvetica estándar codifica WinAnsi: lo que no cabe se sustituye por "?".
const safe = (s: string | null | undefined) => (s ?? "").replace(/[^\x20-\x7E\xA0-\xFF€]/g, "?");

type Column = { title: string; width: number; align?: "right" };

class Writer {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage(A4);
    this.pages.push(this.page);
    this.y = A4[1] - MARGIN;
  }
  ensure(h: number) {
    if (this.y - h < MARGIN + 20) this.newPage();
  }
  fit(text: string, width: number, size: number, bold = false): string {
    const f = bold ? this.bold : this.font;
    let t = safe(text);
    if (f.widthOfTextAtSize(t, size) <= width) return t;
    while (t.length > 1 && f.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
    return `${t}…`;
  }
  text(
    s: string,
    opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number } = {},
  ) {
    const size = opts.size ?? 9;
    this.ensure(size + 4);
    this.page.drawText(this.fit(s, A4[0] - 2 * MARGIN, size, opts.bold), {
      x: opts.x ?? MARGIN,
      y: this.y - size,
      size,
      font: opts.bold ? this.bold : this.font,
      color: opts.color ?? INK,
    });
    this.y -= size + 5;
  }
  gap(h = 8) {
    this.y -= h;
  }
  table(columns: Column[], rows: string[][], size = 8) {
    const rowH = size + 6;
    const header = () => {
      this.ensure(rowH * 2);
      let x = MARGIN;
      for (const c of columns) {
        const t = this.fit(c.title, c.width - 4, size, true);
        const w = this.bold.widthOfTextAtSize(t, size);
        this.page.drawText(t, {
          x: c.align === "right" ? x + c.width - 4 - w : x,
          y: this.y - size,
          size,
          font: this.bold,
          color: MUTED,
        });
        x += c.width;
      }
      this.y -= rowH;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y + 3 },
        end: { x: A4[0] - MARGIN, y: this.y + 3 },
        thickness: 0.6,
        color: RULE,
      });
    };
    header();
    for (const row of rows) {
      if (this.y - rowH < MARGIN + 20) {
        this.newPage();
        header();
      }
      let x = MARGIN;
      columns.forEach((c, i) => {
        const t = this.fit(row[i] ?? "", c.width - 4, size);
        const w = this.font.widthOfTextAtSize(t, size);
        this.page.drawText(t, {
          x: c.align === "right" ? x + c.width - 4 - w : x,
          y: this.y - size,
          size,
          font: this.font,
          color: INK,
        });
        x += c.width;
      });
      this.y -= rowH;
    }
  }
}

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
  const w = new Writer(doc, font, bold);

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
