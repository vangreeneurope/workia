import { z } from "zod";

import { isIsoDate } from "@/lib/dates";
import { optionalText, optionalUuid, requiredText, requiredUuid } from "@/lib/forms";

/**
 * Esquemas de validación compartidos: los usan los formularios en el navegador
 * (respuesta inmediata) y las Server Actions (validación autoritativa). Reciben
 * strings tal como llegan de un formulario.
 *
 * Datos opcionales por diseño: CIF, correo y teléfono personales no son
 * obligatorios (minimización de datos, ver docs/NORMATIVA.md).
 */

export const CONTRACT_TYPES = [
  "permanent",
  "temporary",
  "seasonal_permanent",
  "internship",
  "training",
  "other",
] as const;
export const CONTRACT_TYPE_LABELS: Record<(typeof CONTRACT_TYPES)[number], string> = {
  permanent: "Indefinido",
  temporary: "Temporal",
  seasonal_permanent: "Fijo discontinuo",
  internship: "Prácticas",
  training: "Formación",
  other: "Otro",
};

export const WORKING_TIMES = ["full_time", "part_time"] as const;
export const WORKING_TIME_LABELS: Record<(typeof WORKING_TIMES)[number], string> = {
  full_time: "Completa",
  part_time: "Parcial",
};

export const APPROVAL_TYPES = ["all", "absences", "expenses", "time_corrections"] as const;
export const APPROVAL_TYPE_LABELS: Record<(typeof APPROVAL_TYPES)[number], string> = {
  all: "Todas las solicitudes",
  absences: "Vacaciones y ausencias",
  expenses: "Gastos",
  time_corrections: "Correcciones de fichaje",
};

export const ROLE_OPTIONS = [
  "employee",
  "manager",
  "hr",
  "accounting",
  "auditor",
  "company_admin",
] as const;

export const TIME_ZONES = ["Europe/Madrid", "Atlantic/Canary"] as const;

const isoDate = (label: string) =>
  z.string({ message: `${label} es obligatoria` }).refine(isIsoDate, `${label} no es válida`);
const optionalIsoDate = (label: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isIsoDate(v), `${label} no es válida`);

const colorHex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color no válido (#RRGGBB)");

// Empresas -------------------------------------------------------------------

export const companySchema = z.object({
  name: requiredText(2, 120, "El nombre"),
  legal_name: optionalText(200),
  tax_id: z
    .string()
    .optional()
    .transform((v) => (v ? v.replace(/[\s.-]/g, "").toUpperCase() : null))
    .refine((v) => v === null || /^[A-Z0-9]{8,12}$/.test(v), "CIF no válido"),
  primary_color: colorHex,
  timezone: z.enum(TIME_ZONES, { message: "Zona horaria no válida" }),
});

export const companyCreateSchema = companySchema.extend({
  group_id: requiredUuid("un grupo"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Solo minúsculas, números y guiones"),
});

// Centros y equipos ----------------------------------------------------------

export const workCenterSchema = z.object({
  name: requiredText(2, 120, "El nombre"),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{1,20}$/, "Código: hasta 20 letras, números, guiones o guiones bajos"),
  address_line: optionalText(200),
  city: optionalText(100),
  postal_code: z
    .string()
    .optional()
    .transform((v) => (v ? v.trim() : null))
    .refine((v) => v === null || /^[A-Za-z0-9 -]{3,10}$/.test(v), "Código postal no válido"),
  province: optionalText(100),
  timezone: z.enum(TIME_ZONES, { message: "Zona horaria no válida" }),
});

export const teamSchema = z.object({
  name: requiredText(2, 120, "El nombre"),
  work_center_id: optionalUuid,
});

export const statusToggleSchema = z.object({
  id: z.uuid(),
  status: z.enum(["active", "inactive"]),
});

// Personas -------------------------------------------------------------------

export const employeeSchema = z.object({
  employee_code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{1,32}$/, "Código: hasta 32 letras, números, puntos o guiones"),
  first_name: requiredText(1, 80, "El nombre"),
  last_name: requiredText(1, 120, "Los apellidos"),
  work_email: z
    .string()
    .optional()
    .transform((v) => (v ? v.trim().toLowerCase() : null))
    .pipe(z.email({ message: "Correo no válido" }).nullable()),
  work_center_id: optionalUuid,
  team_id: optionalUuid,
});

