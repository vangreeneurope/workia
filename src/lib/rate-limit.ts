import "server-only";

import type { FormState } from "@/lib/forms";
import { log } from "@/lib/log";
import type { createClient } from "@/lib/supabase/server";

export type RateLimitedAction = "upload" | "export" | "download" | "mfa";

/**
 * Límite de frecuencia por persona y acción (los límites viven en la base de
 * datos: public.check_rate_limit). Devuelve el estado de error si se supera.
 */
export async function rateLimited(
  supabase: Awaited<ReturnType<typeof createClient>>,
  action: RateLimitedAction,
): Promise<FormState | null> {
  const { error } = await supabase.rpc("check_rate_limit", { p_action: action });
  if (!error) return null;
  log.security("rate_limit.exceeded", { action });
  return {
    status: "error",
    message: "Demasiadas solicitudes seguidas: espera unos minutos y vuelve a intentarlo.",
  };
}
