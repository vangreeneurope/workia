/**
 * Fechas de calendario laboral (zona Europe/Madrid) y su conversión a
 * instantes UTC. Las fechas de efecto se expresan en días ("2026-11-01") y se
 * almacenan como el instante en que empieza ese día en Madrid.
 */

export const BUSINESS_TIME_ZONE = "Europe/Madrid";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Desfase de Madrid (minutos) en un instante dado. */
function offsetMinutes(at: Date): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    timeZoneName: "longOffset",
  })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(part ?? "");
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/** Instante UTC (ISO) en que empieza el día `date` en Madrid. */
export function startOfBusinessDay(date: string): string {
  if (!isIsoDate(date)) throw new Error(`Fecha no válida: ${date}`);
  const utcMidnight = new Date(`${date}T00:00:00Z`);
  // El desfase de medianoche local puede diferir del de medianoche UTC en días de cambio de hora.
  let instant = new Date(utcMidnight.getTime() - offsetMinutes(utcMidnight) * 60_000);
  instant = new Date(utcMidnight.getTime() - offsetMinutes(instant) * 60_000);
  return instant.toISOString();
}

/** Fecha de calendario de Madrid para un instante. */
export function businessDate(at: Date | string = new Date()): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Suma días a una fecha de calendario. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "2026-11-01" -> "01/11/2026"; instantes se muestran como fecha de Madrid. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const day = DATE_RE.test(value) ? value : businessDate(value);
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}
