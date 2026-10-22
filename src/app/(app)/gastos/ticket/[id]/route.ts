import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Abre un ticket con una URL firmada de 60 segundos. La fila solo es visible
 * para la persona, quien la supervisa y Contabilidad de su ámbito, y la URL
 * solo se firma si la política de Storage permite abrir el archivo.
 */
export async function GET(_request: Request, { params }: RouteContext<"/gastos/ticket/[id]">) {
  await requireUserId();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("No encontrado", { status: 404 });
  const supabase = await createClient();
  const { data: receipt } = await supabase
    .from("expense_receipts")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!receipt) return new NextResponse("No encontrado", { status: 404 });
  const { data, error } = await supabase.storage
    .from("expense-receipts")
    .createSignedUrl(receipt.storage_path, 60);
  if (error || !data) return new NextResponse("No encontrado", { status: 404 });
  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
