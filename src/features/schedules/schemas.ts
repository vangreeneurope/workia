import { z } from "zod";

import { isIsoDate } from "@/lib/dates";
import { optionalText, optionalUuid, requiredText, requiredUuid } from "@/lib/forms";

/**
 * Esquemas de horarios compartidos por formularios (navegador) y Server
 * Actions. Las reglas de fondo (plantillas válidas, solapes, fechas no
 * pasadas) las vuelve a aplicar la base de datos.
 */

export const SHIFT_KINDS = ["continuous", "split", "night", "flexible"] as const;
export const ASSIGNMENT_SCOPES = ["exception", "employee", "team", "contract"] as const;
export type AssignmentScopeValue = (typeof ASSIGNMENT_SCOPES)[number];
export const ASSIGNMENT_SCOPE_LABELS: Record<AssignmentScopeValue, string> = {
  exception: "Excepción individual",
  employee: "Persona",
  team: "Equipo",
  contract: "Patrón del contrato",
};
export const CALENDAR_SCOPES = ["national", "regional", "local", "company"] as const;
export const CALENDAR_SCOPE_LABELS: Record<(typeof CALENDAR_SCOPES)[number], string> = {
  national: "Nacional",
  regional: "Autonómico",
  local: "Local",
  company: "Propio de la empresa",
};

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
const minutes = (label: string, max: number) =>
  z.coerce
    .number({ message: `${label} no es válido` })
    .int(`${label}: minutos enteros`)
    .min(0, `${label}: mínimo 0`)
    .max(max, `${label}: máximo ${max}`);

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

export const templateCreateSchema = z.object({
  code: z
    .string({ message: "El código es obligatorio" })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{1,20}$/, "Código: letras, números, guion o guion bajo (máx. 20)"),
  name: requiredText(2, 120, "El nombre"),
});

export const segmentSchema = z.object({
  start_minute: z.number().int().min(0).max(2879),
  end_minute: z.number().int().min(1).max(2880),
  kind: z.enum(["work", "break"]),
  paid: z.boolean(),
});

export const templateDraftSchema = z
  .object({
    template_id: requiredUuid("una plantilla"),
    kind: z.enum(SHIFT_KINDS, { message: "Elige el tipo de jornada" }),
    target_minutes: minutes("Horas objetivo", 1440),
    tolerance_early: minutes("Tolerancia de entrada", 240),
    tolerance_late: minutes("Tolerancia de salida", 240),
    flex_start: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : null))
      .pipe(z.number().int().min(0).max(2879).nullable()),
    flex_end: z
      .string()
      .optional()
      .transform((v) => (v ? Number(v) : null))
      .pipe(z.number().int().min(1).max(2880).nullable()),
    segments: z
      .string({ message: "Faltan los tramos" })
      .transform((value, ctx) => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          ctx.addIssue({ code: "custom", message: "Tramos no válidos" });
          return z.NEVER;
        }
      })
      .pipe(z.array(segmentSchema).max(20, "Máximo 20 tramos")),
  })
  .refine((v) => v.kind !== "flexible" || (v.flex_start !== null && v.flex_end !== null), {
    message: "Indica la ventana flexible",
    path: ["flex_start"],
  });

export const templatePublishSchema = z.object({
  version_id: requiredUuid("una versión"),
  valid_from: isoDate("La fecha de efecto"),
});

// ---------------------------------------------------------------------------
// Asignaciones
// ---------------------------------------------------------------------------

