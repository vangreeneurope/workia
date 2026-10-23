import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth/dal";
import { guardDownload } from "@/lib/downloads";
import { createClient } from "@/lib/supabase/server";

/**
 * Descarga de una exportación de informe: la base de datos comprueba que es de
 * quien la pide, que está lista y sin caducar, y registra la descarga (con su
 * request_id en audit_events). Se redirige a una URL firmada de 60 segundos.
 */
export async function GET(request: Request, { params }: RouteContext<"/informes/descargas/[id]">) {
  await requireUserId();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("No encontrado", { status: 404 });
  const supabase = await createClient();
  const blocked = await guardDownload(request, supabase);
  if (blocked) return blocked;
  const { data: path, error } = await supabase.rpc("log_report_download", { p_export: id });
  if (error || !path) return new NextResponse("No encontrado", { status: 404 });
  const name = path.split("/").pop() ?? "informe";
  const { data, error: signError } = await supabase.storage
    .from("report-exports")
    .createSignedUrl(path, 60, { download: name });
  if (signError || !data) return new NextResponse("No encontrado", { status: 404 });
  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
