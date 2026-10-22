import { unzipSync, unzlibSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { sha256Hex } from "@/features/expenses/receipt-file";
import { parseCsv } from "@/lib/csv";
import { batchCsv, CSV_COLUMNS } from "@/features/settlement/export/csv";
import { centsToDecimal, centsToEs } from "@/features/settlement/export/money";
import { exportFileName } from "@/features/settlement/export/names";
import { batchPdf } from "@/features/settlement/export/pdf";
import { receiptsZip } from "@/features/settlement/export/receipts-zip";
import { assertTotalsMatch, computeTotals } from "@/features/settlement/export/totals";
import type { BatchExportData, BatchLine } from "@/features/settlement/export/types";
import { batchXlsx } from "@/features/settlement/export/xlsx";
import { closeSchema, lineDecisionSchema } from "@/features/settlement/schemas";

const line = (n: number, over: Partial<BatchLine>): BatchLine => ({
  line_no: n,
  employee_code: "A-007",
  employee_name: "Ejemplo, Uno",
  expense_date: "2026-09-03",
  category_code: "VIAJE",
  category_name: "Viajes",
  account_code: "6291",
  tax_account_code: "472",
  counterpart_account_code: null,
  cost_center: "CC1",
  project_code: "P1",
  merchant_name: "Tren Sintético",
  merchant_tax_id: "B12345675",
  document_number: "T-1",
  currency: "EUR",
  base_cents: null,
  tax_cents: null,
  total_cents: 100,
  adjustment_reason: null,
  expense_id: `ab000000-0000-4000-8000-00000000000${n}`,
  ...over,
});

const lines: BatchLine[] = [
  line(1, { total_cents: 1234, base_cents: 1020, tax_cents: 214 }),
  line(2, {
    total_cents: 10,
    category_code: "COMIDA",
    category_name: "Comidas",
    account_code: "629",
    project_code: null,
  }),
  line(3, {
    total_cents: 20,
    category_code: "COMIDA",
    category_name: "Comidas",
    account_code: "629",
    project_code: null,
  }),
  line(4, {
    total_cents: 1999,
    currency: "USD",
    merchant_name: '=HYPERLINK("x")',
    cost_center: null,
  }),
  line(5, {
    employee_code: "A-008",
    employee_name: "Ejemplo, Dos",
    total_cents: -500,
    merchant_name: null,
    adjustment_reason: "Anticipo ya pagado",
    expense_id: null,
  }),
];

const data: BatchExportData = {
  companyName: "Empresa Alfa (sintética)",
  companySlug: "alfa",
  batch: {
    id: "ad000000-0000-4000-8000-000000000001",
    sequence: 1,
    kind: "regular",
    periodMonth: "2026-09-01",
    closedAt: "2026-10-27T10:15:00.000Z",
    correctsSequence: null,
    note: null,
  },
  lines,
  totals: computeTotals(lines),
};

describe("dinero sin decimales binarios", () => {
  it("formatea céntimos enteros", () => {
    expect(centsToDecimal(1234)).toBe("12.34");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(-500)).toBe("-5.00");
    expect(centsToEs(123456789)).toBe("1.234.567,89");
    expect(centsToEs(-30)).toBe("-0,30");
    expect(() => centsToDecimal(0.1 + 0.2)).toThrow();
  });
});

describe("totales", () => {
  it("suma exacta por moneda y dimensión; las monedas no se mezclan", () => {
    const total = data.totals.filter((t) => t.dimension === "total");
    expect(total).toEqual([
      expect.objectContaining({
        currency: "EUR",
        total_cents: 1234 + 10 + 20 - 500,
        base_cents: 1020,
        tax_cents: 214,
        lines: 4,
      }),
      expect.objectContaining({ currency: "USD", total_cents: 1999, lines: 1 }),
    ]);
    for (const dim of ["employee", "category", "account", "cost_center", "project"] as const) {
      const eur = data.totals.filter((t) => t.dimension === dim && t.currency === "EUR");
      expect(eur.reduce((s, t) => s + t.total_cents, 0)).toBe(764);
    }
  });

  it("no genera nada si los totales de la base de datos no cuadran con las líneas", () => {
    expect(() => assertTotalsMatch(lines, data.totals)).not.toThrow();
    const wrong = data.totals.map((t) =>
      t.dimension === "total" && t.currency === "EUR"
        ? { ...t, total_cents: t.total_cents + 1 }
        : t,
    );
    expect(() => assertTotalsMatch(lines, wrong)).toThrow(/no cuadran/);
  });
});

describe("CSV", () => {
  it("sigue el esquema documentado y los importes cuadran con los totales", () => {
    const parsed = parseCsv(new TextDecoder().decode(batchCsv(data)));
    expect(parsed.headers).toEqual([...CSV_COLUMNS]);
    expect(parsed.rows).toHaveLength(5);
    const col = (name: string) => CSV_COLUMNS.indexOf(name as (typeof CSV_COLUMNS)[number]);
    const sum = (currency: string) =>
      parsed.rows
        .filter((r) => r[col("moneda")] === currency)
        .reduce((s, r) => s + Number(r[col("total_centimos")]), 0);
    expect(sum("EUR")).toBe(764);
    expect(sum("USD")).toBe(1999);
    expect(parsed.rows[0]?.[col("total")]).toBe("12.34");
    expect(parsed.rows[4]?.[col("total")]).toBe("-5.00");
    expect(parsed.rows[3]?.[col("proveedor")]).toBe(`'=HYPERLINK("x")`);
  });

  it("es determinista", () => {
    expect(sha256Hex(batchCsv(data))).toBe(sha256Hex(batchCsv(structuredClone(data))));
  });
});

