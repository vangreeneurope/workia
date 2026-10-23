import { z } from "zod";

import { parseMoneyToCents } from "@/features/expenses/money";
import { optionalText, optionalUuid, requiredText, requiredUuid } from "@/lib/forms";

/** Esquemas de informes, aprobación y contabilidad. La base de datos revalida todo. */

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Elige un mes");
const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

export const submitReportSchema = z.object({ period, idempotency_key: z.uuid() });

export const lineDecisionSchema = z
  .object({
    item_id: requiredUuid("la línea"),
    decision: z.enum(["approved", "rejected", "returned"], { message: "Elige una decisión" }),
    comment: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.decision !== "approved" && (v.comment?.length ?? 0) < 5)
      ctx.addIssue({
        code: "custom",
        message: "Explica el motivo (mínimo 5 caracteres)",
        path: ["comment"],
      });
  });

export const completeStepSchema = z
  .object({
    report_id: requiredUuid("el informe"),
    action: z.enum(["approve", "return"]),
    comment: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.action === "return" && (v.comment?.length ?? 0) < 5)
      ctx.addIssue({
        code: "custom",
        message: "Explica el motivo de la devolución",
        path: ["comment"],
      });
  });

export const closeSchema = z
  .object({
    period,
    idempotency_key: z.uuid(),
    excluded: z.array(z.uuid()).max(500),
    reason: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.excluded.length > 0 && (v.reason?.length ?? 0) < 10)
      ctx.addIssue({
        code: "custom",
        message: "Explica por qué se excluyen informes pendientes (mínimo 10 caracteres)",
        path: ["reason"],
      });
  });

const accountCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{1,30}$/, "Código de cuenta: letras, cifras, punto, guion (máx. 30)");
const optionalAccount = z
  .string()
  .optional()
  .transform((v) => (v?.trim() ? v.trim() : null))
  .refine((v) => v === null || /^[A-Za-z0-9._-]{1,30}$/.test(v), "Código de cuenta no válido");

export const correctiveSchema = z
  .object({
    batch_id: requiredUuid("el lote"),
    idempotency_key: z.uuid(),
    include_late_reports: checkbox,
    note: requiredText(10, 500, "El motivo"),
    employee_id: optionalUuid,
    category_id: optionalUuid,
    currency: z
      .string()
      .optional()
      .transform((v) => (v ? v.trim().toUpperCase() : "EUR")),
    amount: z
      .string()
      .optional()
      .transform((v) => (v?.trim() ? parseMoneyToCents(v) : null)),
    reason: optionalText(300),
  })
  .superRefine((v, ctx) => {
    if (!v.employee_id) return;
    if (!v.category_id)
      ctx.addIssue({ code: "custom", message: "Elige la categoría", path: ["category_id"] });
    if (v.amount === null || v.amount === 0)
      ctx.addIssue({
        code: "custom",
        message: "Importe distinto de cero (negativo con -)",
        path: ["amount"],
      });
    if (!/^[A-Z]{3}$/.test(v.currency))
      ctx.addIssue({ code: "custom", message: "Moneda de 3 letras", path: ["currency"] });
    if ((v.reason?.length ?? 0) < 5)
      ctx.addIssue({ code: "custom", message: "Explica el ajuste", path: ["reason"] });
  });

export const mappingSchema = z.object({
  category_id: optionalUuid,
  account_code: accountCode,
  tax_account_code: optionalAccount,
  counterpart_account_code: optionalAccount,
});

export const ruleSchema = z.object({
  name: requiredText(2, 80, "El nombre"),
  step_order: z.coerce.number().int().min(2, "Mínimo 2").max(9, "Máximo 9"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Moneda de 3 letras"),
  min_total: z.string().transform((v, ctx) => {
    const cents = parseMoneyToCents(v);
    if (cents === null || cents < 0) {
      ctx.addIssue({ code: "custom", message: "Importe como 500,00" });
      return z.NEVER;
    }
    return cents;
  }),
  category_id: optionalUuid,
  approver_role: z.enum(["company_admin", "accounting"], { message: "Elige quién aprueba" }),
});
