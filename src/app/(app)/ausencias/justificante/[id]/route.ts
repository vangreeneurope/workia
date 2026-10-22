import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth/dal";
import { guardDownload } from "@/lib/downloads";
import { createClient } from "@/lib/supabase/server";

/**
 * Abre un justificante con una URL firmada de 60 segundos y queda registrado en
 * audit_events (quién y cuándo, sin contenido). La autorización la decide la
 * base de datos: la fila solo es visible para las partes y la URL
 * solo se firma si la política de Storage permite abrir el archivo (la persona,
 * RR. HH. con permiso de justificantes y, si no es sensible, quien decide).
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/ausencias/justificante/[id]">,
) {
  await requireUserId();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("No encontrado", { status: 404 });
  const supabase = await createClient();
  const blocked = await guardDownload(request, supabase);
  if (blocked) return blocked;
  // La base de datos comprueba el permiso y registra la apertura (documento sensible).
  const { data: path } = await supabase.rpc("open_absence_attachment", { p_attachment: id });
  if (!path) return new NextResponse("No encontrado", { status: 404 });
  const { data, error } = await supabase.storage
    .from("absence-attachments")
    .createSignedUrl(path, 60);
  if (error || !data) return new NextResponse("No encontrado", { status: 404 });
  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
