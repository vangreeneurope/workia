import { z } from "zod";

import { isIsoDate } from "@/lib/dates";
import { optionalText, optionalUuid, requiredText, requiredUuid } from "@/lib/forms";

import { parseMoneyToCents } from "./money";
import { OCR_FIELDS } from "./ocr/types";
import { normalizeTaxId } from "./tax-id";

/**
 * Esquemas de gastos compartidos por formularios y Server Actions. Los importes
 * se convierten a céntimos enteros. La base de datos vuelve a aplicar todas las
 * reglas de la política al confirmar.
 */

export const PAYMENT_METHODS = [
  "company_card",
  "personal_card",
  "cash",
  "transfer",
  "other",
] as const;

export const PAYMENT_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  company_card: "Tarjeta de empresa",
  personal_card: "Tarjeta personal",
  cash: "Efectivo",
  transfer: "Transferencia",
  other: "Otra",
};

const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

const optionalMoney = (label: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v || !v.trim()) return null;
      const cents = parseMoneyToCents(v);
      if (cents === null || cents < 0) {
        ctx.addIssue({ code: "custom", message: `${label}: escribe un importe como 12,50` });
        return z.NEVER;
      }
      return cents;
    });

const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isIsoDate(v), "La fecha no es válida");

const optionalCurrency = z
  .string()
  .optional()
  .transform((v) => (v ? v.trim().toUpperCase() : null))
  .refine((v) => v === null || /^[A-Z]{3}$/.test(v), "Moneda de 3 letras (EUR, USD…)");

const optionalTaxId = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const id = normalizeTaxId(v);
    if (!id) {
      ctx.addIssue({ code: "custom", message: "NIF no válido: solo letras y cifras" });
      return z.NEVER;
    }
    return id;
  });

/** Kilómetros con un decimal -> décimas de km. */
const optionalDistance = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const m = /^(\d{1,5})(?:[.,](\d))?$/.exec(v.trim());
    if (!m || Number(m[1]) * 10 + Number(m[2] ?? 0) === 0) {
      ctx.addIssue({ code: "custom", message: "Kilómetros con un decimal como máximo (12,5)" });
      return z.NEVER;
    }
    return Number(m[1]) * 10 + Number(m[2] ?? 0);
  });

const reviewedShape = Object.fromEntries(OCR_FIELDS.map((f) => [`reviewed_${f}`, checkbox])) as {
  [K in (typeof OCR_FIELDS)[number] as `reviewed_${K}`]: typeof checkbox;
};

export const expenseSchema = z
  .object({
    expense_id: requiredUuid("el gasto"),
    category_id: optionalUuid,
    expense_date: optionalDate,
    merchant_name: optionalText(120),
    merchant_tax_id: optionalTaxId,
    document_number: optionalText(40),
    currency: optionalCurrency,
    base_cents: optionalMoney("Base"),
    tax_cents: optionalMoney("Impuestos"),
    total_cents: optionalMoney("Total"),
    payment_method: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.enum(PAYMENT_METHODS, { message: "Forma de pago no válida" }).nullable()),
    client_name: optionalText(120),
    project_code: optionalText(60),
    cost_center: optionalText(60),
    notes: optionalText(1000),
    distance_km: optionalDistance,
    duplicate_ack: checkbox,
    ...reviewedShape,
  })
  .superRefine((v, ctx) => {
    if (v.total_cents !== null && v.total_cents === 0)
      ctx.addIssue({
        code: "custom",
        message: "El total debe ser mayor que cero",
        path: ["total_cents"],
      });
    if (v.tax_cents !== null && v.total_cents !== null && v.tax_cents > v.total_cents)
      ctx.addIssue({
        code: "custom",
        message: "Los impuestos no pueden superar el total",
        path: ["tax_cents"],
      });
    if (
      v.base_cents !== null &&
      v.tax_cents !== null &&
      v.total_cents !== null &&
      Math.abs(v.base_cents + v.tax_cents - v.total_cents) > 1
    )
      ctx.addIssue({
        code: "custom",
        message: "La base más los impuestos no coincide con el total",
        path: ["total_cents"],
      });
  });

export type ExpenseInput = z.infer<typeof expenseSchema>;

export function reviewedFields(input: ExpenseInput): string[] {
  return OCR_FIELDS.filter((f) => input[`reviewed_${f}`]);
}

export const categorySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{1,20}$/, "Código de hasta 20 letras, cifras, - o _"),
  name: requiredText(2, 80, "El nombre"),
  is_mileage: checkbox,
  max_amount: optionalMoney("Límite"),
  requires_client: checkbox,
  requires_project: checkbox,
  requires_cost_center: checkbox,
  requires_notes: checkbox,
});

export const policySchema = z
  .object({
    max_days_past: z.coerce
      .number({ message: "Indica un número de días" })
      .int("Número entero")
      .min(0, "Mínimo 0")
      .max(730, "Máximo 730"),
    default_currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Moneda de 3 letras"),
    allowed_currencies: z
      .string()
      .transform((v) =>
        [
          ...new Set(
            v
              .toUpperCase()
              .split(/[\s,;]+/)
              .filter(Boolean),
          ),
        ].slice(0, 20),
      )
      .refine((list) => list.length > 0 && list.every((c) => /^[A-Z]{3}$/.test(c)), {
        message: "Monedas de 3 letras separadas por comas",
      }),
    receipt_required: checkbox,
    mileage_rate: z
      .string()
      .optional()
      .transform((v, ctx) => {
        if (!v || !v.trim()) return null;
        const m = /^(\d{1,3})(?:[.,](\d{1,3}))?$/.exec(v.trim());
        if (!m) {
          ctx.addIssue({ code: "custom", message: "Precio por km como 0,26" });
          return z.NEVER;
        }
        const milli = Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"));
        if (milli === 0) {
          ctx.addIssue({ code: "custom", message: "El precio por km debe ser mayor que cero" });
          return z.NEVER;
        }
        return milli;
      }),
    ocr_total_tolerance: optionalMoney("Tolerancia"),
    legal_reference: optionalText(200),
  })
  .refine((v) => v.allowed_currencies.includes(v.default_currency), {
    message: "La moneda por defecto debe estar entre las admitidas",
    path: ["allowed_currencies"],
  });

export const statusSchema = z.object({
  id: z.uuid(),
  status: z.enum(["active", "inactive"]),
});