export const termsChangeSchema = z.object({
  effective_date: isoDate("La fecha de efecto"),
  contract_type: z.enum(CONTRACT_TYPES, { message: "Elige un tipo de contrato" }),
  working_time: z.enum(WORKING_TIMES, { message: "Elige el tipo de jornada" }),
  weekly_hours: z.coerce
    .number({ message: "Indica las horas semanales" })
    .gt(0, "Debe ser mayor que 0")
    .max(40, "La jornada ordinaria no supera 40 h semanales"),
  job_title: optionalText(120),
});

export const terminationSchema = z.object({
  last_day: isoDate("El último día"),
  confirm: z.literal("on", { message: "Confirma que has revisado las consecuencias de la baja" }),
});

// Cuentas y roles ------------------------------------------------------------

export const memberInviteSchema = z.object({
  email: z.email({ message: "Correo no válido" }).trim().toLowerCase(),
  full_name: optionalText(160),
});

export const roleGrantSchema = z
  .object({
    membership_id: requiredUuid("una cuenta"),
    role: z.enum(ROLE_OPTIONS, { message: "Elige un rol" }),
    scope_type: z.enum(["company", "work_center", "team"]),
    work_center_id: optionalUuid,
    team_id: optionalUuid,
    valid_from: optionalIsoDate("La fecha de inicio"),
    valid_to: optionalIsoDate("La fecha de fin"),
  })
  .refine(
    (v) =>
      (v.scope_type === "company" && !v.work_center_id && !v.team_id) ||
      (v.scope_type === "work_center" && v.work_center_id && !v.team_id) ||
      (v.scope_type === "team" && v.team_id && !v.work_center_id),
    { message: "El ámbito no coincide con el centro o equipo elegido", path: ["scope_type"] },
  )
  .refine((v) => !v.valid_to || !v.valid_from || v.valid_to > v.valid_from, {
    message: "La fecha de fin debe ser posterior al inicio",
    path: ["valid_to"],
  });

export const membershipEndSchema = z.object({
  membership_id: requiredUuid("una cuenta"),
  end_date: isoDate("La fecha de fin"),
});

// Aprobadores y suplencias ---------------------------------------------------

export const assignmentSchema = z
  .object({
    scope_type: z.enum(["employee", "team"]),
    employee_id: optionalUuid,
    team_id: optionalUuid,
    request_type: z.enum(APPROVAL_TYPES, { message: "Elige el tipo de solicitud" }),
    manager_email: z.email({ message: "Correo del manager no válido" }).trim().toLowerCase(),
    valid_from: isoDate("La fecha de inicio"),
    valid_to: optionalIsoDate("La fecha de fin"),
  })
  .superRefine((v, ctx) => {
    // El error se señala en el selector que falta, no en el tipo de ámbito.
    if (v.scope_type === "employee" && (!v.employee_id || v.team_id)) {
      ctx.addIssue({ code: "custom", message: "Elige una persona", path: ["employee_id"] });
    }
    if (v.scope_type === "team" && (!v.team_id || v.employee_id)) {
      ctx.addIssue({ code: "custom", message: "Elige un equipo", path: ["team_id"] });
    }
  })
  .refine((v) => !v.valid_to || v.valid_to > v.valid_from, {
    message: "La fecha de fin debe ser posterior al inicio",
    path: ["valid_to"],
  });

export const assignmentEndSchema = z.object({
  id: z.uuid(),
  end_date: isoDate("La fecha de fin"),
});

export const substitutionSchema = z
  .object({
    absent_user_id: requiredUuid("a quién se sustituye"),
    substitute_email: z
      .email({ message: "Correo de la persona suplente no válido" })
      .trim()
      .toLowerCase(),
    request_type: z.enum(APPROVAL_TYPES),
    reason: requiredText(5, 500, "El motivo"),
    valid_from: isoDate("La fecha de inicio"),
    valid_to: isoDate("La fecha de fin"),
  })
  .refine((v) => v.valid_to > v.valid_from, {
    message: "La fecha de fin debe ser posterior al inicio",
    path: ["valid_to"],
  });

export const approverCheckSchema = z.object({
  employee_id: requiredUuid("una persona"),
  request_type: z.enum(APPROVAL_TYPES),
});
