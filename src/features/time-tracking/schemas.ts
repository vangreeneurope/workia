import { z } from "zod";

import { optionalText, requiredText, requiredUuid } from "@/lib/forms";

/**
 * Esquemas de control horario compartidos por formularios y Server Actions.
 * La base de datos vuelve a validar todo (estados, permisos, política).
 */

export const PUNCH_KIND_VALUES = ["start", "break_start", "break_end", "end"] as const;
export const LOCATION_STATUS_VALUES = [
  "not_requested",
  "granted",
  "denied",
  "unavailable",
  "timeout",
] as const;
export const LOCATION_MODES = ["off", "optional", "required"] as const;
export const LOCATION_MODE_LABELS: Record<(typeof LOCATION_MODES)[number], string> = {
  off: "No se registra",
  optional: "Opcional (se pide; si se deniega, se ficha igual)",
  required: "Exigida (si no se obtiene, se ficha y se crea una incidencia)",
};

const optionalNumber = (min: number, max: number) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Number(v)))
    .refine(
      (v) => v === null || (Number.isFinite(v) && v >= min && v <= max),
      "Valor fuera de rango",
    );

const isoInstant = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || !Number.isNaN(Date.parse(v)), "Hora no válida");

export const punchSchema = z
  .object({
    kind: z.enum(PUNCH_KIND_VALUES, { message: "Acción no válida" }),
    idempotency_key: z.uuid({ message: "Clave no válida" }),
    source: z.enum(["mobile", "web"]),
    device_at: isoInstant,
    device_id: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.uuid().nullable()),
    location_status: z.enum(LOCATION_STATUS_VALUES).default("not_requested"),
    latitude: optionalNumber(-90, 90),
    longitude: optionalNumber(-180, 180),
    accuracy: optionalNumber(0, 100000),
  })
  .refine((v) => v.location_status !== "granted" || (v.latitude !== null && v.longitude !== null), {
    message: "Ubicación incompleta",
    path: ["location_status"],
  });

export const KIOSK_TOKEN_RE = /^[0-9a-f]{64}$/;

export const kioskActivationSchema = z.object({
  token: z
    .string({ message: "Pega el código del terminal" })
    .trim()
    .toLowerCase()
    .regex(KIOSK_TOKEN_RE, "El código del terminal no es válido"),
});

export const kioskPunchSchema = z.object({
  kind: z.enum(PUNCH_KIND_VALUES, { message: "Elige una acción" }),
  employee_code: z
    .string({ message: "Escribe tu código" })
    .trim()
    .toUpperCase()
    .min(1, "Escribe tu código")
    .max(30, "Código no válido"),
  pin: z.string({ message: "Escribe tu PIN" }).regex(/^\d{6}$/, "El PIN tiene 6 cifras"),
  idempotency_key: z.uuid(),
  device_at: isoInstant,
});

export const pinSchema = z
  .object({
    pin: z.string({ message: "Escribe un PIN" }).regex(/^\d{6}$/, "El PIN tiene 6 cifras"),
    pin_confirm: z.string({ message: "Repite el PIN" }),
  })
  .refine((v) => v.pin === v.pin_confirm, {
    message: "Los PIN no coinciden",
    path: ["pin_confirm"],
  });

export const CORRECTION_ACTIONS = ["add", "change", "void"] as const;
export const CORRECTION_ACTION_LABELS: Record<(typeof CORRECTION_ACTIONS)[number], string> = {
  add: "Añadir un fichaje olvidado",
  change: "Cambiar la hora de un fichaje",
  void: "Anular un fichaje erróneo",
};

/** Fecha y hora local del formulario ("2026-10-21T08:00") + zona -> instante. */
export const correctionRequestSchema = z
  .object({
    employee_id: requiredUuid("una persona"),
    action: z.enum(CORRECTION_ACTIONS, { message: "Elige qué corregir" }),
    entry_id: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.uuid().nullable()),
    punch_id: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.uuid().nullable()),
    kind: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.enum(PUNCH_KIND_VALUES).nullable()),
    proposed_local: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .refine(
        (v) => v === null || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v),
        "Fecha y hora no válidas",
      ),
    reason: requiredText(5, 500, "El motivo"),
  })
  .superRefine((v, ctx) => {
    if (v.action !== "add" && !v.punch_id) {
      ctx.addIssue({ code: "custom", message: "Elige el fichaje", path: ["punch_id"] });
    }
    if (v.action === "add" && !v.kind) {
      ctx.addIssue({ code: "custom", message: "Elige el tipo de fichaje", path: ["kind"] });
    }
    if (v.action !== "void" && !v.proposed_local) {
      ctx.addIssue({
        code: "custom",
        message: "Indica la hora correcta",
        path: ["proposed_local"],
      });
    }
  });

export const decisionSchema = z.object({
  request_id: requiredUuid("una solicitud"),
  decision: z.enum(["approve", "reject"], { message: "Elige una decisión" }),
  note: optionalText(500),
});

export const incidentResolutionSchema = z.object({
  incident_id: requiredUuid("una incidencia"),
  status: z.enum(["resolved", "dismissed"], { message: "Elige cómo se cierra" }),
  note: requiredText(3, 500, "La nota"),
});

export const policySchema = z
  .object({
    work_center_id: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .pipe(z.uuid().nullable()),
    location_mode: z.enum(LOCATION_MODES, { message: "Elige el uso de la ubicación" }),
    location_notice: optionalText(1000),
    selfie_enabled: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
  })
  .refine((v) => v.location_mode === "off" || (v.location_notice?.length ?? 0) >= 20, {
    message: "Explica a la plantilla para qué se usa la ubicación (mínimo 20 caracteres)",
    path: ["location_notice"],
  });

export const kioskDeviceSchema = z.object({
  work_center_id: requiredUuid("un centro"),
  name: requiredText(2, 80, "El nombre"),
});
