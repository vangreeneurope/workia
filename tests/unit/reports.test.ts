import { unzipSync, unzlibSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { sha256Hex } from "@/features/expenses/receipt-file";
import { REPORTS, reportBySlug, reportVisible, visibleReports } from "@/features/reports/catalog";
import { reportCsv, reportPdf, reportXlsx, type ExportMeta } from "@/features/reports/export/files";
import { exportFileName, filtersText } from "@/features/reports/exports";
import {
  exportFilters,
  filtersFromExport,
  filtersToSearch,
  parseFilters,
} from "@/features/reports/filters";
import { displayCell, formatDuration, mapRow } from "@/features/reports/rows";
import { parseCsv } from "@/lib/csv";

import { companyA, makeContext } from "./fixtures";

const TODAY = "2026-10-22";
const E1 = "e0000000-0000-4000-8000-000000000007";

describe("filtros en la URL", () => {
  it("valida campo a campo: lo no válido se ignora y se avisa", () => {
    const { filters, errors } = parseFilters(
      REPORTS.time_daily,
      { desde: "2026-10-01", hasta: "2026-10-15", persona: "Ana García", equipo: E1 },
      TODAY,
    );
    expect(filters.employee).toBeNull();
    expect(filters.team).toBe(E1);
    expect(filters.from).toBe("2026-10-01");
    expect(errors).toHaveLength(1);
  });

  it("acorta periodos más largos que el máximo del informe y corrige fechas invertidas", () => {
    const long = parseFilters(
      REPORTS.time_daily,
      { desde: "2026-01-01", hasta: "2026-10-01" },
      TODAY,
    );
    expect(long.filters.from).toBe("2026-07-01");
    expect(long.errors[0]).toMatch(/92 días/);
    const inverted = parseFilters(
      REPORTS.time_daily,
      { desde: "2026-10-10", hasta: "2026-10-01" },
      TODAY,
    );
    expect(inverted.filters).toMatchObject({ from: "2026-10-01", to: TODAY });
  });

  it("solo aplica los filtros del informe y por defecto usa el mes en curso", () => {
    const { filters } = parseFilters(
      REPORTS.approvals,
      { persona: E1, cliente: "X", pagina: "3" },
      TODAY,
    );
    expect(filters).toMatchObject({
      from: "2026-10-01",
      to: TODAY,
      employee: null,
      client: null,
      page: 1,
    });
  });

  it("rechaza texto libre peligroso en códigos y acciones desconocidas", () => {
    const exp = parseFilters(REPORTS.expenses, { cliente: "<script>", proyecto: "P-1" }, TODAY);
    expect(exp.filters.client).toBeNull();
    expect(exp.filters.project).toBe("P-1");
    const audit = parseFilters(REPORTS.audit, { accion: "drop", id: "x' or 1=1" }, TODAY);
    expect(audit.filters.action).toBeNull();
    expect(audit.filters.object).toBeNull();
  });

  it("ida y vuelta: URL -> filtros -> URL; la exportación guarda lo mismo sin la página", () => {
    const def = REPORTS.expenses;
    const { filters } = parseFilters(
      def,
      { desde: "2026-09-01", hasta: "2026-09-30", agrupar: "project", pagina: "2" },
      TODAY,
    );
    const q = filtersToSearch(def, filters);
    expect(q).toBe("desde=2026-09-01&hasta=2026-09-30&agrupar=project&pagina=2");
    const stored = exportFilters(def, filters);
    expect(stored).toEqual({ desde: "2026-09-01", hasta: "2026-09-30", agrupar: "project" });
    expect(filtersFromExport(def, stored, TODAY)).toMatchObject({ group: "project", page: 1 });
  });
});

describe("formato", () => {
  it("duraciones en h:mm con enteros (nunca horas decimales)", () => {
    expect(formatDuration(27_000)).toBe("7:30");
    expect(formatDuration(59)).toBe("0:00");
    expect(formatDuration(-900)).toBe("-0:15");
    expect(formatDuration(549_000)).toBe("152:30");
  });

  it("registro horario: fichajes en la zona de la jornada y sin ubicación", () => {
    const row = mapRow("time_register", {
      work_date: "2026-07-01",
      employee_code: "A-007",
      employee_name: "Ejemplo, Uno",
      time_zone: "Europe/Madrid",
      status: "closed",
      started_at: "2026-07-01T07:00:00Z",
      ended_at: "2026-07-01T15:30:00Z",
      worked_seconds: 28_800,
      break_seconds: 1_800,
      punches: [
        { kind: "start", at: "2026-07-01T07:00:00Z", source: "mobile", latitude: 40.4 },
        { kind: "end", at: "2026-07-01T15:30:00Z", source: "kiosk" },
      ],
      adjustments: [
        {
          action: "add",
          kind: "break_start",
          effective_at: "2026-07-01T11:00:00Z",
          approved_at: "2026-07-02T08:00:00Z",
          requested_by: "00000000-0000-0000-0000-000000000007",
          decided_by: "00000000-0000-0000-0000-000000000006",
        },
      ],
    });
    expect(row.punches).toBe("09:00 entrada (móvil) · 17:30 salida (terminal)");
    expect(row.adjustments).toContain("añadir inicio de pausa a las 13:00");
    expect(row.adjustments).toContain("decide 00000000");
    expect(JSON.stringify(row)).not.toContain("40.4");
    const started = REPORTS.time_register.columns.find((c) => c.key === "started_at");
    expect(started && displayCell(started, row)).toBe("01/07/2026, 09:00");
  });

  it("los tipos reservados ya llegan enmascarados y el estado se traduce", () => {
    const row = mapRow("absence_requests", {
      type_label: "Ausencia (reservada)",
      status: "pending",
      amount: 3,
      amount_unit: "half_days",
      start_date: "2026-11-02",
      end_date: "2026-11-03",
    });
    expect(row).toMatchObject({
      type_label: "Ausencia (reservada)",
      status: "Pendiente",
      amount: "1,5 días",
    });
  });
});

const META: ExportMeta = {
  companyName: "Empresa Alfa (sintética)",
  exportId: "a7000000-0000-4000-8000-000000000001",
  generatedAt: new Date("2026-10-22T10:00:00Z"),
  filtersText: "Periodo 2026-09-01 a 2026-09-30",
};

const expenseRows = [
  {
    group_label: "P1",
    currency: "EUR",
    expenses: 2,
    base_cents: 1000,
    tax_cents: 210,
    total_cents: 3710,
  },
  {
    group_label: "=CMD()",
    currency: "USD",
    expenses: 1,
    base_cents: 0,
    tax_cents: 0,
    total_cents: 999,
  },
].map((r) => mapRow("expenses", r));

describe("exportaciones", () => {
  it("CSV: duraciones y céntimos legibles por máquina, fórmulas neutralizadas", () => {
    const csv = parseCsv(new TextDecoder().decode(reportCsv(REPORTS.expenses, expenseRows)));
    expect(csv.headers).toEqual([
      "grupo",
      "moneda",
      "gastos",
      "base",
      "base_centimos",
      "impuestos",
      "impuestos_centimos",
      "total",
      "total_centimos",
    ]);
    expect(csv.rows[0]).toEqual([
      "P1",
      "EUR",
      "2",
      "10.00",
      "1000",
      "2.10",
      "210",
      "37.10",
      "3710",
    ]);
    expect(csv.rows[1]?.[0]).toBe("'=CMD()");
    const daily = parseCsv(
      new TextDecoder().decode(
        reportCsv(REPORTS.time_daily, [
          mapRow("time_daily", { worked_seconds: 27_000, difference_seconds: -600 }),
        ]),
      ),
    );
    const col = (n: string) => daily.headers.indexOf(n);
    expect(daily.rows[0]?.[col("trabajo")]).toBe("7:30");
    expect(daily.rows[0]?.[col("trabajo_segundos")]).toBe("27000");
    expect(daily.rows[0]?.[col("diferencia")]).toBe("-0:10");
  });

  it("los totales del archivo son los de las filas (sin recalcular)", () => {
    const csv = parseCsv(new TextDecoder().decode(reportCsv(REPORTS.expenses, expenseRows)));
    const sum = csv.rows.reduce((s, r) => s + Number(r[8]), 0);
    expect(sum).toBe(3710 + 999);
  });

  it("XLSX: hoja de datos e información, determinista", () => {
    const a = reportXlsx(REPORTS.expenses, expenseRows, META);
    expect(sha256Hex(a)).toBe(
      sha256Hex(reportXlsx(REPORTS.expenses, structuredClone(expenseRows), META)),
    );
    const files = unzipSync(a);
    const data = new TextDecoder().decode(files["xl/worksheets/sheet1.xml"]);
    expect(data).toContain("<v>37.10</v>");
    const info = new TextDecoder().decode(files["xl/worksheets/sheet2.xml"]);
    expect(info).toContain(META.exportId);
  });

  it("PDF: horizontal, determinista y sin recortar textos largos", async () => {
    const long = mapRow("time_register", {
      work_date: "2026-07-01",
      time_zone: "Europe/Madrid",
      status: "closed",
      punches: Array.from({ length: 8 }, (_, i) => ({
        kind: i % 2 ? "break_end" : "break_start",
        at: `2026-07-01T0${i + 1}:00:00Z`,
        source: "web",
      })),
      adjustments: [],
    });
    const a = await reportPdf(REPORTS.time_register, [long], META);
    expect(sha256Hex(a)).toBe(sha256Hex(await reportPdf(REPORTS.time_register, [long], META)));
    const doc = await PDFDocument.load(a);
    const page = doc.getPage(0);
    expect(page.getWidth()).toBeGreaterThan(page.getHeight());
    const text = pdfText(a);
    expect(text).toContain("Registro horario");
    // El último fichaje de la celda (10:00 en Madrid) aparece aunque la celda ocupe varias líneas.
    expect(text).toContain("10:00");
    expect(text).not.toContain("…");
  });

  it("nombre de archivo válido para el registro y filtros sin valores personales", () => {
    const { filters } = parseFilters(REPORTS.time_daily, { persona: E1 }, TODAY);
    expect(exportFileName(REPORTS.time_daily, filters, "xlsx", "Empresa Ñ (sintética)")).toMatch(
      /^[a-z0-9._-]{1,120}$/,
    );
    expect(filtersText(REPORTS.time_daily, filters)).toContain("una persona");
    expect(filtersText(REPORTS.time_daily, filters)).not.toContain(E1);
  });
});

describe("catálogo y ámbito", () => {
  it("cada rol ve los informes que tienen sentido para él", () => {
    const keys = (roles: Parameters<typeof makeContext>[0][number][1]) =>
      visibleReports(makeContext([[companyA, roles]])).map((r) => r.key);
    expect(keys(["employee"])).not.toContain("closures");
    expect(keys(["employee"])).toContain("time_register");
    expect(keys(["accounting"])).toEqual(["expenses", "approvals", "closures"]);
    expect(keys(["auditor"])).toContain("time_register");
    expect(keys(["auditor"])).not.toContain("expenses");
    expect(reportVisible(makeContext([[companyA, ["auditor"]]]), "audit")).toBe(true);
    expect(reportVisible(makeContext([[companyA, ["hr"]]]), "audit")).toBe(false);
  });

  it("las URLs usan slugs en español y la auditoría no se sirve como informe", () => {
    expect(reportBySlug("registro-horario")?.key).toBe("time_register");
    expect(reportBySlug("auditoria")).toBeNull();
    for (const def of Object.values(REPORTS)) expect(def.slug).toMatch(/^[a-z-]+$/);
  });

  it("ninguna exportación general incluye columnas de salud, documentos, ubicación o proveedores", () => {
    const forbidden =
      /(diagn|medic|salud|justificante|ticket|latitud|longitud|selfie|proveedor|\bnif\b)/i;
    for (const def of Object.values(REPORTS))
      for (const c of def.columns) {
        expect(c.label).not.toMatch(forbidden);
        expect(c.csv).not.toMatch(forbidden);
      }
  });
});

/** Texto visible de un PDF de pdf-lib (mismo método que en settlement.test.ts). */
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
