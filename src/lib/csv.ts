/**
 * CSV sin dependencias: lectura (RFC 4180, separador "," o ";", comillas,
 * saltos de línea dentro de campos, BOM) y escritura protegida frente a
 * inyección de fórmulas en hojas de cálculo.
 */

export type ParsedCsv = { headers: string[]; rows: string[][] };

export function detectDelimiter(firstLine: string): "," | ";" {
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text.split(/\r?\n/, 1)[0] ?? "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error("El archivo tiene comillas sin cerrar.");
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((cell) => cell.trim() !== ""));
  const [headerRow, ...rows] = nonEmpty;
  const headers = (headerRow ?? []).map((h) => h.trim());
  return { headers, rows: rows.map((r) => r.map((cell) => cell.trim())) };
}

/** Escapa un valor; neutraliza celdas que una hoja de cálculo ejecutaría como fórmula. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(";"));
  // BOM para que Excel abra correctamente los acentos.
  return `﻿${lines.join("\r\n")}\r\n`;
}
