import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  uploadReceipt: vi.fn(),
  createExpenseWithoutReceipt: vi.fn(),
  saveExpense: vi.fn(),
  confirmExpense: vi.fn(),
  retryOcr: vi.fn(),
  reopenExpense: vi.fn(),
  setExpenseDiscarded: vi.fn(),
  createCategory: vi.fn(),
  setCategoryStatus: vi.fn(),
  savePolicy: vi.fn(),
}));
vi.mock("@/features/expenses/actions", () => actions);

import { CaptureForm } from "@/features/expenses/components/capture-form";
import { ReviewForm, type ReviewExpense } from "@/features/expenses/components/review-form";
import { prepareReceipt } from "@/features/expenses/compress";
import { parseMoneyToCents } from "@/features/expenses/money";
import { FakeOcrProvider } from "@/features/expenses/ocr/fake";
import {
  lowConfidenceFields,
  normalizeDate,
  normalizeOcrResult,
} from "@/features/expenses/ocr/normalize";
import { getOcrProvider } from "@/features/expenses/ocr/registry";
import { runOcrJob, type OcrQueue } from "@/features/expenses/ocr/service";
import { OcrProviderError, type OcrProvider } from "@/features/expenses/ocr/types";
import { checkReceiptFile, RECEIPT_MAX_BYTES } from "@/features/expenses/receipt-file";
import { expenseSchema, policySchema, reviewedFields } from "@/features/expenses/schemas";
import { isValidSpanishTaxId } from "@/features/expenses/tax-id";
import { canUseArea } from "@/lib/admin/access";

const ID = "9d000000-0000-4000-8000-000000000001";
const enc = (s: string) => [...new TextEncoder().encode(s)];

/** JPEG mínimo: SOI, APP1 (EXIF con GPS), SOF0 con dimensiones, SOS y EOI. */
function jpeg(width: number, height: number, exif = "Exif GPS 40.41 -3.70") {
  const app1 = enc(exif);
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    0x00,
    app1.length + 2,
    ...app1,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xda,
    0x00,
    0x02,
    0x11,
    0x22,
    0xff,
    0xd9,
  ]);
}

function chunk(type: string, data: number[]) {
  const len = data.length;
  return [
    len >>> 24,
    (len >> 16) & 0xff,
    (len >> 8) & 0xff,
    len & 0xff,
    ...enc(type),
    ...data,
    0,
    0,
    0,
    0,
  ];
}

/** PNG mínimo con IHDR, un fragmento de texto (metadatos) y IEND. */
function png(width: number, height: number) {
  const ihdr = [
    width >>> 24,
    (width >> 16) & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    height >>> 24,
    (height >> 16) & 0xff,
    (height >> 8) & 0xff,
    height & 0xff,
    8,
    2,
    0,
    0,
    0,
  ];
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", ihdr),
    ...chunk("tEXt", enc("Author\0Persona Sintetica")),
    ...chunk("IDAT", [1, 2, 3]),
    ...chunk("IEND", []),
  ]);
}

const pdf = (body = "1 0 obj << /Type /Catalog >> endobj") =>
  Uint8Array.from(enc(`%PDF-1.7\n${body}\ntrailer\n%%EOF\n`));

