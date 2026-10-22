import type { CookieOptions } from "@supabase/ssr";

/**
 * Opciones de las cookies de sesión de Supabase. httpOnly: ningún script del
 * navegador puede leer los tokens (la app no usa Supabase desde el cliente;
 * todo pasa por Server Components, Server Actions y Route Handlers).
 * SameSite=Lax evita que se envíen en peticiones de otros sitios salvo en la
 * navegación de primer nivel; Secure en producción.
 */
export const AUTH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

/** Formato aceptado para x-request-id (el mismo que comprueba la base de datos). */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
