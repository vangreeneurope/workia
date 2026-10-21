/** Situación laboral según la fecha de baja (último día incluido) y el día de hoy. */
export type Situation = "active" | "leaving" | "terminated";

export function employeeSituation(endDate: string | null, today: string): Situation {
  if (!endDate) return "active";
  return endDate >= today ? "leaving" : "terminated";
}

export const SITUATION_FILTERS = ["activas", "baja", "todas"] as const;
export type SituationFilter = (typeof SITUATION_FILTERS)[number];

/** Limpia el texto de búsqueda para usarlo en un filtro PostgREST (sin comodines ni sintaxis). */
export function sanitizeSearch(raw: string | undefined | null): string {
  return (raw ?? "")
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} @._-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