describe("validación de tickets en el servidor", () => {
  it("acepta JPEG, PNG y PDF válidos, quita metadatos y calcula la huella", () => {
    const j = checkReceiptFile({
      bytes: jpeg(1200, 1600),
      fileName: "IMG_1.JPG",
      declaredMime: "image/jpeg",
    });
    expect(j).toMatchObject({
      ok: true,
      mime: "image/jpeg",
      extension: "jpg",
      width: 1200,
      height: 1600,
    });
    if (j.ok) {
      expect(new TextDecoder().decode(j.bytes)).not.toMatch(/GPS/);
      expect(j.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const p = checkReceiptFile({
      bytes: png(800, 1000),
      fileName: "ticket.png",
      declaredMime: "image/png",
    });
    expect(p).toMatchObject({ ok: true, width: 800, height: 1000 });
    if (p.ok) expect(new TextDecoder().decode(p.bytes)).not.toMatch(/Persona/);
    expect(
      checkReceiptFile({ bytes: pdf(), fileName: "factura.pdf", declaredMime: "application/pdf" }),
    ).toMatchObject({
      ok: true,
      width: null,
    });
  });

  it("el mismo archivo da la misma huella (duplicado exacto)", () => {
    const a = checkReceiptFile({
      bytes: jpeg(1200, 1600),
      fileName: "a.jpg",
      declaredMime: "image/jpeg",
    });
    const b = checkReceiptFile({
      bytes: jpeg(1200, 1600),
      fileName: "b.jpeg",
      declaredMime: "image/jpeg",
    });
    const c = checkReceiptFile({
      bytes: jpeg(1200, 1601),
      fileName: "c.jpg",
      declaredMime: "image/jpeg",
    });
    expect(a.ok && b.ok && a.sha256 === b.sha256).toBe(true);
    expect(a.ok && c.ok && a.sha256 !== c.sha256).toBe(true);
  });

  it.each([
    [
      "HTML disfrazado de JPEG",
      Uint8Array.from(enc("<html><script>alert(1)</script>")),
      "x.jpg",
      "image/jpeg",
      /no es un PDF/,
    ],
    [
      "ejecutable",
      Uint8Array.from([0x4d, 0x5a, 0x90, 0x00, ...enc("This program")]),
      "ticket.pdf",
      "application/pdf",
      /no es un PDF/,
    ],
    [
      "SVG",
      Uint8Array.from(enc("<svg onload='x'></svg>")),
      "ticket.svg",
      "image/svg+xml",
      /Solo se admiten/,
    ],
    ["PNG con extensión JPG", png(800, 1000), "ticket.jpg", "image/jpeg", /no coincide/],
    ["MIME declarado falso", jpeg(1200, 1600), "ticket.jpg", "application/pdf", /no coincide/],
    [
      "PDF con JavaScript",
      pdf("<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>"),
      "f.pdf",
      "application/pdf",
      /contenido activo/,
    ],
    [
      "PDF con adjunto incrustado",
      pdf("<< /EmbeddedFile 3 0 R >>"),
      "f.pdf",
      "application/pdf",
      /contenido activo/,
    ],
    [
      "PDF truncado",
      Uint8Array.from(enc("%PDF-1.7\n1 0 obj")),
      "f.pdf",
      "application/pdf",
      /no es un PDF/,
    ],
    ["imagen diminuta", jpeg(120, 90), "t.jpg", "image/jpeg", /demasiado pequeña/],
    ["bomba de descompresión", jpeg(12000, 12000), "t.jpg", "image/jpeg", /demasiado grande/],
    ["archivo vacío", new Uint8Array(), "t.jpg", "image/jpeg", /vacío/],
    ["más de 10 MB", new Uint8Array(RECEIPT_MAX_BYTES + 1), "t.pdf", "application/pdf", /10 MB/],
  ])("rechaza %s", (_name, bytes, fileName, declaredMime, message) => {
    const result = checkReceiptFile({ bytes, fileName, declaredMime });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });
});

describe("normalización del OCR", () => {
  it("fechas, importes, moneda y NIF", () => {
    expect(normalizeDate("05/10/2026")).toBe("2026-10-05");
    expect(normalizeDate("5-10-26")).toBe("2026-10-05");
    expect(normalizeDate("31/02/2026")).toBeNull();
    expect(parseMoneyToCents("1.234,56 €")).toBe(123456);
    expect(parseMoneyToCents("1,234.56")).toBe(123456);
    expect(parseMoneyToCents("12,5")).toBe(1250);
    expect(parseMoneyToCents("1.000")).toBe(100000);
    expect(parseMoneyToCents("doce")).toBeNull();
    expect(isValidSpanishTaxId("12345678Z")).toBe(true);
    expect(isValidSpanishTaxId("12345678A")).toBe(false);
    expect(isValidSpanishTaxId("X1234567L")).toBe(true);
    expect(isValidSpanishTaxId("B12345674")).toBe(true);
  });

  it("conserva la confianza, descarta lo ilegible y marca lo incoherente para revisar", () => {
    const result = normalizeOcrResult({
      expense_date: { value: "40/13/2026", confidence: 0.99 },
      merchant_name: { value: "  Bar   Sintético ", confidence: 0.91 },
      merchant_tax_id: { value: "B-1234567-5", confidence: 0.95 },
      base_cents: { value: "10,00", confidence: 0.9 },
      tax_cents: { value: "2,10", confidence: 0.9 },
      total_cents: { value: "15,00 €", confidence: 0.97 },
      currency: { value: "€", confidence: 0.99 },
    });
    expect(result.expense_date).toBeUndefined();
    expect(result.merchant_name).toEqual({ value: "Bar Sintético", confidence: 0.91 });
    expect(result.currency?.value).toBe("EUR");
    expect(result.merchant_tax_id).toEqual({ value: "B12345675", confidence: 0.5 });
    expect(result.total_cents).toEqual({ value: "1500", confidence: 0.5 });
    expect(lowConfidenceFields(result)).toEqual([
      "merchant_tax_id",
      "base_cents",
      "tax_cents",
      "total_cents",
    ]);
    expect(Object.keys(result)).not.toContain("raw_text");
  });
});

describe("proveedor falso", () => {
  const input = { bytes: jpeg(1200, 1600), mime: "image/jpeg" as const };
  const signal = new AbortController().signal;

  it("es determinista: el mismo archivo da el mismo resultado", async () => {
    const a = await new FakeOcrProvider({ today: "2026-10-22" }).extract(input, { signal });
    const b = await new FakeOcrProvider({ today: "2026-10-22" }).extract(input, { signal });
    const c = await new FakeOcrProvider({ today: "2026-10-22" }).extract(
      { bytes: jpeg(1300, 1600), mime: "image/jpeg" },
      { signal },
    );
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    const n = normalizeOcrResult(a);
    expect(Number(n.base_cents?.value) + Number(n.tax_cents?.value)).toBe(
      Number(n.total_cents?.value),
    );
    expect(isValidSpanishTaxId(n.merchant_tax_id?.value ?? "")).toBe(true);
  });

  it("simula caídas y baja confianza", async () => {
    await expect(
      new FakeOcrProvider({ failWith: "provider_unavailable" }).extract(input, { signal }),
    ).rejects.toThrow(OcrProviderError);
    const flaky = new FakeOcrProvider({ failTimes: 1 });
    await expect(flaky.extract(input, { signal })).rejects.toThrow();
    await expect(flaky.extract(input, { signal })).resolves.toBeTruthy();
    const low = await new FakeOcrProvider({ lowConfidence: ["total_cents"] }).extract(input, {
      signal,
    });
    expect(low.total_cents?.confidence).toBeLessThan(0.8);
  });
});

describe("registro de proveedores", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sin proveedor aprobado no hay OCR; el falso nunca en producción", () => {
    vi.stubEnv("OCR_PROVIDER", "");
    expect(getOcrProvider()).toBeNull();
    vi.stubEnv("OCR_PROVIDER", "fake");
    vi.stubEnv("NODE_ENV", "production");
    expect(getOcrProvider()).toBeNull();
    vi.stubEnv("NODE_ENV", "development");
    expect(getOcrProvider()?.id).toBe("fake");
    vi.stubEnv("OCR_PROVIDER", "proveedor-sin-aprobar");
    expect(getOcrProvider()).toBeNull();
  });
});

