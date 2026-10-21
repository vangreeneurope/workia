/**
 * Utilidades puras para las vistas de calendario (semanas de lunes a domingo).
 */

import { addDays, isIsoDate } from "@/lib/dates";

export type CalendarView = "mes" | "semana";

/** Día de la semana ISO: 1 = lunes … 7 = domingo. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(date: string, months: number): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 10);
}

/** Rango visible de la vista: semana completa o semanas completas que cubren el mes. */
export function viewRange(view: CalendarView, date: string): { from: string; to: string } {
  if (view === "semana") {
    const from = mondayOf(date);
    return { from, to: addDays(from, 6) };
  }
  const first = firstOfMonth(date);
  const last = addDays(addMonths(first, 1), -1);
  return { from: mondayOf(first), to: addDays(mondayOf(last), 6) };
}

/** Fecha de referencia anterior y siguiente para la navegación. */
export function navigation(view: CalendarView, date: string): { prev: string; next: string } {
  if (view === "semana")
    return { prev: addDays(mondayOf(date), -7), next: addDays(mondayOf(date), 7) };
  return { prev: addMonths(firstOfMonth(date), -1), next: addMonths(firstOfMonth(date), 1) };
}

/** Lee la fecha de la URL; si no es válida, usa la de hoy. */
export function parseViewDate(value: string | undefined, today: string): string {
  return value && isIsoDate(value) ? value : today;
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
export const WEEKDAYS_SHORT = ["L", "M", "X", "J", "V", "S", "D"];
const WEEKDAYS_LONG = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

export function monthLabel(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1]} de ${y}`;
}

/** "2026-10-26" -> "lunes 26 de octubre". */
export function longDayLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${WEEKDAYS_LONG[isoWeekday(date) - 1]} ${d} de ${MONTHS[m - 1]}`;
}

export function weekLabel(date: string): string {
  const from = mondayOf(date);
  const to = addDays(from, 6);
  const [, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  return fm === tm
    ? `${fd}–${td} de ${MONTHS[tm - 1]} de ${ty}`
    : `${fd} de ${MONTHS[fm - 1]} – ${td} de ${MONTHS[tm - 1]} de ${ty}`;
}
