/** Formato de instantes en la zona horaria de la persona (no la del navegador). */

const timeFormatters = new Map<string, Intl.DateTimeFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatClock(iso: string, timeZone: string): string {
  let f = timeFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("es-ES", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    timeFormatters.set(timeZone, f);
  }
  return f.format(new Date(iso));
}

export function formatDayTime(iso: string, timeZone: string): string {
  let f = dateFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("es-ES", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    dateFormatters.set(timeZone, f);
  }
  return f.format(new Date(iso));
}

/** 27000 -> "7 h 30 min" (segundos enteros, sin decimales). */
export function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Valor para <input type="datetime-local"> en la zona de la persona. */
export function toLocalInput(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export const INCIDENT_LABELS: Record<string, string> = {
  start_out_of_tolerance: "Entrada fuera de tolerancia",
  end_out_of_tolerance: "Salida fuera de tolerancia",
  unplanned_work: "Fichaje fuera de horario",
  missing_end: "Salida no registrada",
  open_entry: "Jornada abierta demasiado tiempo",
  overlap: "Jornadas solapadas",
  location_unavailable: "Ubicación no disponible",
  device_time_mismatch: "Hora del dispositivo distinta (posible envío sin conexión)",
};

export const CORRECTION_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
};

/** Detalle de una incidencia sin datos personales. */
export function describeIncidentDetail(kind: string, detail: unknown): string {
  const d =
    detail && typeof detail === "object" && !Array.isArray(detail)
      ? (detail as Record<string, unknown>)
      : {};
  const minutes = typeof d.minutes === "number" ? d.minutes : null;
  if (minutes !== null && kind.endsWith("tolerance")) {
    return minutes > 0
      ? `${minutes} min tarde respecto al horario`
      : `${-minutes} min antes del horario`;
  }
  if (minutes !== null && kind === "device_time_mismatch")
    return `Diferencia de ${Math.abs(minutes)} min`;
  if (kind === "unplanned_work" && typeof d.planned === "string") {
    const planned: Record<string, string> = {
      rest: "día de descanso",
      holiday: "festivo",
      absence: "ausencia aprobada",
      no_contract: "sin condiciones de empleo vigentes",
    };
    return `Planificado: ${planned[d.planned] ?? d.planned}`;
  }
  if (kind === "location_unavailable" && typeof d.location_status === "string") {
    const status: Record<string, string> = {
      denied: "permiso denegado",
      unavailable: "no disponible",
      timeout: "sin respuesta a tiempo",
      not_requested: "no solicitada",
    };
    return `Ubicación: ${status[d.location_status] ?? d.location_status}`;
  }
  return "";
}