/** Cola en memoria con las mismas reglas que la base de datos (un intento a la vez). */
function memoryQueue(
  options: { claimable?: boolean; bytes?: Uint8Array | null; finishFails?: boolean } = {},
) {
  const finished: { status: string; result: unknown; errorCode: string | null }[] = [];
  let claimed = false;
  const queue: OcrQueue = {
    claim: vi.fn(async () => {
      if (options.claimable === false || claimed) return null;
      claimed = true;
      return { runId: "run-1", storagePath: "a/b/2026/10/c.jpg", mime: "image/jpeg" };
    }),
    download: vi.fn(async () => (options.bytes === undefined ? jpeg(1200, 1600) : options.bytes)),
    finish: vi.fn(async (_run, status, result, errorCode) => {
      if (options.finishFails && status === "succeeded") throw new Error("db");
      finished.push({ status, result, errorCode });
      return status === "succeeded" && lowConfidenceFields(result as never).length
        ? "needs_review"
        : status;
    }),
  };
  return { queue, finished };
}

describe("cola de OCR", () => {
  const ok = new FakeOcrProvider({ today: "2026-10-22" });

  it("lee, normaliza y guarda solo campos normalizados", async () => {
    const { queue, finished } = memoryQueue();
    const outcome = await runOcrJob("job", ok, queue);
    expect(["succeeded", "needs_review"]).toContain(outcome.status);
    expect(finished).toHaveLength(1);
    expect(Object.keys(finished[0]?.result as object).sort()).toEqual([
      "base_cents",
      "currency",
      "document_number",
      "expense_date",
      "merchant_name",
      "merchant_tax_id",
      "tax_cents",
      "total_cents",
    ]);
  });

  it("OCR caído: la ejecución queda fallida con su código y el gasto sigue editable", async () => {
    const { queue, finished } = memoryQueue();
    const outcome = await runOcrJob(
      "job",
      new FakeOcrProvider({ failWith: "provider_unavailable" }),
      queue,
    );
    expect(outcome).toEqual({ status: "failed", errorCode: "provider_unavailable" });
    expect(finished).toEqual([
      { status: "failed", result: null, errorCode: "provider_unavailable" },
    ]);
  });

  it("tiempo agotado", async () => {
    const slow: OcrProvider = { id: "lento", extract: () => new Promise(() => {}) };
    const { queue } = memoryQueue();
    await expect(runOcrJob("job", slow, queue, 20)).resolves.toEqual({
      status: "failed",
      errorCode: "timeout",
    });
  });

  it("reintentar un trabajo ya en curso o terminado no ejecuta otra vez", async () => {
    const { queue, finished } = memoryQueue();
    await runOcrJob("job", ok, queue);
    await expect(runOcrJob("job", ok, queue)).resolves.toEqual({ status: "skipped" });
    expect(finished).toHaveLength(1);
  });

  it("si no se puede descargar o guardar, falla de forma controlada", async () => {
    const noFile = memoryQueue({ bytes: null });
    await expect(runOcrJob("job", ok, noFile.queue)).resolves.toEqual({
      status: "failed",
      errorCode: "download_failed",
    });
    const dbDown = memoryQueue({ finishFails: true });
    await expect(runOcrJob("job", ok, dbDown.queue)).resolves.toEqual({
      status: "failed",
      errorCode: "internal_error",
    });
  });
});

