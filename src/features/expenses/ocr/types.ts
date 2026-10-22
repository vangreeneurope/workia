/**
 * Contrato de cualquier proveedor de OCR. El proveedor recibe el archivo y
 * devuelve textos crudos por campo con su confianza (0 a 1); la normalización
 * (fechas, importes, NIF, moneda) la hace la aplicación, igual para todos.
 * Nunca se devuelve ni se guarda el texto completo del ticket.
 */

export const OCR_FIELDS = [
  "expense_date",
  "merchant_name",
  "merchant_tax_id",
  "base_cents",
  "tax_cents",
  "total_cents",
  "currency",
  "document_number",
] as const;

export type OcrFieldKey = (typeof OCR_FIELDS)[number];

/** Umbral por debajo del cual un campo exige revisión (igual que en la base de datos). */
export const OCR_CONFIDENCE_THRESHOLD = 0.8;

export type OcrField = { value: string | null; confidence: number };

/** Lo que devuelve un proveedor: texto tal como lo leyó. */
export type RawOcrResult = Partial<Record<OcrFieldKey, OcrField>>;

/** Lo que se guarda: valores normalizados (fecha ISO, céntimos, ISO 4217…). */
export type NormalizedOcrResult = Partial<Record<OcrFieldKey, OcrField>>;

export type OcrInput = { bytes: Uint8Array; mime: "application/pdf" | "image/jpeg" | "image/png" };

export interface OcrProvider {
  /** Identificador corto que queda en cada ejecución (p. ej., "fake"). */
  readonly id: string;
  extract(input: OcrInput, options: { signal: AbortSignal }): Promise<RawOcrResult>;
}

export type OcrErrorCode =
  | "provider_unavailable"
  | "timeout"
  | "unsupported_file"
  | "invalid_response"
  | "download_failed"
  | "internal_error";

/** Error esperado de un proveedor: el código se guarda; el mensaje, nunca. */
export class OcrProviderError extends Error {
  constructor(readonly code: OcrErrorCode) {
    super(code);
    this.name = "OcrProviderError";
  }
}
