import type { UserContext } from "@/lib/auth/permissions";
import { administersCompany, canAccessSection, rolesInCompany } from "@/lib/auth/permissions";

/**
 * Catálogo de informes: qué columnas tiene cada uno, qué filtros admite y su
 * periodo máximo. El diccionario completo (cálculos y fuentes) está en
 * docs/INFORMES.md. La base de datos decide qué filas ve cada persona; esta
 * visibilidad solo evita mostrar informes que siempre saldrían vacíos.
 */

export const REPORT_KEYS = [
  "time_daily",
  "time_summary",
  "time_register",
  "absence_balances",
  "absence_requests",
  "expenses",
  "approvals",
  "closures",
  "audit",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export type FilterKey =
  | "period"
  | "day"
  | "employee"
  | "team"
  | "center"
  | "client"
  | "project"
  | "group"
  | "actor"
  | "entity"
  | "action"
  | "object";

/** text: texto · int: entero · duration: segundos (h:mm) · money: céntimos · date/datetime. */
export type ColumnKind = "text" | "int" | "duration" | "money" | "date" | "datetime";

export type Column = {
  key: string;
  /** Cabecera en pantalla y PDF. */
  label: string;
  /** Cabecera estable en CSV y XLSX (minúsculas, sin acentos). */
  csv: string;
  kind: ColumnKind;
  /** Columna con la moneda de los importes (kind money). */
  currencyKey?: string;
};

export type ReportDef = {
  key: ReportKey;
  /** Segmento de la URL (/informes/<slug>). */
  slug: string;
  title: string;
  description: string;
  filters: FilterKey[];
  /** Periodo máximo en días (lo vuelve a comprobar la base de datos). */
  maxDays: number;
  /** Informes sin paginación: devuelven pocas filas agregadas. */
  paginated: boolean;
  columns: Column[];
};

const PEOPLE: FilterKey[] = ["period", "employee", "team", "center"];

export const REPORTS: Record<ReportKey, ReportDef> = {
  time_daily: {
    key: "time_daily",
    slug: "jornada-diaria",
    title: "Jornada diaria",
    description:
      "Cada jornada con su inicio, fin, trabajo, pausas y la diferencia con la presencia planificada en el turno.",
    filters: PEOPLE,
    maxDays: 92,
    paginated: true,
    columns: [
      { key: "work_date", label: "Día", csv: "dia", kind: "date" },
      { key: "employee_code", label: "Código", csv: "codigo_empleado", kind: "text" },
      { key: "employee_name", label: "Persona", csv: "empleado", kind: "text" },
      { key: "status", label: "Estado", csv: "estado", kind: "text" },
      { key: "started_at", label: "Inicio", csv: "inicio", kind: "datetime" },
      { key: "ended_at", label: "Fin", csv: "fin", kind: "datetime" },
      { key: "worked_seconds", label: "Trabajo", csv: "trabajo", kind: "duration" },
      { key: "break_seconds", label: "Pausas", csv: "pausas", kind: "duration" },
      { key: "planned_status", label: "Plan", csv: "plan", kind: "text" },
      {
        key: "planned_seconds",
        label: "Presencia planificada",
        csv: "presencia_planificada",
        kind: "duration",
      },
      { key: "difference_seconds", label: "Diferencia", csv: "diferencia", kind: "duration" },
      { key: "adjustments", label: "Ajustes", csv: "ajustes", kind: "int" },
      {
        key: "open_incidents",
        label: "Incidencias abiertas",
        csv: "incidencias_abiertas",
        kind: "int",
      },
    ],
  },
  time_summary: {
    key: "time_summary",
    slug: "horas-y-descansos",
    title: "Horas y descansos",
    description:
      "Suma por persona de las jornadas del periodo: días, trabajo, pausas, incompletas y ajustes.",
    filters: PEOPLE,
    maxDays: 92,
    paginated: true,
    columns: [
      { key: "employee_code", label: "Código", csv: "codigo_empleado", kind: "text" },
      { key: "employee_name", label: "Persona", csv: "empleado", kind: "text" },
      { key: "days", label: "Jornadas", csv: "jornadas", kind: "int" },
      { key: "worked_seconds", label: "Trabajo", csv: "trabajo", kind: "duration" },
      { key: "break_seconds", label: "Pausas", csv: "pausas", kind: "duration" },
      { key: "incomplete_days", label: "Incompletas", csv: "incompletas", kind: "int" },
      { key: "adjustments", label: "Ajustes", csv: "ajustes", kind: "int" },
    ],
  },
  time_register: {
    key: "time_register",
    slug: "registro-horario",
    title: "Registro horario",
    description:
      "Registro diario de jornada para consulta e inspección: fichajes con su hora oficial y origen, y ajustes aprobados con quién los pidió y decidió.",
    filters: PEOPLE,
    maxDays: 92,
    paginated: true,
    columns: [
      { key: "work_date", label: "Día", csv: "dia", kind: "date" },
      { key: "employee_code", label: "Código", csv: "codigo_empleado", kind: "text" },
      { key: "employee_name", label: "Persona", csv: "empleado", kind: "text" },
      { key: "time_zone", label: "Zona horaria", csv: "zona_horaria", kind: "text" },
      { key: "started_at", label: "Inicio", csv: "inicio", kind: "datetime" },
      { key: "ended_at", label: "Fin", csv: "fin", kind: "datetime" },
      { key: "punches", label: "Fichajes", csv: "fichajes", kind: "text" },
      { key: "worked_seconds", label: "Trabajo", csv: "trabajo", kind: "duration" },
      { key: "break_seconds", label: "Pausas", csv: "pausas", kind: "duration" },
      { key: "adjustments", label: "Ajustes", csv: "ajustes", kind: "text" },
      { key: "status", label: "Estado", csv: "estado", kind: "text" },
    ],
  },
  absence_balances: {
    key: "absence_balances",
    slug: "saldos",
    title: "Saldos de vacaciones",
    description:
      "Saldo de cada persona en el periodo de devengo que contiene el día elegido, calculado desde el libro de movimientos.",
    filters: ["day", "employee", "team", "center"],
    maxDays: 0,
    paginated: true,
    columns: [
      { key: "employee_code", label: "Código", csv: "codigo_empleado", kind: "text" },
      { key: "employee_name", label: "Persona", csv: "empleado", kind: "text" },
      { key: "policy_name", label: "Política", csv: "politica", kind: "text" },
      { key: "period", label: "Periodo", csv: "periodo", kind: "text" },
      { key: "unit", label: "Unidad", csv: "unidad", kind: "text" },
      { key: "entitled", label: "Derecho", csv: "derecho", kind: "text" },
      { key: "carried", label: "Arrastre", csv: "arrastre", kind: "text" },
      { key: "used", label: "Disfrutado", csv: "disfrutado", kind: "text" },
      { key: "reserved", label: "Reservado", csv: "reservado", kind: "text" },
      { key: "adjusted", label: "Ajustes", csv: "ajustes", kind: "text" },
      { key: "expired", label: "Caducado", csv: "caducado", kind: "text" },
      { key: "available", label: "Disponible", csv: "disponible", kind: "text" },
    ],
  },
  absence_requests: {
    key: "absence_requests",
    slug: "solicitudes",
    title: "Solicitudes de ausencia",
    description:
      "Solicitudes que se solapan con el periodo y su estado. Los tipos reservados se muestran como «Ausencia (reservada)».",
    filters: PEOPLE,
    maxDays: 92,
    paginated: true,
    columns: [
      { key: "employee_code", label: "Código", csv: "codigo_empleado", kind: "text" },
      { key: "employee_name", label: "Persona", csv: "empleado", kind: "text" },
      { key: "type_label", label: "Tipo", csv: "tipo", kind: "text" },
      { key: "start_date", label: "Desde", csv: "desde", kind: "date" },
      { key: "end_date", label: "Hasta", csv: "hasta", kind: "date" },
      { key: "amount", label: "Cantidad", csv: "cantidad", kind: "text" },
      { key: "status", label: "Estado", csv: "estado", kind: "text" },
      { key: "submitted_at", label: "Solicitada", csv: "solicitada", kind: "datetime" },
      { key: "decided_at", label: "Decidida", csv: "decidida", kind: "datetime" },
    ],
  },
  expenses: {
    key: "expenses",
    slug: "gastos",
    title: "Gastos",
    description:
      "Gastos confirmados agrupados por persona, categoría, proyecto, cliente, centro de coste o mes, separados por moneda.",
    filters: ["period", "group", "employee", "team", "center", "client", "project"],
    maxDays: 366,
    paginated: true,
    columns: [
      { key: "group_label", label: "Grupo", csv: "grupo", kind: "text" },
      { key: "currency", label: "Moneda", csv: "moneda", kind: "text" },
      { key: "expenses", label: "Gastos", csv: "gastos", kind: "int" },
      { key: "base_cents", label: "Base", csv: "base", kind: "money", currencyKey: "currency" },
      {
        key: "tax_cents",
        label: "Impuestos",
        csv: "impuestos",
        kind: "money",
        currencyKey: "currency",
      },
      { key: "total_cents", label: "Total", csv: "total", kind: "money", currencyKey: "currency" },
    ],
  },
  approvals: {
    key: "approvals",
    slug: "aprobaciones",
    title: "Aprobaciones",
    description:
      "Solicitudes enviadas en el periodo: pendientes, vencidas, decididas y tiempo medio hasta la decisión.",
    filters: ["period"],
    maxDays: 366,
    paginated: false,
    columns: [
      { key: "kind", label: "Tipo", csv: "tipo", kind: "text" },
      { key: "pending", label: "Pendientes", csv: "pendientes", kind: "int" },
      { key: "overdue", label: "Vencidas", csv: "vencidas", kind: "int" },
      { key: "decided", label: "Decididas", csv: "decididas", kind: "int" },
      { key: "avg_hours", label: "Horas hasta decidir (media)", csv: "horas_media", kind: "text" },
    ],
  },
  closures: {
    key: "closures",
    slug: "cierres",
    title: "Cierres contables",
    description: "Lotes contables de los meses del periodo con sus líneas y total por moneda.",
    filters: ["period"],
    maxDays: 366,
    paginated: false,
    columns: [
      { key: "sequence", label: "Lote", csv: "lote", kind: "text" },
      { key: "kind", label: "Tipo", csv: "tipo_lote", kind: "text" },
      { key: "period_month", label: "Mes", csv: "periodo", kind: "text" },
      { key: "status", label: "Estado", csv: "estado", kind: "text" },
      { key: "closed_at", label: "Cerrado", csv: "cerrado", kind: "datetime" },
      { key: "currency", label: "Moneda", csv: "moneda", kind: "text" },
      { key: "lines", label: "Líneas", csv: "lineas", kind: "int" },
      { key: "total_cents", label: "Total", csv: "total", kind: "money", currencyKey: "currency" },
    ],
  },
  audit: {
    key: "audit",
    slug: "auditoria",
    title: "Auditoría",
    description:
      "Cambios relevantes registrados: quién, cuándo, qué objeto y qué campos (sin datos personales).",
    filters: ["period", "actor", "entity", "action", "object"],
    maxDays: 366,
    paginated: true,
    columns: [
      { key: "occurred_at", label: "Fecha", csv: "fecha", kind: "datetime" },
      { key: "actor", label: "Actor", csv: "actor", kind: "text" },
      { key: "action", label: "Acción", csv: "accion", kind: "text" },
      { key: "entity", label: "Objeto", csv: "objeto", kind: "text" },
      { key: "entity_id", label: "Identificador", csv: "id_objeto", kind: "text" },
      { key: "changes", label: "Cambios", csv: "cambios", kind: "text" },
      { key: "request_id", label: "Petición", csv: "request_id", kind: "text" },
    ],
  },
};

export function reportBySlug(slug: string): ReportDef | null {
  return Object.values(REPORTS).find((r) => r.slug === slug && r.key !== "audit") ?? null;
}

/** ¿Tiene sentido mostrar el informe a esta persona en su empresa activa? */
export function reportVisible(ctx: UserContext, key: ReportKey): boolean {
  const roles = rolesInCompany(ctx, ctx.activeCompanyId);
  const admin = administersCompany(ctx, ctx.activeCompanyId);
  const supervises = ctx.supervisedCount > 0;
  const any = (allowed: string[]) => roles.some((r) => allowed.includes(r));
  switch (key) {
    case "time_daily":
    case "time_summary":
    case "time_register":
    case "absence_balances":
    case "absence_requests":
      return admin || supervises || any(["employee", "manager", "hr", "company_admin", "auditor"]);
    case "expenses":
      return admin || supervises || any(["employee", "manager", "company_admin", "accounting"]);
    case "approvals":
      return admin || supervises || roles.length > 0;
    case "closures":
      return admin || any(["company_admin", "accounting"]);
    case "audit":
      return canAccessSection(ctx, "auditoria");
  }
}

export function visibleReports(ctx: UserContext): ReportDef[] {
  return REPORT_KEYS.filter((k) => k !== "audit" && reportVisible(ctx, k)).map((k) => REPORTS[k]);
}
