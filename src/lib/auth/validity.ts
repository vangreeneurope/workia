/**
 * Vigencia temporal [valid_from, valid_to) de membresías, roles y asignaciones.
 * La base de datos aplica la misma regla en private.is_active_window(); aquí
 * solo se usa para decidir qué muestra la interfaz.
 */

export type Validity = {
  status: string;
  valid_from: string;
  valid_to: string | null;
};

/** ¿Está activo y dentro de su vigencia en el instante `now`? */
export function isCurrent(row: Validity, now: Date): boolean {
  const from = Date.parse(row.valid_from);
  const to = row.valid_to === null ? Number.POSITIVE_INFINITY : Date.parse(row.valid_to);
  const t = now.getTime();
  return row.status === "active" && from <= t && t < to;
}
