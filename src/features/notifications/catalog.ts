/**
 * Catálogo de avisos. Debe coincidir con private.notification_event_types() y
 * private.notification_event_mandatory() (migración 20261029100000_avisos).
 * Obligatorios: operativos o legales; no admiten desactivar el correo.
 */
export const NOTIFICATION_EVENTS = {
  absence_submitted: { label: "Solicitudes de ausencia que debes aprobar", mandatory: true },
  absence_decided: { label: "Decisiones sobre tus solicitudes de ausencia", mandatory: false },
  absence_info_requested: { label: "Te piden información sobre una solicitud", mandatory: true },
  absence_info_provided: { label: "Respuestas a información que pediste", mandatory: false },
  absence_cancelled: { label: "Solicitudes canceladas o retiradas", mandatory: false },
  expense_step_pending: { label: "Informes de gastos que debes aprobar", mandatory: true },
  expense_report_returned: { label: "Informes de gastos devueltos", mandatory: true },
  expense_report_approved: { label: "Informes de gastos aprobados", mandatory: false },
  expense_report_settled: { label: "Informes de gastos liquidados", mandatory: false },
  time_missing_start: { label: "Recordatorio de entrada sin fichar", mandatory: true },
  time_open_entry: { label: "Recordatorio de jornada abierta", mandatory: true },
  time_incident: { label: "Incidencias en tus fichajes", mandatory: false },
  time_correction_decided: { label: "Decisiones sobre correcciones de fichaje", mandatory: false },
  shift_changed: { label: "Cambios en tu horario", mandatory: true },
  approval_overdue: { label: "Aprobaciones pendientes desde hace días", mandatory: true },
} as const;

export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;

export function isNotificationEvent(value: string): value is NotificationEvent {
  return Object.hasOwn(NOTIFICATION_EVENTS, value);
}
