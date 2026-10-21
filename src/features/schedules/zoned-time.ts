/**
 * Conversión entre hora local de una zona IANA e instantes UTC, sin librerías
 * y sin coma flotante (minutos y milisegundos enteros).
 *
 * Reglas en los cambios de hora (docs/HORARIOS.md, sección 4):
 *  - Hora inexistente (salto de primavera, p. ej. 02:30 en Madrid el último
 *    domingo de marzo): se interpreta con el desfase anterior al cambio, lo que
 *    equivale a desplazarla hacia delante (02:30 -> 03:30 CEST).
 *  - Hora repetida (otoño, p. ej. 02:30 el último domingo de octubre): se toma
 *    la primera vez que ocurre (la del horario de verano).
 */

export const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" });
    offsetFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** ¿Conoce el entorno esta zona horaria IANA? */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    offsetFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Desfase de la zona respecto a UTC (minutos) en un instante. */
export function offsetMinutesAt(timeZone: string, epochMs: number): number {
  const value = offsetFormatter(timeZone)
    .formatToParts(new Date(epochMs))
    .find((p) => p.type === "timeZoneName")?.value;
  // "GMT" a secas significa desfase cero.
  const match = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(value ?? "");
  if (!match) throw new Error(`Zona horaria no válida: ${timeZone}`);
  if (!match[1]) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** Milisegundos de la medianoche "ingenua" (como si fuera UTC) de una fecha. */
function naiveMidnightMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export type WallTimeResolution = {
  /** Instante UTC en milisegundos. */
  epochMs: number;
  /** "gap": la hora no existe ese día; "overlap": existe dos veces. */
  adjustment: "none" | "gap" | "overlap";
};

/**
 * Instante real de la hora local `minute` (minutos desde la medianoche local de
 * `date`; puede pasar de 1440 para el día siguiente) en `timeZone`.
 */
export function zonedWallTimeToUtc(
  timeZone: string,
  date: string,
  minute: number,
): WallTimeResolution {
  if (!Number.isInteger(minute)) throw new Error("Los minutos deben ser enteros");
  const local = naiveMidnightMs(date) + minute * MS_PER_MINUTE;
  // Desfases posibles alrededor de esa hora local (como mucho un cambio en ±12 h).
  const before = offsetMinutesAt(timeZone, local - 12 * MS_PER_HOUR);
  const after = offsetMinutesAt(timeZone, local + 12 * MS_PER_HOUR);
  const candidates = [...new Set([before, after])]
    .map((offset) => local - offset * MS_PER_MINUTE)
    .filter((instant) => local - offsetMinutesAt(timeZone, instant) * MS_PER_MINUTE === instant)
    .sort((a, b) => a - b);

  if (candidates.length === 0) {
    return { epochMs: local - before * MS_PER_MINUTE, adjustment: "gap" };
  }
  return {
    epochMs: candidates[0] as number,
    adjustment: candidates.length > 1 ? "overlap" : "none",
  };
}

/** Fecha local (AAAA-MM-DD) y minuto del día de un instante en la zona. */
export function utcToZonedWallTime(
  timeZone: string,
  epochMs: number,
): { date: string; minute: number } {
  const local = epochMs + offsetMinutesAt(timeZone, epochMs) * MS_PER_MINUTE;
  const date = new Date(local).toISOString().slice(0, 10);
  return { date, minute: Math.floor((local - naiveMidnightMs(date)) / MS_PER_MINUTE) };
}

/** "Hoy" en una zona horaria. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return utcToZonedWallTime(timeZone, now.getTime()).date;
}

/** 510 -> "08:30"; 1500 -> "01:00 (+1)". */
export function formatMinute(minute: number): string {
  const day = Math.floor(minute / MINUTES_PER_DAY);
  const inDay = minute - day * MINUTES_PER_DAY;
  const hh = String(Math.floor(inDay / 60)).padStart(2, "0");
  const mm = String(inDay % 60).padStart(2, "0");
  return day > 0 ? `${hh}:${mm} (+${day})` : `${hh}:${mm}`;
}

/** "08:30" -> 510; null si no es una hora válida. */
export function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 450 -> "7 h 30 min". */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m} min`;
  return m === 0 ? `${sign}${h} h` : `${sign}${h} h ${m} min`;
}
