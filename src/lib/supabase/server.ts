import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { cache } from "react";

import { getPublicEnv } from "@/lib/env";
import { AUTH_COOKIE_OPTIONS, REQUEST_ID_PATTERN } from "@/lib/supabase/cookies";
import type { Database } from "@/types/database";

/**
 * Identificador de la petición: el que llegue en x-request-id (si es válido) o
 * uno nuevo, el mismo para todo el render o la acción. Viaja a PostgREST y la
 * base de datos lo guarda en audit_events.request_id para correlacionar
 * cambios con registros técnicos sin guardar datos de la petición.
 */
export const currentRequestId = cache(async (): Promise<string> => {
  const incoming = (await headers()).get("x-request-id");
  return incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
});

/**
 * Cliente de Supabase para Server Components, Server Actions y Route Handlers.
 * Actúa con la sesión del usuario: todas las consultas pasan por RLS.
 * Crear uno nuevo por petición; no reutilizar entre peticiones.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();
  const requestId = await currentRequestId();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { headers: { "x-request-id": requestId } },
      cookieOptions: AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Desde un Server Component no se pueden escribir cookies. Es seguro
            // ignorarlo: el proxy (src/proxy.ts) ya refresca la sesión.
          }
        },
      },
    },
  );
}
