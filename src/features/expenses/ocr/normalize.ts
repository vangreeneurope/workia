/**
 * Normalización común a cualquier proveedor: fecha ISO, importes en céntimos,
 * moneda ISO 4217, NIF/NIE/CIF sin separadores. Si un valor no se puede
 * interpretar se descarta (null); si es dudoso, su confianza baja para que la
 * persona lo revise. La confianza original del proveedor se conserva cuando el
 * valor es correcto.
 */

import { isValidSpanishTaxId, normalizeTaxId } from "../tax-id";
import { parseMoneyToCents } from "../money";

import {
  OCR_CONFIDENCE_THRESHOLD,
  OCR_FIELDS,
  type NormalizedOcrResult,
  type OcrField,
  type RawOcrResult,
} from "./types";

const DOUBTFUL = 0.5;

const CURRENCY_SYMBOLS: Record<string, string> = {
  "€": "EUR",
  EUR: "EUR",
  EUROS: "EUR",
  $: "USD",
  USD: "USD",
  "£": "GBP",
  GBP: "GBP",
  CHF: "CHF",
};

function clampConfidence(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/** dd/mm/aaaa, dd-mm-aa, dd.mm.aaaa o aaaa-mm-dd -> aaaa-mm-dd (fecha real). */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const eu = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (eu) {
    [d, m, y] = [Number(eu[1]), Number(eu[2]), Number(eu[3])];
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return date.toISOString().slice(0, 10);
}

export function normalizeCurrency(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (CURRENCY_SYMBOLS[s]) return CURRENCY_SYMBOLS[s] ?? null;
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

function field(value: string | null, confidence: number): OcrField {
  return { value, confidence: value === null ? 0 : Math.round(confidence * 100) / 100 };
}

export function normalizeOcrResult(raw: RawOcrResult): NormalizedOcrResult {
  const out: NormalizedOcrResult = {};
  for (const key of OCR_FIELDS) {
    const input = raw[key];
    if (!input || typeof input.value !== "string" || input.value.trim() === "") continue;
    const text = input.value.slice(0, 200);
    const confidence = clampConfidence(input.confidence);
    switch (key) {
      case "expense_date":
        out[key] = field(normalizeDate(text), confidence);
        break;
      case "base_cents":
      case "tax_cents":
      case "total_cents": {
        const cents = parseMoneyToCents(text);
        out[key] = field(cents === null || cents < 0 ? null : String(cents), confidence);
        break;
      }
      case "currency":
        out[key] = field(normalizeCurrency(text), confidence);
        break;
      case "merchant_tax_id": {
        const id = normalizeTaxId(text);
        // Un NIF con letra de control incorrecta se propone, pero hay que revisarlo.
        out[key] = id
          ? field(id, isValidSpanishTaxId(id) ? confidence : Math.min(confidence, DOUBTFUL))
          : field(null, 0);
        break;
      }
      case "merchant_name":
        out[key] = field(text.replace(/\s+/g, " ").trim().slice(0, 120) || null, confidence);
        break;
      case "document_number":
        out[key] = field(text.replace(/\s+/g, " ").trim().slice(0, 40) || null, confidence);
        break;
    }
  }
  // Coherencia: si base + impuestos no da el total, los tres quedan para revisar.
  const n = (k: "base_cents" | "tax_cents" | "total_cents") =>
    out[k]?.value ? Number(out[k]?.value) : null;
  const [base, tax, total] = [n("base_cents"), n("tax_cents"), n("total_cents")];
  if (base !== null && tax !== null && total !== null && Math.abs(base + tax - total) > 1) {
    for (const k of ["base_cents", "tax_cents", "total_cents"] as const) {
      const f = out[k];
      if (f) out[k] = { value: f.value, confidence: Math.min(f.confidence, DOUBTFUL) };
    }
  }
  // Los campos descartados no se guardan: no aportan nada a la revisión.
  for (const key of OCR_FIELDS) if (out[key]?.value === null) delete out[key];
  return out;
}

/** Campos con valor propuesto y confianza por debajo del umbral. */
export function lowConfidenceFields(result: NormalizedOcrResult | null): string[] {
  if (!result) return [];
  return OCR_FIELDS.filter((k) => {
    const f = result[k];
    return f?.value && f.confidence < OCR_CONFIDENCE_THRESHOLD;
  });
}
