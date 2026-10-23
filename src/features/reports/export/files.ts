import { PDFDocument, StandardFonts } from "pdf-lib";

import { csvCell } from "@/lib/csv";
import { buildXlsx, type XlsxCell } from "@/lib/files/xlsx";
import {
  A4_LANDSCAPE,
  MARGIN,
  MUTED,
  PdfWriter,
  safe,
  type PdfColumn,
} from "@/lib/files/pdf-writer";
import { centsToDecimal } from "@/features/settlement/export/money";

import type { Column, ReportDef } from "../catalog";
import { displayCell, formatDuration, type ReportRow } from "../rows";

/**
 * Archivos de exportación de un informe (CSV, XLSX y PDF) a partir de las filas
 * que devolvió la base de datos con la sesión del solicitante. Deterministas:
 * con las mismas filas y la misma fecha de generación salen los mismos bytes.
 *
 * CSV y XLSX: una columna por campo; las duraciones van en h:mm y además en
 * segundos (<campo>_segundos); los importes con punto decimal desde céntimos
 * enteros; las fechas y horas en ISO 8601 (UTC), sin ambigüedad de zona.
 */

export type ExportMeta = {
  companyName: string;
  exportId: string;
  /** Instante de generación (fijo para todo el archivo). */
  generatedAt: Date;
  /** Resumen legible de los filtros (sin datos personales). */
  filtersText: string;
};

type Flat = {
  header: string;
  value: (row: ReportRow) => string | number | null;
  /** Número para la hoja de cálculo. */
  numeric: boolean;
  /** Generado aquí (números, h:mm): no se neutraliza como posible fórmula. */
  generated: boolean;
};

function flatColumns(def: ReportDef): Flat[] {
  return def.columns.flatMap((c: Column): Flat[] => {
    const v = (row: ReportRow) => row[c.key] ?? null;
    switch (c.kind) {
      case "duration":
        return [
          {
            header: c.csv,
            value: (r) => (typeof v(r) === "number" ? formatDuration(v(r) as number) : null),
            numeric: false,
            generated: true,
          },
          { header: `${c.csv}_segundos`, value: v, numeric: true, generated: true },
        ];
      case "money":
        return [
          {
            header: c.csv,
            value: (r) => (typeof v(r) === "number" ? centsToDecimal(v(r) as number) : null),
            numeric: true,
            generated: true,
          },
          { header: `${c.csv}_centimos`, value: v, numeric: true, generated: true },
        ];
      case "int":
        return [{ header: c.csv, value: v, numeric: true, generated: true }];
      default:
        return [{ header: c.csv, value: v, numeric: false, generated: false }];
    }
  });
}

export function reportCsv(def: ReportDef, rows: ReportRow[]): Uint8Array {
  const cols = flatColumns(def);
  const lines = rows.map((r) =>
    cols
      .map((c) => {
        const v = c.value(r);
        if (v === null) return "";
        // Los números y las horas se generan aquí: no se neutralizan como texto.
        return c.generated ? String(v) : csvCell(v);
      })
      .join(";"),
  );
  return new TextEncoder().encode(
    `﻿${[cols.map((c) => c.header).join(";"), ...lines].join("\r\n")}\r\n`,
  );
}

export function reportXlsx(def: ReportDef, rows: ReportRow[], meta: ExportMeta): Uint8Array {
  const cols = flatColumns(def);
  const data: XlsxCell[][] = [
    cols.map((c) => ({ s: c.header })),
    ...rows.map((r) =>
      cols.map((c): XlsxCell => {
        const v = c.value(r);
        if (v === null || v === "") return null;
        return c.numeric ? { n: String(v) } : { s: String(v) };
      }),
    ),
  ];
  const info: XlsxCell[][] = [
    [{ s: "campo" }, { s: "valor" }],
    [{ s: "informe" }, { s: def.title }],
    [{ s: "empresa" }, { s: meta.companyName }],
    [{ s: "filtros" }, { s: meta.filtersText }],
    [{ s: "generado" }, { s: meta.generatedAt.toISOString() }],
    [{ s: "exportacion" }, { s: meta.exportId }],
    [{ s: "filas" }, { n: String(rows.length) }],
  ];
  return buildXlsx(
    [
      { name: "Datos", rows: data },
      { name: "Informacion", rows: info },
    ],
    meta.generatedAt,
  );
}

/** Ancho proporcional por tipo de columna, ajustado al ancho útil de la página. */
function pdfColumns(def: ReportDef, width: number): PdfColumn[] {
  const weight = (c: Column) =>
    c.key === "punches" || c.key === "adjustments" || c.key === "changes"
      ? 4
      : c.key === "employee_name" || c.key === "group_label"
        ? 2.2
        : c.kind === "datetime"
          ? 1.8
          : 1;
  const total = def.columns.reduce((s, c) => s + weight(c), 0);
  return def.columns.map((c) => ({
    title: c.label,
    width: (width * weight(c)) / total,
    align: c.kind === "int" || c.kind === "duration" || c.kind === "money" ? "right" : undefined,
  }));
}

export async function reportPdf(
  def: ReportDef,
  rows: ReportRow[],
  meta: ExportMeta,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(safe(`${def.title} · ${meta.companyName}`), { showInWindowTitleBar: false });
  doc.setAuthor(safe(meta.companyName));
  doc.setCreator("Portal del empleado");
  doc.setProducer("Portal del empleado");
  doc.setCreationDate(meta.generatedAt);
  doc.setModificationDate(meta.generatedAt);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new PdfWriter(doc, font, bold, A4_LANDSCAPE);

  w.text(def.title, { size: 16, bold: true });
  w.text(meta.companyName, { size: 11 });
  w.text(meta.filtersText, { color: MUTED });
  w.text(
    `Generado el ${meta.generatedAt.toISOString().replace("T", " ").slice(0, 16)} UTC · ${rows.length} filas · exportación ${meta.exportId.slice(0, 8)}`,
    { color: MUTED },
  );
  w.gap();
  // Sin recortes: el PDF sirve para consulta e inspección, cada celda se ve entera.
  w.wrappedTable(
    pdfColumns(def, w.width),
    rows.map((r) => def.columns.map((c) => displayCell(c, r))),
    def.columns.length > 9 ? 6.5 : 7.5,
  );

  const total = w.pages.length;
  w.pages.forEach((p, i) => {
    const footer = safe(`${meta.companyName} · ${def.title} · página ${i + 1} de ${total}`);
    p.drawText(footer, { x: MARGIN, y: MARGIN - 18, size: 7, font, color: MUTED });
  });
  return doc.save({ useObjectStreams: false });
}
