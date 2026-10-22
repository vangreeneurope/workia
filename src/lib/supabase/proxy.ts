import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { HOME_PATH, LOGIN_PATH, isMachinePath, isPublicPath } from "@/lib/auth/routes";
import { getPublicEnv } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS, REQUEST_ID_PATTERN } from "@/lib/supabase/cookies";
import type { Database } from "@/types/database";

/**
 * Refresca la sesión de Supabase en cada petición y aplica la redirección
 * optimista de rutas protegidas. NO es la barrera de seguridad definitiva:
 * cada página y Server Action vuelve a comprobar la sesión (src/lib/auth/dal.ts)
 * y la base de datos aplica RLS.
 */
export async function updateSession(request: NextRequest) {
  const env = getPublicEnv();
  // Identificador de la petición: el del balanceador si es válido o uno nuevo.
  // Llega a las páginas y acciones (cabecera de la petición), a PostgREST y a
  // audit_events.request_id, y vuelve en la respuesta para soporte.
  const incoming = request.headers.get("x-request-id");
  const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set("x-request-id", requestId);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set("x-request-id", requestId);
    return res;
  };
  let response = next();

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = next();
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // No insertar código entre createServerClient y getClaims: getClaims valida
  // el JWT y, si ha caducado, lo refresca escribiendo las cookies nuevas.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!isAuthenticated && !isPublicPath(pathname) && !isMachinePath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    url.search = "";
    if (pathname !== "/" && pathname !== HOME_PATH) {
      url.searchParams.set("siguiente", `${pathname}${search}`);
    }
    return redirectPreservingCookies(url, response);
  }

  if (isAuthenticated && pathname === LOGIN_PATH) {
    const url = request.nextUrl.clone();
    url.pathname = HOME_PATH;
    url.search = "";
    return redirectPreservingCookies(url, response);
  }

  return response;
}

function redirectPreservingCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  const requestId = from.headers.get("x-request-id");
  if (requestId) redirect.headers.set("x-request-id", requestId);
  redirect.headers.set("Cache-Control", "private, no-store");
  return redirect;
}
