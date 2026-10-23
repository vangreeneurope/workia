import { rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Escritor de PDF A4 sencillo (texto y tablas con cabecera repetida en cada
 * página) sobre pdf-lib con Helvetica estándar. Sin metadatos automáticos: el
 * llamador fija las fechas para que el archivo sea determinista.
 */

export const A4: [number, number] = [595.28, 841.89];
export const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
export const MARGIN = 40;
export const INK = rgb(0.12, 0.16, 0.14);
export const MUTED = rgb(0.4, 0.44, 0.42);
export const RULE = rgb(0.82, 0.86, 0.83);

// Helvetica estándar codifica WinAnsi: lo que no cabe se sustituye por "?".
export const safe = (s: string | null | undefined) =>
  (s ?? "").replace(/[^\x20-\x7E\xA0-\xFF€]/g, "?");

export type PdfColumn = { title: string; width: number; align?: "right" };

export class PdfWriter {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private size: [number, number] = A4,
  ) {
    this.newPage();
  }
  /** Ancho útil de la página. */
  get width(): number {
    return this.size[0] - 2 * MARGIN;
  }
  newPage() {
    this.page = this.doc.addPage(this.size);
    this.pages.push(this.page);
    this.y = this.size[1] - MARGIN;
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
    this.page.drawText(this.fit(s, this.width, size, opts.bold), {
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
  table(columns: PdfColumn[], rows: string[][], size = 8) {
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
        end: { x: MARGIN + this.width, y: this.y + 3 },
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

  /** Parte un texto en líneas que caben en el ancho (corta palabras demasiado largas). */
  wrap(text: string, width: number, size: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const word of safe(text).split(/\s+/).filter(Boolean)) {
      let w = word;
      while (this.font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && this.font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
        if (line) lines.push(line);
        lines.push(w.slice(0, cut));
        line = "";
        w = w.slice(cut);
      }
      const next = line ? `${line} ${w}` : w;
      if (this.font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return lines.length > 0 ? lines : [""];
  }

  /** Tabla sin recortes: cada celda ocupa las líneas que necesite. */
  wrappedTable(columns: PdfColumn[], rows: string[][], size = 7) {
    const lineH = size + 2;
    const header = () => {
      const heads = columns.map((c) => this.wrap(c.title, c.width - 4, size));
      const h = Math.max(...heads.map((l) => l.length)) * lineH + 4;
      this.ensure(h + lineH);
      let x = MARGIN;
      columns.forEach((c, i) => {
        (heads[i] ?? []).forEach((t, j) => {
          const w = this.bold.widthOfTextAtSize(t, size);
          this.page.drawText(t, {
            x: c.align === "right" ? x + c.width - 4 - w : x,
            y: this.y - size - j * lineH,
            size,
            font: this.bold,
            color: MUTED,
          });
        });
        x += c.width;
      });
      this.y -= h;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y + 2 },
        end: { x: MARGIN + this.width, y: this.y + 2 },
        thickness: 0.6,
        color: RULE,
      });
    };
    header();
    for (const row of rows) {
      const cells = columns.map((c, i) => this.wrap(row[i] ?? "", c.width - 4, size));
      const h = Math.max(...cells.map((l) => l.length)) * lineH + 3;
      if (this.y - h < MARGIN + 20) {
        this.newPage();
        header();
      }
      let x = MARGIN;
      columns.forEach((c, i) => {
        (cells[i] ?? []).forEach((t, j) => {
          const w = this.font.widthOfTextAtSize(t, size);
          this.page.drawText(t, {
            x: c.align === "right" ? x + c.width - 4 - w : x,
            y: this.y - size - j * lineH,
            size,
            font: this.font,
            color: INK,
          });
        });
        x += c.width;
      });
      this.y -= h;
    }
  }
}
