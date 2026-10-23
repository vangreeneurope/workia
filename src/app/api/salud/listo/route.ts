import { connection, NextResponse } from "next/server";

import { log } from "@/lib/log";
import { readiness } from "@/lib/ops/checks";
import { releaseInfo } from "@/lib/ops/release";

/**
 * Comprobación de disponibilidad (pública, ADR-064): base de datos y Auth
 * responden. 200 si está lista, 503 si no. Solo estados ("ok", "error",
 * "no_configurado"), nunca mensajes de error ni datos.
 */
export async function GET() {
  await connection();
  const { ok, checks } = await readiness();
  if (!ok) log.warn("health.not_ready", { checks });
  return NextResponse.json(
    { status: ok ? "ok" : "error", checks, commit: releaseInfo().commit },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
