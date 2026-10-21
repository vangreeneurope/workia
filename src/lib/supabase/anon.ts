import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Cliente SIN sesión (rol anon) para el terminal compartido. No lee cookies de
 * Auth: aunque alguien haya iniciado sesión en ese navegador, el terminal no
 * actúa en su nombre. Solo puede llamar a kiosk_device_info y kiosk_punch
 * (ADR-036); el resto está revocado para anon.
 */
export function createAnonClient() {
  const env = getPublicEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
