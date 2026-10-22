import { zipSync } from "fflate";

import { CSV_COLUMNS } from "./csv";
import { centsToDecimal } from "./money";
import { exportDate } from "./names";
import type { BatchExportData, TotalRow } from "./types";

/**
 * XLSX mínimo (Office Open XML) escrito a mano: hojas "Lineas" y "Totales".
 * Los importes se escriben como texto decimal exacto generado con enteros y,
 * además, en céntimos. Fecha interna fija (la del cierre): mismo lote, mismos bytes.
 */

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Caracteres de control no válidos en XML.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function col(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

type Cell = { s: string } | { n: string; money?: boolean } | null;

function sheet(rows: Cell[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((c, i) => {
          const ref = `${col(i)}${r + 1}`;
          if (c === null) return "";
          if ("s" in c)
            return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${esc(c.s)}</t></is></c>`;
          return `<c r="${ref}"${c.money ? ' s="2"' : ""}><v>${c.n}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${body}</sheetData></worksheet>`;
}

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
  const enc = (s: string) => new TextEncoder().encode(s);
  const mtime = exportDate(data);
  const files: Record<string, [Uint8Array, { mtime: Date }]> = {
    "[Content_Types].xml": [
      enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      ),
      { mtime },
    ],
    "_rels/.rels": [
      enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
      { mtime },
    ],
    "xl/workbook.xml": [
      enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Lineas" sheetId="1" r:id="rId1"/><sheet name="Totales" sheetId="2" r:id="rId2"/></sheets></workbook>`,
      ),
      { mtime },
    ],
    "xl/_rels/workbook.xml.rels": [
      enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
      { mtime },
    ],
    "xl/styles.xml": [
      enc(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
      ),
      { mtime },
    ],
    "xl/worksheets/sheet1.xml": [enc(sheet(lineRows)), { mtime }],
    "xl/worksheets/sheet2.xml": [enc(sheet(totalRows)), { mtime }],
  };
  return zipSync(files, { level: 6, mtime });
}
