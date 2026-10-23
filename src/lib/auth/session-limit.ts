/**
 * Duración máxima de la sesión (ADR-067). La sesión se cierra siempre a los N
 * minutos de ENTRAR (no de la última actividad), aunque se esté usando. N lo
 * fija cada empresa (companies.session_max_minutes, 15 a 720; 60 por defecto) y
 * a una persona con varias empresas se le aplica el más corto
 * (public.my_session_limit).
 *
 * El momento de entrada sale del JWT validado: `amr` guarda la hora de cada
 * método de autenticación de la sesión y no cambia al refrescar el token (a
 * diferencia de `iat`). Se toma el más antiguo: el segundo factor posterior no
 * alarga la sesión.
 */

export const DEFAULT_SESSION_MINUTES = 60;
export const MIN_SESSION_MINUTES = 15;
export const MAX_SESSION_MINUTES = 720;
/** Aviso previo al cierre. */
export const SESSION_WARNING_MS = 5 * 60 * 1000;

/** Destino cuando la sesión ha vencido: el proxy la cierra y el acceso lo explica. */
export const SESSION_EXPIRED_PATH = "/acceder?motivo=caducada";
export const SESSION_EXPIRED_REASON = "caducada";

/** Inicio de la sesión (ms) según `amr`; null si el token no lo trae. */
export function sessionStartedAt(claims: unknown): number | null {
  if (!claims || typeof claims !== "object") return null;
  const amr: unknown = (claims as { amr?: unknown }).amr;
  if (!Array.isArray(amr)) return null;
  const stamps = amr
    .map((entry: unknown) =>
      entry && typeof entry === "object" ? (entry as { timestamp?: unknown }).timestamp : null,
    )
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t > 0);
  if (stamps.length === 0) return null;
  return Math.min(...stamps) * 1000;
}

/** Minutos válidos (el valor de la base, acotado; por defecto si no llega). */
export function sessionMinutes(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return DEFAULT_SESSION_MINUTES;
  return Math.min(MAX_SESSION_MINUTES, Math.max(MIN_SESSION_MINUTES, raw));
}

export function sessionDeadline(startedAt: number, minutes: number): number {
  return startedAt + minutes * 60 * 1000;
}

/**
 * ¿Puede haber vencido ya? Antes del mínimo configurable no hace falta consultar
 * la base de datos (ahorra una llamada en casi todas las peticiones).
 */
export function mayHaveExpired(startedAt: number, now: number): boolean {
  return now >= sessionDeadline(startedAt, MIN_SESSION_MINUTES);
}

export function isExpired(startedAt: number, minutes: number, now: number): boolean {
  return now >= sessionDeadline(startedAt, minutes);
}
