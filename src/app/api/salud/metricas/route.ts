import { connection, NextResponse } from "next/server";

import { isAuthorizedCron } from "@/features/notifications/machine-auth";
import { log } from "@/lib/log";
import { operationalMetrics } from "@/lib/ops/checks";
import { releaseInfo } from "@/lib/ops/release";

/**
 * Métricas operativas para el sistema de monitorización (ADR-064):
 * "Authorization: Bearer <METRICS_TOKEN>" (≥ 32 caracteres, distinto de
 * CRON_SECRET). Agregados de toda la plataforma sin datos de empresas ni
 * personas (public.ops_metrics). Sin token configurado, nadie puede leerlas.
 */
export async function GET(request: Request) {
  await connection();
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.METRICS_TOKEN)) {
    log.security("metrics.unauthorized", {});
    return new NextResponse("No autorizado", { status: 401 });
  }
  const metrics = await operationalMetrics();
  if (!metrics) return new NextResponse("Métricas no disponibles", { status: 503 });
  return NextResponse.json(
    { release: releaseInfo(), metrics },
    { headers: { "Cache-Control": "no-store" } },
  );
}
