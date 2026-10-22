import {
  formatAmount,
  STATUS_LABELS,
  type BalanceUnit,
  type RequestStatus,
} from "@/features/absences/units";
import { centsToEs } from "@/features/settlement/export/money";
import { BUSINESS_TIME_ZONE } from "@/lib/dates";

import type { Column, ReportKey } from "./catalog";

/**
 * Filas de informe ya preparadas para pantalla y exportación. Las cifras llegan
 * calculadas por la base de datos; aquí solo se traducen etiquetas y se dan
 * formato a horas y fechas (sin sumar ni agregar nada).
 */

export type Cell = string | number | null;
export type ReportRow = Record<string, Cell> & { __tz?: string };

const TIME_STATUS: Record<string, string> = {
  open: "Abierta",
  on_break: "En pausa",
  closed: "Cerrada",
  incomplete: "Incompleta",
};
const PLAN_STATUS: Record<string, string> = {
  work: "Turno",
  rest: "Descanso",
  holiday: "Festivo",
  absence: "Ausencia",
  unassigned: "Sin turno",
  no_contract: "Sin contrato",
};
const PUNCH_KIND: Record<string, string> = {
  start: "entrada",
  break_start: "inicio de pausa",
  break_end: "fin de pausa",
  end: "salida",
};
const PUNCH_SOURCE: Record<string, string> = { mobile: "móvil", web: "web", kiosk: "terminal" };
const CORRECTION: Record<string, string> = { add: "añadir", change: "cambiar", void: "anular" };
const APPROVAL_KIND: Record<string, string> = {
  absences: "Ausencias",
  expense_reports: "Informes de gastos",
  time_corrections: "Correcciones de fichaje",
};
const BATCH_STATUS: Record<string, string> = { closed: "Cerrado", accounted: "Contabilizado" };

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: "Alta",
  update: "Cambio",
  deactivate: "Baja",
  reactivate: "Reactivación",
  terminate: "Fin de vigencia",
  publish: "Publicación",
  status_change: "Cambio de estado",
  export: "Exportación",
  import: "Importación",
  request_export: "Solicitud de exportación",
  download: "Descarga",
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  companies: "Empresa",
  group_admins: "Administración de grupo",
  work_centers: "Centro",
  teams: "Equipo",
  company_memberships: "Membresía",
  role_assignments: "Rol",
  employees: "Persona",
  employment_terms: "Condiciones",
  manager_assignments: "Responsable",
  approver_substitutions: "Suplencia",
  shift_templates: "Plantilla de turno",
  shift_template_versions: "Versión de plantilla",
  shift_assignments: "Asignación de turno",
  holiday_calendars: "Calendario",
  absence_requests: "Solicitud de ausencia",
  expense_reports: "Informe de gastos",
  accounting_batches: "Lote contable",
  time_adjustments: "Ajuste de fichaje",
  time_correction_requests: "Solicitud de corrección",
  report_exports: "Exportación de informe",
};

const clockFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(cache: Map<string, Intl.DateTimeFormat>, tz: string, withDate: boolean) {
  const key = tz;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("es-ES", {
      timeZone: tz,
      ...(withDate ? { day: "2-digit", month: "2-digit", year: "numeric" } : {}),
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    cache.set(key, f);
  }
  return f;
}

export function formatClockIn(iso: string, tz: string): string {
  return formatter(clockFormatters, tz, false).format(new Date(iso));
}

export function formatDateTimeIn(iso: string, tz: string): string {
  return formatter(dateTimeFormatters, tz, true).format(new Date(iso));
}

/** Segundos enteros -> "7:30" (horas:minutos, nunca horas decimales). Negativos con signo. */
export function formatDuration(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const minutes = Math.floor(Math.abs(seconds) / 60);
  return `${sign}${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "2026-11-05" -> "05/11/2026". */
export function formatIsoDate(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const shortId = (id: unknown) => (typeof id === "string" ? id.slice(0, 8) : "—");

type Punch = { kind?: string; at?: string; source?: string };
type Adjustment = {
  action?: string;
  kind?: string | null;
  effective_at?: string | null;
  approved_at?: string;
  requested_by?: string | null;
  decided_by?: string | null;
};

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function punchesText(value: unknown, tz: string): string {
  return asArray(value)
    .map((p) => {
      const x = p as Punch;
      if (!x.at) return "";
      return `${formatClockIn(x.at, tz)} ${PUNCH_KIND[x.kind ?? ""] ?? x.kind} (${PUNCH_SOURCE[x.source ?? ""] ?? x.source})`;
    })
    .filter(Boolean)
    .join(" · ");
}

function adjustmentsText(value: unknown, tz: string): string {
  return asArray(value)
    .map((a) => {
      const x = a as Adjustment;
      const what = `${CORRECTION[x.action ?? ""] ?? x.action}${x.kind ? ` ${PUNCH_KIND[x.kind] ?? x.kind}` : ""}`;
      const at = x.effective_at ? ` a las ${formatClockIn(x.effective_at, tz)}` : "";
      const when = x.approved_at ? ` · aprobado ${formatDateTimeIn(x.approved_at, tz)}` : "";
      return `${what}${at}${when} · pide ${shortId(x.requested_by)} · decide ${shortId(x.decided_by)}`;
    })
    .join(" | ");
}

function changesText(fields: unknown, before: unknown, after: unknown): string {
  const b = before && typeof before === "object" ? (before as Record<string, unknown>) : {};
  const a = after && typeof after === "object" ? (after as Record<string, unknown>) : {};
  return asArray(fields)
    .map((f) => {
      const k = String(f);
      const show = (v: unknown) =>
        v === undefined || v === null ? "—" : typeof v === "string" ? v : JSON.stringify(v);
      return k in b ? `${k}: ${show(b[k])} → ${show(a[k])}` : `${k}: ${show(a[k])}`;
    })
    .join("; ");
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** Fila de la base de datos -> fila del informe. */
export function mapRow(key: ReportKey, r: Raw): ReportRow {
  switch (key) {
    case "time_daily":
      return {
        work_date: str(r.work_date),
        employee_code: str(r.employee_code),
        employee_name: str(r.employee_name),
        status: TIME_STATUS[String(r.status)] ?? str(r.status),
        started_at: str(r.started_at),
        ended_at: str(r.ended_at),
        worked_seconds: num(r.worked_seconds),
        break_seconds: num(r.break_seconds),
        planned_status: PLAN_STATUS[String(r.planned_status)] ?? null,
        planned_seconds: num(r.planned_seconds),
        difference_seconds: num(r.difference_seconds),
        adjustments: num(r.adjustments),
        open_incidents: num(r.open_incidents),
      };
    case "time_summary":
      return {
        employee_code: str(r.employee_code),
        employee_name: str(r.employee_name),
        days: num(r.days),
        worked_seconds: num(r.worked_seconds),
        break_seconds: num(r.break_seconds),
        incomplete_days: num(r.incomplete_days),
        adjustments: num(r.adjustments),
      };
    case "time_register": {
      const tz = str(r.time_zone) ?? BUSINESS_TIME_ZONE;
      return {
        __tz: tz,
        work_date: str(r.work_date),
        employee_code: str(r.employee_code),
        employee_name: str(r.employee_name),
        time_zone: tz,
        started_at: str(r.started_at),
        ended_at: str(r.ended_at),
        punches: punchesText(r.punches, tz),
        worked_seconds: num(r.worked_seconds),
        break_seconds: num(r.break_seconds),
        adjustments: adjustmentsText(r.adjustments, tz) || null,
        status: TIME_STATUS[String(r.status)] ?? str(r.status),
      };
    }
    case "absence_balances": {
      const unit = (str(r.unit) ?? "half_days") as BalanceUnit;
      const amount = (v: unknown) => (typeof v === "number" ? formatAmount(v, unit) : null);
      return {
        employee_code: str(r.employee_code),
        employee_name: str(r.employee_name),
        policy_name: str(r.policy_name),
        period: `${formatIsoDate(String(r.period_start))} – ${formatIsoDate(String(r.period_end))}`,
        unit: unit === "minutes" ? "Horas" : "Días",
        entitled: amount(r.entitled),
        carried: amount(r.carried),
        used: amount(r.used),
        reserved: amount(r.reserved),
        adjusted: amount(r.adjusted),
        expired: amount(r.expired),
        available: amount(r.available),
      };
    }
    case "absence_requests":
      return {
        employee_code: str(r.employee_code),
        employee_name: str(r.employee_name),
        type_label: str(r.type_label),
        start_date: str(r.start_date),
        end_date: str(r.end_date),
        amount:
          typeof r.amount === "number"
            ? formatAmount(r.amount, (str(r.amount_unit) ?? "half_days") as BalanceUnit)
            : null,
        status: STATUS_LABELS[String(r.status) as RequestStatus] ?? str(r.status),
        submitted_at: str(r.submitted_at),
        decided_at: str(r.decided_at),
      };
    case "expenses":
      return {
        group_label: str(r.group_label),
        currency: str(r.currency),
        expenses: num(r.expenses),
        base_cents: num(r.base_cents),
        tax_cents: num(r.tax_cents),
        total_cents: num(r.total_cents),
      };
    case "approvals":
      return {
        kind: APPROVAL_KIND[String(r.kind)] ?? str(r.kind),
        pending: num(r.pending),
        overdue: num(r.overdue),
        decided: num(r.decided),
        // Media redondeada a una décima por la base de datos (numeric): se muestra como texto.
        avg_hours:
          r.avg_hours === null || r.avg_hours === undefined
            ? null
            : String(r.avg_hours).replace(".", ","),
      };
    case "closures":
      return {
        sequence: typeof r.sequence === "number" ? String(r.sequence).padStart(4, "0") : null,
        kind: r.kind === "corrective" ? "Corrector" : "Ordinario",
        period_month: str(r.period_month)?.slice(0, 7) ?? null,
        status: BATCH_STATUS[String(r.status)] ?? str(r.status),
        closed_at: str(r.closed_at),
        currency: str(r.currency),
        lines: num(r.lines),
        total_cents: num(r.total_cents),
      };
    case "audit":
      return {
        occurred_at: str(r.occurred_at),
        actor: str(r.actor_id),
        action: AUDIT_ACTION_LABELS[String(r.action)] ?? str(r.action),
        entity: AUDIT_ENTITY_LABELS[String(r.entity)] ?? str(r.entity),
        entity_id: str(r.entity_id),
        changes: changesText(r.changed_fields, r.before, r.after) || null,
        request_id: str(r.request_id),
      };
  }
}

/** Texto de una celda para pantalla y PDF. */
export function displayCell(column: Column, row: ReportRow): string {
  const v = row[column.key];
  if (v === null || v === undefined || v === "") return "—";
  const tz = row.__tz ?? BUSINESS_TIME_ZONE;
  switch (column.kind) {
    case "duration":
      return typeof v === "number" ? formatDuration(v) : String(v);
    case "date":
      return formatIsoDate(String(v));
    case "datetime":
      return formatDateTimeIn(String(v), tz);
    case "money":
      return typeof v === "number" ? centsToEs(v) : String(v);
    case "int":
    case "text":
      return String(v);
  }
}
