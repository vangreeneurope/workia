import { createHash } from "node:crypto";

import { syntheticCif } from "../tax-id";

import {
  OcrProviderError,
  type OcrErrorCode,
  type OcrFieldKey,
  type OcrInput,
  type OcrProvider,
  type RawOcrResult,
} from "./types";

/**
 * Proveedor falso y determinista para desarrollo y pruebas. No lee la imagen:
 * deriva todos los datos de la huella SHA-256 del archivo, de modo que el mismo
 * archivo produce siempre el mismo resultado. Los datos son sintéticos y nunca
 * se usan en producción (ver registry.ts).
 */
const MERCHANTS = [
  "Cafetería Ejemplo",
  "Restaurante Ficticio",
  "Hotel Sintético",
  "Gasolinera Demo",
  "Taxi Prueba",
  "Papelería Muestra",
];

export type FakeOcrOptions = {
  /** Fecha de referencia (aaaa-mm-dd) para la fecha del ticket; por defecto, hoy en Madrid. */
  today?: string;
  /** Falla siempre con este código (simula un OCR caído). */
  failWith?: OcrErrorCode;
  /** Falla solo las primeras N llamadas (simula un fallo transitorio). */
  failTimes?: number;
  /** Fuerza baja confianza en estos campos. */
  lowConfidence?: OcrFieldKey[];
};

export class FakeOcrProvider implements OcrProvider {
  readonly id = "fake";
  private calls = 0;

  constructor(private readonly options: FakeOcrOptions = {}) {}

  async extract(input: OcrInput, { signal }: { signal: AbortSignal }): Promise<RawOcrResult> {
    if (signal.aborted) throw new OcrProviderError("timeout");
    this.calls += 1;
    if (this.options.failWith) throw new OcrProviderError(this.options.failWith);
    if (this.options.failTimes && this.calls <= this.options.failTimes)
      throw new OcrProviderError("provider_unavailable");

    const h = createHash("sha256").update(input.bytes).digest();
    const byte = (i: number) => h[i] ?? 0;
    const total = 500 + (((byte(0) << 8) + byte(1)) % 14500); // 5,00 a 149,99
    const base = Math.round(total / 1.21);
    const tax = total - base;
    const today =
      this.options.today ?? new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (byte(2) % 10));
    const [y, m, d] = date.toISOString().slice(0, 10).split("-");
    const digits = String(
      1_000_000 + (((byte(3) << 16) + (byte(4) << 8) + byte(5)) % 9_000_000),
    ).slice(0, 7);
    // Confianza entre 0,60 y 0,99 según la huella; algunos campos quedarán para revisar.
    const conf = (i: number, key: OcrFieldKey) =>
      this.options.lowConfidence?.includes(key) ? 0.42 : 0.6 + (byte(10 + i) % 40) / 100;
    const euros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

    return {
      expense_date: { value: `${d}/${m}/${y}`, confidence: conf(0, "expense_date") },
      merchant_name: {
        value: MERCHANTS[byte(6) % MERCHANTS.length] ?? null,
        confidence: conf(1, "merchant_name"),
      },
      merchant_tax_id: { value: syntheticCif("B", digits), confidence: conf(2, "merchant_tax_id") },
      base_cents: { value: euros(base), confidence: conf(3, "base_cents") },
      tax_cents: { value: euros(tax), confidence: conf(4, "tax_cents") },
      total_cents: { value: `${euros(total)} €`, confidence: conf(5, "total_cents") },
      currency: { value: "EUR", confidence: 0.99 },
      document_number: {
        value: `T-${(byte(7) << 8) + byte(8)}`,
        confidence: conf(6, "document_number"),
      },
    };
  }
}
