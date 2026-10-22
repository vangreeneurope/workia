/** Rutas accesibles sin sesión. Todo lo demás requiere autenticación. */
/** "/terminal" es el fichaje compartido con PIN: se identifica por el token del dispositivo (ADR-036). */
export const PUBLIC_PATHS = ["/acceder", "/auth/confirmar", "/auth/error", "/terminal"] as const;

/**
 * Rutas de máquina (ADR-048): no tienen sesión de usuario y se autentican por sí
 * mismas: la tarea programada con CRON_SECRET y el webhook de correo con firma
 * HMAC. El proxy no las redirige al acceso; no son "públicas" para personas y
 * nunca sirven datos sin esa autenticación.
 */
export const MACHINE_PATHS = ["/api/tareas", "/api/correo/webhook"] as const;

export function isMachinePath(pathname: string): boolean {
  return MACHINE_PATHS.some((path) => pathname === path);
}

export const LOGIN_PATH = "/acceder";
export const HOME_PATH = "/panel";

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Normaliza un destino de redirección recibido por URL para evitar
 * redirecciones abiertas: solo rutas internas absolutas ("/algo").
 */
export function safeRedirectPath(
  candidate: string | null | undefined,
  fallback = HOME_PATH,
): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\")) {
    return fallback;
  }
  // Rechaza caracteres de control y esquemas camuflados.
  if (/[\u0000-\u001f\u007f]/.test(candidate) || /^\/+[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    return fallback;
  }
  if (
    isPublicPath(candidate.split(/[?#]/)[0] ?? "") ||
    isMachinePath(candidate.split(/[?#]/)[0] ?? "")
  ) {
    return fallback;
  }
  return candidate;
}
