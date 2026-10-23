import { connection, NextResponse } from "next/server";

import { releaseInfo } from "@/lib/ops/release";

/**
 * Comprobación de vida (pública, ADR-064): el proceso responde. No consulta
 * dependencias ni revela secretos o datos; solo la identidad del despliegue
 * (versión, commit, migración esperada y entorno) para verificar despliegues.
 */
export async function GET() {
  await connection(); // el entorno se lee en ejecución, no en el build
  return NextResponse.json(
    { status: "ok", ...releaseInfo() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
