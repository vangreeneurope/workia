import { z } from "zod";

import { parseCsv } from "@/lib/csv";
import { isIsoDate } from "@/lib/dates";

import { CONTRACT_TYPES, WORKING_TIMES } from "../schemas";

/**
 * Importación de personas desde CSV: mapeo de columnas, normalización y
 * validación fila a fila. Funciones puras: la Server Action las usa antes de
 * escribir nada y la base de datos vuelve a validar en una única transacción.
 */

export const MAX_IMPORT_ROWS = 1000;
// Por debajo del límite por defecto de 1 MB del cuerpo de una Server Action.
export const MAX_IMPORT_BYTES = 900_000;

export const IMPORT_FIELDS = [
  { key: "employee_code", label: "Código de empleado", required: true },
  { key: "first_name", label: "Nombre", required: true },
  { key: "last_name", label: "Apellidos", required: true },
  { key: "work_email", label: "Correo corporativo", required: false },
  { key: "work_center_code", label: "Código de centro", required: false },
  { key: "team_name", label: "Equipo", required: false },
  { key: "contract_type", label: "Tipo de contrato", required: false },
  { key: "working_time", label: "Jornada", required: false },
  { key: "weekly_hours", label: "Horas semanales", required: false },
  { key: "job_title", label: "Puesto", required: false },
  { key: "valid_from", label: "Fecha de inicio", required: false },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];
/** Campo -> índice de columna del CSV (o null si no se importa). */
export type ColumnMapping = Partial<Record<ImportField, number | null>>;

const ALIASES: Record<ImportField, string[]> = {
  employee_code: [
    "codigo",
    "codigo empleado",
    "codigo de empleado",
    "n empleado",
    "employee_code",
    "id",
  ],
  first_name: ["nombre", "first_name", "name"],
  last_name: ["apellidos", "apellido", "last_name", "surname"],
  work_email: ["correo", "email", "correo corporativo", "work_email", "e-mail"],
  work_center_code: [
    "centro",
    "codigo centro",
    "codigo de centro",
    "work_center",
    "work_center_code",
  ],
  team_name: ["equipo", "team", "team_name"],
  contract_type: ["contrato", "tipo contrato", "tipo de contrato", "contract_type"],
  working_time: ["jornada", "tipo jornada", "working_time"],
  weekly_hours: ["horas", "horas semanales", "weekly_hours"],
  job_title: ["puesto", "cargo", "job_title"],
  valid_from: ["fecha inicio", "fecha de inicio", "alta", "fecha alta", "valid_from"],
};

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[º°ª#.]/g, "")
    .replace(/[_\s]+/g, " ")
    .trim();
}

/** Propone un mapeo a partir de las cabeceras (el usuario lo confirma o cambia). */
export function suggestMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const index = normalized.findIndex((h) =>
      ALIASES[field.key].some((alias) => normalizeHeader(alias) === h),
    );
    mapping[field.key] = index >= 0 ? index : null;
  }
  return mapping;
}

export function mappingProblems(mapping: ColumnMapping, columnCount: number): string[] {
  const problems: string[] = [];
  for (const field of IMPORT_FIELDS) {
    const index = mapping[field.key];
    if (field.required && (index === null || index === undefined)) {
      problems.push(`Asigna una columna a «${field.label}».`);
    }
    if (index !== null && index !== undefined && (index < 0 || index >= columnCount)) {
      problems.push(`La columna elegida para «${field.label}» no existe.`);
    }
  }
  const used = Object.values(mapping).filter((i): i is number => typeof i === "number");
  if (new Set(used).size !== used.length)
    problems.push("Una misma columna está asignada a dos campos.");
  return problems;
}

const CONTRACT_ALIASES: Record<string, (typeof CONTRACT_TYPES)[number]> = {
  indefinido: "permanent",
  temporal: "temporary",
  "fijo discontinuo": "seasonal_permanent",
  practicas: "internship",
  formacion: "training",
  otro: "other",
};

function normalizeContract(value: string): string {
  const key = normalizeHeader(value);
  return CONTRACT_ALIASES[key] ?? key.replace(/ /g, "_");
}

function normalizeWorkingTime(value: string): string {
  const key = normalizeHeader(value);
  if (key === "completa" || key === "tiempo completo") return "full_time";
  if (key === "parcial" || key === "tiempo parcial") return "part_time";
  return key.replace(/ /g, "_");
}

/** Acepta AAAA-MM-DD o DD/MM/AAAA. */
function normalizeDate(value: string): string {
  const es = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (es) return `${es[3]}-${es[2]!.padStart(2, "0")}-${es[1]!.padStart(2, "0")}`;
  return value;
}

const rowSchema = z
  .object({
    employee_code: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/, "código de empleado no válido"),
    first_name: z.string().min(1, "falta el nombre").max(80, "nombre demasiado largo"),
    last_name: z.string().min(1, "faltan los apellidos").max(120, "apellidos demasiado largos"),
    work_email: z.email("correo no válido").nullable(),
    work_center_code: z.string().max(20).nullable(),
    team_name: z.string().max(120).nullable(),
    contract_type: z.enum(CONTRACT_TYPES, "tipo de contrato no reconocido").nullable(),
    working_time: z.enum(WORKING_TIMES, "jornada no reconocida (completa o parcial)").nullable(),
    weekly_hours: z
      .number("horas semanales no válidas")
      .gt(0, "horas semanales no válidas")
      .max(40, "más de 40 h semanales")
      .nullable(),
    job_title: z.string().max(120, "puesto demasiado largo").nullable(),
    valid_from: z
      .string()
      .refine(isIsoDate, "fecha de inicio no válida (AAAA-MM-DD o DD/MM/AAAA)")
      .nullable(),
  })
  .refine((r) => !r.contract_type || (r.weekly_hours !== null && r.valid_from !== null), {
    message: "con tipo de contrato son obligatorias las horas semanales y la fecha de inicio",
  })
  .refine((r) => r.contract_type || (!r.weekly_hours && !r.valid_from && !r.working_time), {
    message: "las condiciones (jornada, horas, fecha) requieren tipo de contrato",
  });

