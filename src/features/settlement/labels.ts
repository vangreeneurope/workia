import { monthLabel } from "@/features/schedules/calendar";

export type ReportStatus =
  "submitted" | "in_review" | "returned" | "approved" | "included_in_batch" | "accounted";

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  submitted: "Enviado",
  in_review: "En revisión",
  returned: "Devuelto",
  approved: "Aprobado",
  included_in_batch: "En lote contable",
  accounted: "Contabilizado",
};

export const REPORT_STATUS_BADGE: Record<ReportStatus, string> = {
  submitted: "scheduled",
  in_review: "scheduled",
  returned: "suspended",
  approved: "active",
  included_in_batch: "published",
  accounted: "published",
};

export const LINE_DECISION_LABELS: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  returned: "Devuelta para corregir",
};

export const ROUTING_LABELS: Record<string, string> = {
  manager: "Manager",
  substitute: "Suplente del manager",
  admin_no_approver: "Administración (sin manager asignado)",
  admin_self_approval: "Administración (la persona sería su propia aprobadora)",
  rule_role: "Paso adicional por regla",
  rule_user: "Paso adicional por regla",
};

export const STEP_STATUS_LABELS: Record<string, string> = {
  waiting: "En espera",
  pending: "Pendiente",
  approved: "Aprobado",
  returned: "Devuelto",
  skipped: "No necesario",
};

/** "2026-09-01" -> "septiembre de 2026" */
export function periodLabel(periodMonth: string): string {
  return monthLabel(periodMonth);
}

/** Suma por moneda (nunca mezcla monedas). */
export function sumByCurrency<T extends { currency: string; total_cents: number }>(
  rows: T[],
): [string, number][] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.currency, (map.get(r.currency) ?? 0) + r.total_cents);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}
