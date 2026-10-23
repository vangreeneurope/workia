import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth/dal";
import { safeRedirectPath } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Abre un aviso (también desde el correo). Exige sesión; la base de datos
 * comprueba que el aviso es tuyo y que hoy sigues teniendo permiso sobre el
 * objeto. Si no, vuelve a la bandeja con un mensaje, sin revelar nada.
 */
export async function GET(request: Request, { params }: RouteContext<"/avisos/[id]">) {
  await requireUserId();
  const { id } = await params;
  const back = (estado: string) =>
    NextResponse.redirect(new URL(`/avisos?estado=${estado}`, request.url));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return back("no-encontrado");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_notification", { p_notification: id });
  const row = data?.[0];
  if (error || !row) return back("no-encontrado");
  if (!row.allowed) return back("sin-acceso");
  return NextResponse.redirect(new URL(safeRedirectPath(row.link_path, "/avisos"), request.url));
}
