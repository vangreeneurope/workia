/**
 * Unidades de ausencias. Las cantidades son enteros: medios días para las
 * políticas en días y minutos para las de horas (sin coma flotante).
 */

export type BalanceUnit = "half_days" | "minutes";
export type AbsenceUnit = "day" | "half_day" | "hour";
export type RequestStatus =
  "pending" | "info_requested" | "approved" | "rejected" | "cancelled" | "withdrawn";

export const UNIT_LABELS: Record<AbsenceUnit, string> = {
  day: "Días completos",
  half_day: "Medio día",
  hour: "Horas",
};

export const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "Pendiente",
  info_requested: "Información solicitada",
  approved: "Aprobada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
  withdrawn: "Retirada",
};

/** 9 medios días -> "4,5 días"; 90 minutos -> "1 h 30 min". */
export function formatAmount(amount: number, unit: BalanceUnit): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (unit === "half_days") {
    const days = Math.floor(abs / 2);
    const half = abs % 2 === 1;
    const text = half ? `${days},5` : `${days}`;
    return `${sign}${text} ${abs === 2 ? "día" : "días"}`;
  }
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m} min`;
  return m === 0 ? `${sign}${h} h` : `${sign}${h} h ${m} min`;
}

/** "22" o "22,5" días -> 44 o 45 medios días; null si no es válido. */
export function parseDaysToHalfDays(value: string): number | null {
  const match = /^\s*(-?)(\d{1,4})(?:[.,](0|5))?\s*$/.exec(value);
  if (!match) return null;
  const n = Number(match[2]) * 2 + (match[3] === "5" ? 1 : 0);
  return match[1] === "-" ? -n : n;
}

/** "10:30" horas -> 630 minutos; admite signo para ajustes. */
export function parseHoursToMinutes(value: string): number | null {
  const match = /^\s*(-?)(\d{1,4}):([0-5]\d)\s*$/.exec(value);
  if (!match) return null;
  const n = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -n : n;
}

export function parseAmount(value: string, unit: BalanceUnit): number | null {
  return unit === "half_days" ? parseDaysToHalfDays(value) : parseHoursToMinutes(value);
}
