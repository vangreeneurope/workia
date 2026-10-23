export type ExpenseStatus = "draft" | "ready" | "discarded";

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  draft: "Borrador",
  ready: "Listo",
  discarded: "Descartado",
};

/** Equivalencia con las variantes de StatusBadge. */
export const EXPENSE_STATUS_BADGE: Record<ExpenseStatus, string> = {
  draft: "scheduled",
  ready: "active",
  discarded: "inactive",
};

export const EXPENSE_EVENT_LABELS: Record<string, string> = {
  created: "Creado",
  ocr_finished: "Lectura automática",
  ocr_requeued: "Lectura solicitada de nuevo",
  confirmed: "Confirmado",
  reopened: "Reabierto para corregir",
  discarded: "Descartado",
  restored: "Recuperado",
};

export const OCR_DETAIL_LABELS: Record<string, string> = {
  succeeded: "datos propuestos",
  needs_review: "datos para revisar",
  failed: "fallida",
};

export const SOURCE_LABELS: Record<string, string> = {
  receipt: "Ticket",
  manual: "Sin ticket",
  mileage: "Kilometraje",
};
