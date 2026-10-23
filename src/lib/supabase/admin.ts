import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Cliente con la clave secreta de Supabase. SALTA RLS: úsalo solo para lo que
 * documentan ADR-025 (invitar personas a Auth y localizar su cuenta por correo,
 * siempre después de autorizar al usuario con su propia sesión) y ADR-048
 * (tareas programadas y webhook de correo, solo con las funciones de tareas) y
 * ADR-064 (salud y métricas agregadas, src/lib/ops/checks.ts).
 * Nunca en un Client Component ni para leer o escribir datos de empresa.
 */
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return null;
  const env = getPublicEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
