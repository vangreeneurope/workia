import { NextResponse } from "next/server";

import { getEmailProvider } from "@/features/notifications/email/registry";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Webhook de entregas del proveedor de correo (ADR-048). Sin sesión: solo se
 * aceptan eventos con firma válida y cada evento se aplica una vez (se
 * deduplica por su id externo). No se registra el cuerpo.
 */
export async function POST(request: Request) {
  const provider = getEmailProvider();
  const admin = createAdminClient();
  if (!provider || !admin) return new NextResponse("No encontrado", { status: 404 });
  const raw = await request.text();
  if (raw.length > 256 * 1024) return new NextResponse("Demasiado grande", { status: 413 });
  let events;
  try {
    events = provider.verifyWebhook(raw, request.headers);
  } catch {
    return new NextResponse("Firma no válida", { status: 401 });
  }
  let applied = 0;
  for (const e of events) {
    const { data, error } = await admin.rpc("record_email_event", {
      p_provider: provider.id,
      p_event_id: e.eventId,
      p_external_id: e.externalId,
      p_event: e.type,
      p_occurred_at: e.occurredAt,
    });
    if (error) return new NextResponse("Error", { status: 500 });
    if (data) applied += 1;
  }
  return NextResponse.json({ received: events.length, applied });
}
