import "server-only";

import { NextResponse } from "next/server";

import { isCrossSiteRequest } from "@/lib/http";
import type { createClient } from "@/lib/supabase/server";

/**
 * Comprobaciones comunes de las descargas de archivos privados: solo desde el
 * propio sitio (o enlace abierto directamente) y con límite de frecuencia por
 * persona. Devuelve la respuesta de rechazo o null si se puede continuar.
 */
export async function guardDownload(
  request: Request,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<NextResponse | null> {
  if (isCrossSiteRequest(request)) return new NextResponse("No permitido", { status: 403 });
  const { error } = await supabase.rpc("check_rate_limit", { p_action: "download" });
  if (error) {
    return new NextResponse("Demasiadas descargas seguidas: espera unos minutos.", {
      status: 429,
      headers: { "Retry-After": "600" },
    });
  }
  return null;
}