describe("XLSX", () => {
  it("contiene las hojas de líneas y totales y es determinista", () => {
    const a = batchXlsx(data);
    expect(sha256Hex(a)).toBe(sha256Hex(batchXlsx(structuredClone(data))));
    // Huella fija: el formato no cambia sin querer (p. ej., al tocar src/lib/files/xlsx.ts).
    expect(sha256Hex(a)).toBe("5418d3acc5007464f0d1b9f9dad19061c3e62f98d172a6df55b869acf6215136");
    const files = unzipSync(a);
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "xl/workbook.xml",
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/sheet2.xml",
      ]),
    );
    const sheet1 = new TextDecoder().decode(files["xl/worksheets/sheet1.xml"]);
    expect(sheet1).toContain("<v>12.34</v>");
    expect(sheet1).toContain("<v>-5.00</v>");
    expect(sheet1).toContain("=HYPERLINK(&quot;x&quot;)");
    const sheet2 = new TextDecoder().decode(files["xl/worksheets/sheet2.xml"]);
    expect(sheet2).toContain("<v>7.64</v>");
  });
});

/** Texto visible de un PDF de pdf-lib: descomprime los flujos y decodifica los textos hexadecimales. */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  let out = "";
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let content: string;
    try {
      content = Buffer.from(unzlibSync(Buffer.from(m[1] ?? "", "latin1"))).toString("latin1");
    } catch {
      continue;
    }
    for (const t of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      out += `${Buffer.from(t[1] ?? "", "hex").toString("latin1")}\n`;
    }
  }
  return out;
}

describe("PDF", () => {
  it("es legible, determinista y lleva los totales", async () => {
    const a = await batchPdf(data);
    const b = await batchPdf(structuredClone(data));
    expect(new TextDecoder().decode(a.slice(0, 5))).toBe("%PDF-");
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    // Huella fija: el formato no cambia sin querer (p. ej., al tocar src/lib/files/pdf-writer.ts).
    expect(sha256Hex(a)).toBe("c6d60bad58d992b29245dfb20e938909532e3fb852f6c1a60dbcc6be9dcc2363");
    // Los totales del PDF son los mismos que los de la base de datos y el CSV.
    const text = pdfText(a);
    expect(text).toContain("Liquidación de gastos");
    expect(text).toContain("7,64");
    expect(text).toContain("19,99");
    expect(text).toContain("-5,00");
    const doc = await PDFDocument.load(a);
    expect(doc.getTitle()).toContain("lote 0001");
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    // Una liquidación larga pagina sin perder líneas.
    const many = {
      ...data,
      lines: Array.from({ length: 120 }, (_, i) => line(i + 1, { total_cents: 100 + i })),
    };
    const big = await PDFDocument.load(
      await batchPdf({ ...many, totals: computeTotals(many.lines) }),
    );
    expect(big.getPageCount()).toBeGreaterThan(1);
  });
});

describe("ZIP de justificantes", () => {
  const receipts = [
    {
      expenseId: lines[0]!.expense_id!,
      extension: "jpg" as const,
      bytes: Uint8Array.from([1, 2, 3]),
    },
    { expenseId: lines[3]!.expense_id!, extension: "pdf" as const, bytes: Uint8Array.from([4, 5]) },
  ];

  it("nombres deterministas, índice con huellas y mismos bytes al regenerar", () => {
    const a = receiptsZip(data, receipts);
    expect(sha256Hex(a)).toBe(sha256Hex(receiptsZip(data, [...receipts].reverse())));
    const files = unzipSync(a);
    expect(Object.keys(files).sort()).toEqual([
      "A-007/2026-09-03_0001_ab000000.jpg",
      "A-007/2026-09-03_0004_ab000000.pdf",
      "indice.csv",
    ]);
    const index = new TextDecoder().decode(files["indice.csv"]);
    expect(index).toContain(sha256Hex(Uint8Array.from([1, 2, 3])));
  });
});

describe("nombres y formularios", () => {
  it("nombres de archivo deterministas y válidos para el registro", () => {
    expect(exportFileName(data, "pdf")).toBe("liquidacion-alfa-2026-09-lote-0001.pdf");
    expect(exportFileName(data, "zip")).toBe(
      "liquidacion-alfa-2026-09-lote-0001-justificantes.zip",
    );
    expect(
      exportFileName({ ...data, batch: { ...data.batch, kind: "corrective", sequence: 2 } }, "csv"),
    ).toBe("liquidacion-alfa-2026-09-lote-0002-corrector.csv");
    for (const f of ["pdf", "csv", "xlsx", "zip"] as const)
      expect(exportFileName(data, f)).toMatch(/^[a-z0-9._-]{1,120}$/);
  });

  it("excluir informes y rechazar o devolver líneas exigen motivo", () => {
    const key = "ac000000-0000-4000-8000-000000000001";
    expect(
      closeSchema.safeParse({ period: "2026-09", idempotency_key: key, excluded: [key] }).success,
    ).toBe(false);
    expect(
      closeSchema.safeParse({
        period: "2026-09",
        idempotency_key: key,
        excluded: [key],
        reason: "Falta un segundo aprobador",
      }).success,
    ).toBe(true);
    expect(lineDecisionSchema.safeParse({ item_id: key, decision: "returned" }).success).toBe(
      false,
    );
    expect(lineDecisionSchema.safeParse({ item_id: key, decision: "approved" }).success).toBe(true);
  });
});
