import { z } from "zod";

import { addDays, isIsoDate } from "@/lib/dates";

import type { FilterKey, ReportDef } from "./catalog";

/**
 * Filtros de los informes. Viven en la URL para poder compartir y recargar la
 * vista, así que solo admiten fechas, identificadores y códigos de negocio
 * (nunca nombres, correos ni texto buscado sobre personas). Se validan en el
 * servidor con este esquema y la base de datos vuelve a comprobar periodo y
 * paginación.
 */

export const EXPENSE_GROUPS = [
  "employee",
  "category",
  "project",
  "client",
  "cost_center",
  "month",
] as const;
export type ExpenseGroup = (typeof EXPENSE_GROUPS)[number];

export const EXPENSE_GROUP_LABELS: Record<ExpenseGroup, string> = {
  employee: "Persona",
  category: "Categoría",
  project: "Proyecto",
  client: "Cliente",
  cost_center: "Centro de coste",
  month: "Mes",
};

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "deactivate",
  "reactivate",
  "terminate",
  "publish",
  "status_change",
  "export",
  "import",
  "request_export",
  "download",
] as const;

export type ReportFilters = {
  from: string;
  to: string;
  day: string;
  employee: string | null;
  team: string | null;
  center: string | null;
  client: string | null;
  project: string | null;
  group: ExpenseGroup;
  actor: string | null;
  entity: string | null;
  action: (typeof AUDIT_ACTIONS)[number] | null;
  object: string | null;
  page: number;
};

/** Nombre del parámetro en la URL (en español) para cada filtro. */
export const URL_PARAMS = {
  from: "desde",
  to: "hasta",
  day: "dia",
  employee: "persona",
  team: "equipo",
  center: "centro",
  client: "cliente",
  project: "proyecto",
  group: "agrupar",
  actor: "actor",
  entity: "objeto",
  action: "accion",
  object: "id",
  page: "pagina",
} as const satisfies Record<keyof ReportFilters, string>;

const date = z.string().refine(isIsoDate, "Fecha no válida");
const uuid = z.uuid({ message: "Selección no válida" });
const code = z
  .string()
  .trim()
  .max(60, "Máximo 60 caracteres")
  .regex(/^[\p{L}\p{N} ._&,'()/-]*$/u, "Contiene caracteres no permitidos");

const raw = z.object({
  from: date.optional(),
  to: date.optional(),
  day: date.optional(),
  employee: uuid.optional(),
  team: uuid.optional(),
  center: uuid.optional(),
  client: code.optional(),
  project: code.optional(),
  group: z.enum(EXPENSE_GROUPS).optional(),
  actor: uuid.optional(),
  entity: z
    .string()
    .regex(/^[a-z_]{2,60}$/, "Objeto no válido")
    .optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  object: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/, "Identificador no válido")
    .optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
});

export type ParsedFilters = { filters: ReportFilters; errors: string[] };

type Search = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s === undefined || s.trim() === "" ? undefined : s.trim();
}

/** Lee y valida los filtros de la URL; lo que no es válido vuelve al valor por defecto. */
export function parseFilters(def: ReportDef, search: Search, today: string): ParsedFilters {
  const input: Record<string, string | undefined> = {};
  for (const [key, param] of Object.entries(URL_PARAMS)) input[key] = first(search[param]);
  const errors: string[] = [];
  const parsed: Partial<z.infer<typeof raw>> = {};
  // Campo a campo: un filtro inválido no anula los demás.
  for (const [key, schema] of Object.entries(raw.shape)) {
    const value = input[key];
    if (value === undefined) continue;
    const r = (schema as z.ZodType).safeParse(value);
    if (r.success) (parsed as Record<string, unknown>)[key] = r.data;
    else errors.push(`Filtro «${key}» no válido: se ha ignorado.`);
  }
  const allowed = new Set<FilterKey>(def.filters);
  const has = (k: FilterKey) => allowed.has(k);

  const defaultFrom = `${today.slice(0, 7)}-01`;
  let from = has("period") ? (parsed.from ?? defaultFrom) : defaultFrom;
  let to = has("period") ? (parsed.to ?? today) : today;
  if (to < from) {
    errors.push("La fecha final es anterior a la inicial: se ha usado el mes en curso.");
    from = defaultFrom;
    to = today;
  }
  if (def.maxDays > 0 && daysBetween(from, to) > def.maxDays) {
    errors.push(`El periodo máximo de este informe es de ${def.maxDays} días: se ha acortado.`);
    from = addDays(to, -def.maxDays);
  }

  return {
    errors,
    filters: {
      from,
      to,
      day: has("day") ? (parsed.day ?? today) : today,
      employee: has("employee") ? (parsed.employee ?? null) : null,
      team: has("team") ? (parsed.team ?? null) : null,
      center: has("center") ? (parsed.center ?? null) : null,
      client: has("client") && parsed.client ? parsed.client : null,
      project: has("project") && parsed.project ? parsed.project : null,
      group: has("group") ? (parsed.group ?? "employee") : "employee",
      actor: has("actor") ? (parsed.actor ?? null) : null,
      entity: has("entity") ? (parsed.entity ?? null) : null,
      action: has("action") ? (parsed.action ?? null) : null,
      object: has("object") ? (parsed.object ?? null) : null,
      page: def.paginated ? (parsed.page ?? 1) : 1,
    },
  };
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Filtros -> parámetros de URL (solo los que aplican al informe y no son el valor por defecto). */
export function filtersToSearch(
  def: ReportDef,
  f: ReportFilters,
  overrides: Partial<ReportFilters> = {},
): string {
  const v = { ...f, ...overrides };
  const params = new URLSearchParams();
  const allowed = new Set<FilterKey>(def.filters);
  const set = (k: keyof ReportFilters, value: string | number | null) => {
    if (value !== null && value !== "") params.set(URL_PARAMS[k], String(value));
  };
  if (allowed.has("period")) {
    set("from", v.from);
    set("to", v.to);
  }
  if (allowed.has("day")) set("day", v.day);
  if (allowed.has("employee")) set("employee", v.employee);
  if (allowed.has("team")) set("team", v.team);
  if (allowed.has("center")) set("center", v.center);
  if (allowed.has("client")) set("client", v.client);
  if (allowed.has("project")) set("project", v.project);
  if (allowed.has("group")) set("group", v.group);
  if (allowed.has("actor")) set("actor", v.actor);
  if (allowed.has("entity")) set("entity", v.entity);
  if (allowed.has("action")) set("action", v.action);
  if (allowed.has("object")) set("object", v.object);
  if (v.page > 1) set("page", v.page);
  return params.toString();
}

/**
 * Filtros que se guardan con una exportación: los mismos valores validados
 * (fechas, identificadores y códigos), sin la página.
 */
export function exportFilters(def: ReportDef, f: ReportFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, value] of new URLSearchParams(filtersToSearch(def, { ...f, page: 1 })).entries())
    out[k] = value;
  return out;
}

/** Lee los filtros guardados con una exportación (mismo esquema que la URL). */
export function filtersFromExport(def: ReportDef, stored: unknown, today: string): ReportFilters {
  const search: Search = {};
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [k, v] of Object.entries(stored)) if (typeof v === "string") search[k] = v;
  }
  return parseFilters(def, search, today).filters;
}
