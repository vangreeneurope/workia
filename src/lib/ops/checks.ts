import "server-only";

import { getPublicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

/**
 * Comprobaciones de salud y métricas operativas (ADR-064). Usan la clave de
 * servicio solo para dos lecturas sin datos: una consulta HEAD (sin filas) y
 * public.ops_metrics() (agregados de toda la plataforma). Nunca devuelven
 * mensajes de error de las dependencias, solo "ok", "error" o "no_configurado".
 */

export type CheckState = "ok" | "error" | "no_configurado";

const TIMEOUT_MS = 3000;

async function checkDatabase(): Promise<CheckState> {
  const admin = createAdminClient();
  if (!admin) return "no_configurado";
  try {
    const { error } = await admin
      .from("companies")
      .select("id", { head: true })
      .limit(1)
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    return error ? "error" : "ok";
  } catch {
    return "error";
  }
}

async function checkAuth(): Promise<CheckState> {
  try {
    const env = getPublicEnv();
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

export async function readiness(): Promise<{ ok: boolean; checks: Record<string, CheckState> }> {
  const [database, login] = await Promise.all([checkDatabase(), checkAuth()]);
  // "login" (Supabase Auth) y no "auth": el registro técnico redacta claves con "auth".
  const checks = { database, login };
  // "no_configurado" en base de datos (sin clave de servicio) no impide servir la app.
  return { ok: database !== "error" && login === "ok", checks };
}

export async function operationalMetrics(): Promise<Json | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.rpc("ops_metrics");
  return error ? null : data;
}
