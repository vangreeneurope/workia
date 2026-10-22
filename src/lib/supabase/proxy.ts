import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { HOME_PATH, LOGIN_PATH, isMachinePath, isPublicPath } from "@/lib/auth/routes";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Refresca la sesión de Supabase en cada petición y aplica la redirección
 * optimista de rutas protegidas. NO es la barrera de seguridad definitiva:
 * cada página y Server Action vuelve a comprobar la sesión (src/lib/auth/dal.ts)
 * y la base de datos aplica RLS.
 */
export async function updateSession(request: NextRequest) {
  const env = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
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
  redirect.headers.set("Cache-Control", "private, no-store");
  return redirect;
}
