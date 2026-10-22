import { z } from "zod";

/** Esquemas de seguridad de la cuenta y privacidad. La base de datos revalida todo. */

export const totpCodeSchema = z.object({
  factor_id: z.uuid({ message: "Factor no válido" }),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Escribe los 6 dígitos que muestra tu aplicación"),
});

export const factorSchema = z.object({ factor_id: z.uuid({ message: "Factor no válido" }) });

export const DATA_REQUEST_KINDS = [
  "access",
  "rectification",
  "erasure",
  "restriction",
  "portability",
  "objection",
] as const;

export const DATA_REQUEST_LABELS: Record<(typeof DATA_REQUEST_KINDS)[number], string> = {
  access: "Acceso a mis datos",
  rectification: "Rectificación",
  erasure: "Supresión",
  restriction: "Limitación del tratamiento",
  portability: "Portabilidad",
  objection: "Oposición",
};

export const DATA_REQUEST_STATUS_LABELS: Record<string, string> = {
  received: "Recibida",
  in_review: "En revisión",
  approved: "Aprobada",
  partially_approved: "Aprobada en parte",
  rejected: "Rechazada",
  completed: "Completada",
};

export const dataRequestSchema = z.object({
  kind: z.enum(DATA_REQUEST_KINDS, { message: "Elige el tipo de solicitud" }),
  // Lo escribe la persona: se avisa de no incluir datos de salud.
  details: z
    .string()
    .trim()
    .max(1000, "Máximo 1000 caracteres")
    .optional()
    .transform((v) => (v ? v : null)),
  idempotency_key: z.uuid(),
});

export const reviewRequestSchema = z.object({
  request_id: z.uuid(),
  status: z.enum(["in_review", "approved", "partially_approved", "rejected"], {
    message: "Elige una decisión",
  }),
  note: z
    .string()
    .trim()
    .max(1000, "Máximo 1000 caracteres")
    .optional()
    .transform((v) => (v ? v : null)),
});

export const completeRequestSchema = z.object({
  request_id: z.uuid(),
  note: z
    .string()
    .trim()
    .max(1000, "Máximo 1000 caracteres")
    .optional()
    .transform((v) => (v ? v : null)),
});

export const LEGAL_HOLD_CATEGORIES = [
  "all",
  "time",
  "absences",
  "expenses",
  "notifications",
] as const;
export const LEGAL_HOLD_LABELS: Record<(typeof LEGAL_HOLD_CATEGORIES)[number], string> = {
  all: "Todos los datos",
  time: "Registro de jornada",
  absences: "Ausencias",
  expenses: "Gastos",
  notifications: "Avisos y correos",
};

export const legalHoldSchema = z.object({
  category: z.enum(LEGAL_HOLD_CATEGORIES, { message: "Elige qué datos se retienen" }),
  employee_id: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.uuid({ message: "Selección no válida" }).nullable()),
  reason: z
    .string()
    .trim()
    .min(10, "Explica el motivo (mínimo 10 caracteres)")
    .max(500, "Máximo 500 caracteres"),
});

export const supportGrantSchema = z.object({
  support_user_id: z.uuid({ message: "Indica la persona de soporte" }),
  hours: z.coerce.number().int().min(1, "De 1 a 24 horas").max(24, "De 1 a 24 horas"),
  reason: z
    .string()
    .trim()
    .min(10, "Explica el motivo (mínimo 10 caracteres)")
    .max(500, "Máximo 500 caracteres"),
});

export const holdIdSchema = z.object({ hold_id: z.uuid({ message: "Retención no válida" }) });
export const grantIdSchema = z.object({ grant_id: z.uuid({ message: "Acceso no válido" }) });