describe("esquemas", () => {
  it("convierte importes a céntimos y comprueba base + impuestos", () => {
    const parsed = expenseSchema.parse({
      expense_id: ID,
      total_cents: "24,20",
      base_cents: "20",
      tax_cents: "4,20",
      reviewed_expense_date: "on",
      distance_km: "12,5",
    });
    expect(parsed).toMatchObject({
      total_cents: 2420,
      base_cents: 2000,
      tax_cents: 420,
      distance_km: 125,
    });
    expect(reviewedFields(parsed)).toEqual(["expense_date"]);
    expect(
      expenseSchema.safeParse({
        expense_id: ID,
        total_cents: "24,20",
        base_cents: "20",
        tax_cents: "1",
      }).success,
    ).toBe(false);
    expect(expenseSchema.safeParse({ expense_id: ID, total_cents: "veinte" }).success).toBe(false);
  });

  it("política: precio por km en milésimas y monedas admitidas", () => {
    expect(
      policySchema.parse({
        max_days_past: "60",
        default_currency: "eur",
        allowed_currencies: "eur, usd",
        mileage_rate: "0,26",
      }),
    ).toMatchObject({
      mileage_rate: 260,
      allowed_currencies: ["EUR", "USD"],
      default_currency: "EUR",
    });
    expect(
      policySchema.safeParse({
        max_days_past: "60",
        default_currency: "GBP",
        allowed_currencies: "EUR",
      }).success,
    ).toBe(false);
  });

  it("el área de administración de gastos exige gestión a nivel de empresa", () => {
    const perm = (permission: string, scope_type = "company") => ({
      permission,
      scope_type,
      work_center_id: null,
      team_id: null,
    });
    expect(canUseArea("gastos", [perm("expense.manage")], { groupAdmin: false })).toBe(true);
    expect(canUseArea("gastos", [perm("expense.read")], { groupAdmin: false })).toBe(false);
  });
});

describe("preparación de la foto en el móvil", () => {
  const decoder = (w: number, h: number) => async () => ({ width: w, height: h, draw: () => {} });

  it("una foto ligera y legible se envía tal cual; un PDF no se toca", async () => {
    const photo = new File([jpeg(1200, 1600)], "IMG_2024.jpg", { type: "image/jpeg" });
    const result = await prepareReceipt(photo, decoder(1200, 1600));
    expect(result).toMatchObject({ ok: true, compressed: false, width: 1200 });
    if (result.ok) expect(result.file.name).toBe("ticket.jpg");
    const doc = await prepareReceipt(
      new File([pdf()], "Factura Persona.pdf", { type: "application/pdf" }),
    );
    expect(doc).toMatchObject({ ok: true, compressed: false });
    if (doc.ok) expect(doc.file.name).toBe("ticket.pdf");
  });

  it("rechaza fotos ilegibles y formatos no admitidos", async () => {
    const tiny = await prepareReceipt(
      new File([jpeg(120, 90)], "a.jpg", { type: "image/jpeg" }),
      decoder(120, 90),
    );
    expect(tiny).toMatchObject({ ok: false });
    const gif = await prepareReceipt(new File(["GIF89a"], "a.gif", { type: "text/plain" }));
    expect(gif).toMatchObject({ ok: false });
  });
});