export const assignmentSchema = z
  .object({
    id: optionalUuid,
    scope_type: z.enum(ASSIGNMENT_SCOPES, { message: "Elige a quién se aplica" }),
    employee_id: optionalUuid,
    team_id: optionalUuid,
    employment_terms_id: optionalUuid,
    valid_from: isoDate("La fecha de inicio"),
    last_day: optionalIsoDate("La fecha de fin"),
    cycle_days: z.coerce
      .number({ message: "Indica la duración del ciclo" })
      .int()
      .min(1, "El ciclo dura al menos 1 día")
      .max(56, "El ciclo dura como mucho 56 días"),
    anchor_date: optionalIsoDate("La fecha de inicio del ciclo"),
    days: z
      .string({ message: "Faltan los días del ciclo" })
      .transform((value, ctx) => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          ctx.addIssue({ code: "custom", message: "Días del ciclo no válidos" });
          return z.NEVER;
        }
      })
      .pipe(z.array(z.uuid().nullable()).min(1).max(56)),
    note: optionalText(300),
  })
  .superRefine((v, ctx) => {
    if ((v.scope_type === "employee" || v.scope_type === "exception") && !v.employee_id) {
      ctx.addIssue({ code: "custom", message: "Selecciona una persona", path: ["employee_id"] });
    }
    if (v.scope_type === "team" && !v.team_id) {
      ctx.addIssue({ code: "custom", message: "Selecciona un equipo", path: ["team_id"] });
    }
    if (v.scope_type === "contract" && !v.employment_terms_id) {
      ctx.addIssue({
        code: "custom",
        message: "Selecciona las condiciones de empleo",
        path: ["employment_terms_id"],
      });
    }
    if (v.last_day !== null && v.last_day < v.valid_from) {
      ctx.addIssue({ code: "custom", message: "El fin es anterior al inicio", path: ["last_day"] });
    }
    if (v.scope_type === "exception" && v.last_day === null) {
      ctx.addIssue({
        code: "custom",
        message: "Una excepción necesita fecha de fin (máximo 31 días)",
        path: ["last_day"],
      });
    }
    if (v.days.length !== v.cycle_days) {
      ctx.addIssue({
        code: "custom",
        message: `Indica la plantilla o descanso de los ${v.cycle_days} días del ciclo`,
        path: ["days"],
      });
    }
  });

export const assignmentPublishSchema = z.object({
  id: requiredUuid("una asignación"),
  accept_warnings: checkbox,
});

export const assignmentCloseSchema = z.object({
  id: requiredUuid("una asignación"),
  last_day: isoDate("El último día"),
});

// ---------------------------------------------------------------------------
// Calendarios laborales
// ---------------------------------------------------------------------------

export const calendarSchema = z.object({
  name: requiredText(2, 120, "El nombre"),
  scope: z.enum(CALENDAR_SCOPES, { message: "Elige el ámbito" }),
  region_code: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => (v ? v : null))
    .refine(
      (v) => v === null || /^ES(-[A-Z]{1,3})?$/.test(v),
      "Código ISO no válido (p. ej. ES-MD)",
    ),
  locality: optionalText(120),
  applies_to_all_centers: checkbox,
  source_reference: requiredText(3, 300, "La fuente"),
});

export const holidaySchema = z.object({
  calendar_id: requiredUuid("un calendario"),
  holiday_date: isoDate("La fecha"),
  name: requiredText(2, 120, "El nombre"),
});

export const holidayImportSchema = z.object({
  calendar_id: requiredUuid("un calendario"),
  lines: z
    .string({ message: "Pega al menos un festivo" })
    .trim()
    .min(1, "Pega al menos un festivo"),
});

export const calendarLinkSchema = z.object({
  calendar_id: requiredUuid("un calendario"),
  work_center_id: requiredUuid("un centro"),
  valid_from: isoDate("La fecha de inicio"),
});

export const calendarLinkEndSchema = z.object({
  id: requiredUuid("una aplicación"),
  last_day: isoDate("El último día"),
});

export type ParsedHoliday = { line: number; date: string; name: string };

/**
 * Lee festivos pegados como "AAAA-MM-DD;Nombre" (o con coma o tabulador), uno
 * por línea. Devuelve todas las filas o todos los errores: nada se importa si
 * alguna línea falla. `today` es el primer día que admite la base de datos.
 */
export function parseHolidayLines(
  text: string,
  today: string,
): { rows: ParsedHoliday[]; errors: string[] } {
  const rows: ParsedHoliday[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    const match = /^\s*(\d{4}-\d{2}-\d{2})\s*[;,\t]\s*(.+?)\s*$/.exec(raw);
    if (!match) {
      errors.push(`Línea ${line}: usa el formato AAAA-MM-DD;Nombre`);
      return;
    }
    const [, date, name] = match as unknown as [string, string, string];
    if (!isIsoDate(date)) errors.push(`Línea ${line}: la fecha ${date} no existe`);
    else if (date < today) errors.push(`Línea ${line}: ${date} ya ha pasado`);
    else if (seen.has(date)) errors.push(`Línea ${line}: la fecha ${date} está repetida`);
    else if (name.length < 2 || name.length > 120)
      errors.push(`Línea ${line}: nombre de 2 a 120 caracteres`);
    else {
      seen.add(date);
      rows.push({ line, date, name });
    }
  });
  if (rows.length + errors.length > 366) errors.push("Como mucho 366 festivos por importación");
  return errors.length ? { rows: [], errors } : { rows, errors };
}