export type ImportRow = z.infer<typeof rowSchema>;

export type RowResult = {
  /** Número de línea en el archivo (la cabecera es la 1). */
  line: number;
  code: string;
  errors: string[];
  row?: ImportRow;
};

export type ImportReference = {
  workCenterCodes: Set<string>;
  teamNames: Set<string>;
  /** Códigos de empleado que ya existen en la empresa (los visibles para quien importa). */
  existingCodes: Set<string>;
};

export type ImportValidation = {
  results: RowResult[];
  validRows: ImportRow[];
  errorCount: number;
  problems: string[];
};

function cell(row: string[], index: number | null | undefined): string | null {
  if (index === null || index === undefined) return null;
  const value = (row[index] ?? "").trim();
  return value === "" ? null : value;
}

export function validateImport(
  csvText: string,
  mapping: ColumnMapping,
  reference: ImportReference,
): ImportValidation {
  if (csvText.length > MAX_IMPORT_BYTES) {
    return {
      results: [],
      validRows: [],
      errorCount: 0,
      problems: ["El archivo supera 900 KB. Divídelo en varios."],
    };
  }
  let parsed;
  try {
    parsed = parseCsv(csvText);
  } catch (error) {
    return {
      results: [],
      validRows: [],
      errorCount: 0,
      problems: [error instanceof Error ? error.message : "No se pudo leer el archivo."],
    };
  }
  const problems = mappingProblems(mapping, parsed.headers.length);
  if (parsed.rows.length === 0) problems.push("El archivo no tiene filas de datos.");
  if (parsed.rows.length > MAX_IMPORT_ROWS)
    problems.push(`Máximo ${MAX_IMPORT_ROWS} filas por importación.`);
  if (problems.length > 0) return { results: [], validRows: [], errorCount: 0, problems };

  const seenCodes = new Map<string, number>();
  const seenEmails = new Map<string, number>();
  const results: RowResult[] = parsed.rows.map((raw, i) => {
    const line = i + 2;
    const hours = cell(raw, mapping.weekly_hours);
    const contract = cell(raw, mapping.contract_type);
    const working = cell(raw, mapping.working_time);
    const date = cell(raw, mapping.valid_from);
    const candidate = {
      employee_code: cell(raw, mapping.employee_code) ?? "",
      first_name: cell(raw, mapping.first_name) ?? "",
      last_name: cell(raw, mapping.last_name) ?? "",
      work_email: cell(raw, mapping.work_email)?.toLowerCase() ?? null,
      work_center_code: cell(raw, mapping.work_center_code)?.toUpperCase() ?? null,
      team_name: cell(raw, mapping.team_name),
      contract_type: contract ? normalizeContract(contract) : null,
      working_time: working ? normalizeWorkingTime(working) : null,
      weekly_hours: hours ? Number(hours.replace(",", ".")) : null,
      job_title: cell(raw, mapping.job_title),
      valid_from: date ? normalizeDate(date) : null,
    };

    const parsedRow = rowSchema.safeParse(candidate);
    const errors = parsedRow.success ? [] : parsedRow.error.issues.map((issue) => issue.message);
    const code = candidate.employee_code;

    if (code) {
      const previous = seenCodes.get(code.toLowerCase());
      if (previous) errors.push(`código repetido en la línea ${previous}`);
      else seenCodes.set(code.toLowerCase(), line);
      if (reference.existingCodes.has(code)) errors.push("ya existe una persona con este código");
    }
    if (candidate.work_email) {
      const previous = seenEmails.get(candidate.work_email);
      if (previous) errors.push(`correo repetido en la línea ${previous}`);
      else seenEmails.set(candidate.work_email, line);
    }
    if (candidate.work_center_code && !reference.workCenterCodes.has(candidate.work_center_code)) {
      errors.push(`el centro ${candidate.work_center_code} no existe`);
    }
    if (candidate.team_name && !reference.teamNames.has(candidate.team_name)) {
      errors.push(`el equipo «${candidate.team_name}» no existe`);
    }

    return errors.length === 0 && parsedRow.success
      ? { line, code, errors, row: parsedRow.data }
      : { line, code, errors };
  });

  const validRows = results.flatMap((r) => (r.row ? [r.row] : []));
  return { results, validRows, errorCount: results.length - validRows.length, problems: [] };
}

/** Filas en el formato que espera public.import_employees. */
export function toImportPayload(rows: ImportRow[]) {
  return rows.map((r) => ({
    employee_code: r.employee_code,
    first_name: r.first_name,
    last_name: r.last_name,
    work_email: r.work_email ?? "",
    work_center_code: r.work_center_code ?? "",
    team_name: r.team_name ?? "",
    contract_type: r.contract_type ?? "",
    working_time: r.working_time ?? "",
    weekly_hours: r.weekly_hours === null ? "" : String(r.weekly_hours),
    job_title: r.job_title ?? "",
    valid_from: r.valid_from ?? "",
  }));
}
