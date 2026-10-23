import { z } from "zod";

import { isIsoDate } from "@/lib/dates";
import { optionalText, requiredText, requiredUuid } from "@/lib/forms";

import { parseClockToMinute } from "./time";
import { parseAmount } from "./units";

/**
 * Esquemas de ausencias compartidos por formularios y Server Actions. La base
 * de datos vuelve a validar contrato, política, saldo, solapes y festivos.
 */

const isoDate = (label: string) =>
  z.string({ message: `${label} es obligatoria` }).refine(isIsoDate, `${label} no es válida`);
const optionalIsoDate = (label: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isIsoDate(v), `${label} no es válida`);
const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");
const optionalUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.uuid({ message: "Selección no válida" }).nullable());

export const ABSENCE_UNITS = ["day", "half_day", "hour"] as const;

export const requestSchema = z
  .object({
    type_id: requiredUuid("un tipo de ausencia"),
    unit: z.enum(ABSENCE_UNITS, { message: "Elige cómo la pides" }),
    start_date: isoDate("La fecha de inicio"),
    end_date: optionalIsoDate("La fecha de fin"),
    half: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.enum(["morning", "afternoon"]).nullable()),
    start_time: z
      .string()
      .optional()
      .transform((v) => (v ? parseClockToMinute(v) : null)),
    end_time: z
      .string()
      .optional()
      .transform((v) => (v ? parseClockToMinute(v) : null)),
    note: optionalText(500),
    idempotency_key: z.uuid(),
  })
  .superRefine((v, ctx) => {
    if (v.unit === "day" && v.end_date !== null && v.end_date < v.start_date) {
      ctx.addIssue({ code: "custom", message: "El fin es anterior al inicio", path: ["end_date"] });
    }
    if (v.unit === "half_day" && !v.half) {
      ctx.addIssue({ code: "custom", message: "Elige mañana o tarde", path: ["half"] });
    }
    if (v.unit === "hour") {
      if (v.start_time === null)
        ctx.addIssue({ code: "custom", message: "Hora no válida", path: ["start_time"] });
      if (v.end_time === null)
        ctx.addIssue({ code: "custom", message: "Hora no válida", path: ["end_time"] });
      if (v.start_time !== null && v.end_time !== null && v.end_time <= v.start_time) {
        ctx.addIssue({
          code: "custom",
          message: "El fin debe ser posterior al inicio",
          path: ["end_time"],
        });
      }
    }
  })
  .transform((v) => ({
    ...v,
    end_date: v.unit === "day" ? (v.end_date ?? v.start_date) : v.start_date,
  }));

export const decisionSchema = z
  .object({
    request_id: requiredUuid("una solicitud"),
    decision: z.enum(["approve", "reject", "request_info"], { message: "Elige una decisión" }),
    message: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.decision !== "approve" && (v.message?.length ?? 0) < 5) {
      ctx.addIssue({
        code: "custom",
        message:
          v.decision === "reject"
            ? "Indica el motivo del rechazo"
            : "Indica qué información necesitas",
        path: ["message"],
      });
    }
  });

export const infoResponseSchema = z.object({
  request_id: requiredUuid("una solicitud"),
  message: requiredText(2, 500, "La respuesta"),
});

export const typeSchema = z
  .object({
    code: z
      .string({ message: "El código es obligatorio" })
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{1,20}$/, "Código: letras, números, guion o guion bajo (máx. 20)"),
    name: requiredText(2, 80, "El nombre"),
    unit_day: checkbox,
    unit_half_day: checkbox,
    unit_hour: checkbox,
    count_basis: z.enum(["working_days", "calendar_days"]),
    uses_balance: checkbox,
    requires_approval: checkbox,
    approval_exemption_ref: optionalText(300),
    requires_attachment: checkbox,
    attachment_sensitive: checkbox,
    is_private: checkbox,
    max_past_days: z.coerce.number().int().min(0, "Mínimo 0").max(90, "Máximo 90"),
    legal_reference: optionalText(300),
  })
  .superRefine((v, ctx) => {
    if (!v.unit_day && !v.unit_half_day && !v.unit_hour) {
      ctx.addIssue({ code: "custom", message: "Elige al menos una unidad", path: ["unit_day"] });
    }
    if (!v.requires_approval && (v.approval_exemption_ref?.length ?? 0) < 5) {
      ctx.addIssue({
        code: "custom",
        message: "Indica la regla aprobada que exime de aprobación (acuerdo, convenio…)",
        path: ["approval_exemption_ref"],
      });
    }
  });

