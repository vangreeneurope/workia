/** Rutas accesibles sin sesión. Todo lo demás requiere autenticación. */
export const PUBLIC_PATHS = ["/acceder", "/auth/confirmar", "/auth/error"] as const;

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
  if (isPublicPath(candidate.split(/[?#]/)[0] ?? "")) return fallback;
  return candidate;
}