describe("captura", () => {
  beforeEach(() => actions.uploadReceipt.mockReset());

  it("con la foto elegida muestra la vista previa y reutiliza la clave al reintentar", async () => {
    actions.uploadReceipt.mockResolvedValue({ status: "error", message: "Sin conexión" });
    URL.createObjectURL = vi.fn(() => "blob:vista");
    URL.revokeObjectURL = vi.fn();
    render(<CaptureForm />);
    expect(screen.getByRole("button", { name: /Hacer foto del ticket/ })).toBeInTheDocument();
    expect(screen.getByTestId("camera-input")).toHaveAttribute("capture", "environment");
    await userEvent.upload(
      screen.getByTestId("file-input"),
      new File([jpeg(1200, 1600)], "t.jpg", { type: "image/jpeg" }),
    );
    expect(await screen.findByAltText("Vista previa del ticket")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Usar este ticket" }));
    await waitFor(() => expect(actions.uploadReceipt).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Sin conexión")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Usar este ticket" }));
    await waitFor(() => expect(actions.uploadReceipt).toHaveBeenCalledTimes(2));
    const key = (n: number) =>
      (actions.uploadReceipt.mock.calls[n]?.[1] as FormData).get("idempotency_key");
    expect(key(0)).toMatch(/^[0-9a-f-]{36}$/);
    expect(key(0)).toBe(key(1));
  });
});

const expense: ReviewExpense = {
  id: ID,
  source: "receipt",
  category_id: null,
  expense_date: null,
  merchant_name: null,
  merchant_tax_id: null,
  document_number: null,
  currency: null,
  base_cents: null,
  tax_cents: null,
  total_cents: null,
  payment_method: null,
  client_name: null,
  project_code: null,
  cost_center: null,
  notes: null,
  distance_km_tenths: null,
};

describe("revisión", () => {
  beforeEach(() => {
    actions.saveExpense.mockReset();
    actions.confirmExpense.mockReset();
  });

  function renderReview() {
    render(
      <ReviewForm
        expense={expense}
        proposal={{
          expense_date: { value: "2026-10-20", confidence: 0.55 },
          merchant_name: { value: "Cafetería Ejemplo", confidence: 0.95 },
          total_cents: { value: "2420", confidence: 0.97 },
        }}
        low={["expense_date"]}
        categories={[
          {
            id: "9c000000-0000-4000-8000-0000000000a1",
            label: "Viajes (VIAJE)",
            isMileage: false,
            maxAmountCents: 10000,
            requiresClient: false,
            requiresProject: true,
            requiresCostCenter: false,
            requiresNotes: false,
          },
        ]}
        currencies={["EUR", "USD"]}
        defaultCurrency="EUR"
        mileageRateMilli={null}
        similarCount={1}
        today="2026-10-22"
      />,
    );
  }

  it("rellena con la propuesta, resalta la baja confianza y pide comprobarla", () => {
    renderReview();
    expect(screen.getByLabelText(/^Total/)).toHaveValue("24,20");
    expect(screen.getByLabelText(/^Proveedor/)).toHaveValue("Cafetería Ejemplo");
    expect(screen.getAllByText(/Propuesto por la lectura automática/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Revisa este dato con el ticket \(confianza 55 %\)/),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox", { name: "Lo he comprobado" })).toHaveLength(1);
    expect(screen.getByText(/mismo proveedor, fecha, total y moneda/)).toBeInTheDocument();
  });

  it("al elegir la categoría muestra sus campos obligatorios sin perder lo escrito", async () => {
    renderReview();
    await userEvent.clear(screen.getByLabelText(/^Total/));
    await userEvent.type(screen.getByLabelText(/^Total/), "30,00");
    await userEvent.selectOptions(screen.getByLabelText(/Categoría/), "Viajes (VIAJE)");
    expect(screen.getByLabelText("Proyecto *")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Total/)).toHaveValue("30,00");
  });

  it("confirmar envía los campos comprobados; guardar no confirma", async () => {
    actions.confirmExpense.mockResolvedValue({ status: "success", message: "Gasto listo." });
    actions.saveExpense.mockResolvedValue({ status: "success", message: "Borrador guardado." });
    renderReview();
    await userEvent.click(screen.getByRole("checkbox", { name: "Lo he comprobado" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmar gasto" }));
    await waitFor(() => expect(actions.confirmExpense).toHaveBeenCalledTimes(1));
    const fd = actions.confirmExpense.mock.calls[0]?.[1] as FormData;
    expect(fd.get("reviewed_expense_date")).toBe("on");
    expect(fd.get("expense_id")).toBe(ID);
    await userEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    await waitFor(() => expect(actions.saveExpense).toHaveBeenCalledTimes(1));
    expect(actions.confirmExpense).toHaveBeenCalledTimes(1);
  });
});
