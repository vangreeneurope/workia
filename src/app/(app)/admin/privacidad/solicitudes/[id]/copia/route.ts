import { NextResponse } from "next/server";

import { getUserContext } from "@/lib/auth/dal";
import { mfaPending } from "@/lib/auth/permissions";
import { isCrossSiteRequest } from "@/lib/http";
import { createClient } from "@/lib/supabase/server";

/**
 * Copia de los datos de una persona (derecho de acceso o portabilidad) para
 * una solicitud aprobada. La genera la base de datos solo para quien gestiona
 * privacidad (con MFA) y queda auditada. No se guarda en ningún sitio: se
 * entrega una vez, como descarga, sin caché.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/admin/privacidad/solicitudes/[id]/copia">,
) {
  if (isCrossSiteRequest(request)) return new NextResponse("No permitido", { status: 403 });
  const ctx = await getUserContext();
  if (mfaPending(ctx)) return new NextResponse("Verifica el segundo factor", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("No encontrado", { status: 404 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("subject_access_package", { p_request: id });
  if (error || !data) return new NextResponse("No encontrado", { status: 404 });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="datos-${id.slice(0, 8)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