export const policySchema = z.object({
  absence_type_id: requiredUuid("un tipo de ausencia"),
  code: z
    .string({ message: "El código es obligatorio" })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{1,20}$/, "Código no válido"),
  name: requiredText(2, 120, "El nombre"),
  period_start_month: z.coerce.number().int().min(1).max(12),
});

export const versionSchema = z
  .object({
    policy_id: requiredUuid("una política"),
    unit: z.enum(["half_days", "minutes"]),
    entitlement: z.string({ message: "Indica el derecho" }),
    accrual_method: z.enum(["upfront", "monthly"]),
    proration: z.enum(["none", "by_employment"]),
    rounding_mode: z.enum(["down", "up", "nearest"]),
    rounding_step: z.string().optional(),
    carryover_max: z.string().optional(),
    carryover_expiry_months: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : null))
      .pipe(z.number().int().min(1).max(24).nullable()),
    allow_negative: checkbox,
    negative_limit: z.string().optional(),
    negative_reason: optionalText(300),
  })
  .transform((v, ctx) => {
    const amount = (raw: string | undefined, path: string, fallback: number) => {
      if (!raw) return fallback;
      const parsed = parseAmount(raw, v.unit);
      if (parsed === null || parsed < 0) {
        ctx.addIssue({
          code: "custom",
          message:
            v.unit === "half_days"
              ? "Días con como mucho medio día (22 o 22,5)"
              : "Horas en formato HH:MM",
          path: [path],
        });
        return z.NEVER;
      }
      return parsed;
    };
    const entitlement = amount(v.entitlement, "entitlement", -1);
    if (entitlement < 0) {
      ctx.addIssue({
        code: "custom",
        message: "Indica el derecho por periodo",
        path: ["entitlement"],
      });
      return z.NEVER;
    }
    const negativeLimit = v.allow_negative ? amount(v.negative_limit, "negative_limit", 0) : 0;
    if (v.allow_negative && (negativeLimit <= 0 || (v.negative_reason?.length ?? 0) < 10)) {
      ctx.addIssue({
        code: "custom",
        message: "Un saldo negativo exige un límite y la justificación de quien lo autoriza",
        path: ["negative_reason"],
      });
      return z.NEVER;
    }
    return {
      policy_id: v.policy_id,
      unit: v.unit,
      entitlement,
      accrual_method: v.accrual_method,
      proration: v.proration,
      rounding_mode: v.rounding_mode,
      rounding_step: Math.max(1, amount(v.rounding_step, "rounding_step", 1)),
      carryover_max: amount(v.carryover_max, "carryover_max", 0),
      carryover_expiry_months: v.carryover_expiry_months,
      allow_negative: v.allow_negative,
      negative_limit: negativeLimit,
      negative_reason: v.allow_negative ? v.negative_reason : null,
    };
  });

export const publishSchema = z.object({
  version_id: requiredUuid("una versión"),
  valid_from: isoDate("La fecha de efecto"),
});

export const assignmentSchema = z
  .object({
    policy_id: requiredUuid("una política"),
    scope_type: z.enum(["company", "work_center", "team", "employee"]),
    employee_id: optionalUuid,
    team_id: optionalUuid,
    work_center_id: optionalUuid,
    valid_from: isoDate("La fecha de inicio"),
    last_day: optionalIsoDate("La fecha de fin"),
  })
  .superRefine((v, ctx) => {
    if (v.scope_type === "employee" && !v.employee_id) {
      ctx.addIssue({ code: "custom", message: "Elige una persona", path: ["employee_id"] });
    }
    if (v.scope_type === "team" && !v.team_id) {
      ctx.addIssue({ code: "custom", message: "Elige un equipo", path: ["team_id"] });
    }
    if (v.scope_type === "work_center" && !v.work_center_id) {
      ctx.addIssue({ code: "custom", message: "Elige un centro", path: ["work_center_id"] });
    }
    if (v.last_day !== null && v.last_day < v.valid_from) {
      ctx.addIssue({ code: "custom", message: "El fin es anterior al inicio", path: ["last_day"] });
    }
  });

export const adjustmentSchema = z.object({
  employee_id: requiredUuid("una persona"),
  policy_id: requiredUuid("una política"),
  amount: z.string({ message: "Indica la cantidad" }).min(1, "Indica la cantidad"),
  reason: requiredText(5, 300, "El motivo"),
});
