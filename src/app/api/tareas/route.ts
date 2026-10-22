import { NextResponse } from "next/server";

import { getEmailProvider } from "@/features/notifications/email/registry";
import { isAuthorizedCron } from "@/features/notifications/machine-auth";
import { sendPendingEmails } from "@/features/notifications/service";
import { supabaseNotificationStore } from "@/features/notifications/store";
import { getPublicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Tareas programadas (ADR-048). No hay sesión de usuario: se autentica con
 * CRON_SECRET y usa la clave de servicio solo para las funciones de tareas.
 * Cada paso es independiente e idempotente; se registra su resultado (solo
 * recuentos y códigos de error, nunca contenido). Llamar cada 5-15 minutos.
 */

type Step = { ok: boolean; counts: Record<string, number>; error?: string };

async function run(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new NextResponse("No autorizado", { status: 401 });
  }
  const client = createAdminClient();
  if (!client) return new NextResponse("Tareas no configuradas", { status: 503 });
  const admin = client;
  const store = supabaseNotificationStore(admin);
  const steps: Record<string, Step> = {};

  async function step(name: string, fn: () => Promise<Record<string, number>>) {
    const started = new Date();
    try {
      const counts = await fn();
      steps[name] = { ok: true, counts };
    } catch (error) {
      const code =
        error instanceof Error && /^[a-z_]{1,40}$/.test(error.message)
          ? error.message
          : "step_failed";
      steps[name] = { ok: false, counts: {}, error: code };
    }
    const s = steps[name];
    await admin.rpc("record_job_run", {
      p_job: name,
      p_started_at: started.toISOString(),
      p_ok: s?.ok ?? false,
      p_counts: s?.counts ?? {},
      p_error_code: s?.error,
    });
  }

  await step("recordatorios", async () => ({ creados: await store.runReminders(new Date()) }));
  await step("avisos", async () => store.processOutbox(500));
  await step("correo", async () => {
    const siteUrl = getPublicEnv().NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) throw new Error("no_site_url");
    const summary = await sendPendingEmails(store, getEmailProvider(), siteUrl);
    return { ...summary };
  });
  await step("saldos", async () => {
    const { data, error } = await admin.rpc("settle_vacation_balances");
    if (error) throw new Error("settle_vacation_balances");
    return { asentados: data ?? 0 };
  });
  await step("selfies", async () => {
    const { data, error } = await admin.rpc("expired_punch_selfies", { p_limit: 200 });
    if (error) throw new Error("expired_punch_selfies");
    let purged = 0;
    for (const row of data ?? []) {
      const removed = await admin.storage.from("punch-selfies").remove([row.selfie_path]);
      if (removed.error) continue;
      const marked = await admin.rpc("mark_punch_selfie_purged", { p_punch: row.punch_id });
      if (!marked.error) purged += 1;
    }
    return { borradas: purged };
  });

  const ok = Object.values(steps).every((s) => s.ok);
  return NextResponse.json(
    { ok, steps },
    { status: ok ? 200 : 207, headers: { "Cache-Control": "no-store" } },
  );
}

export const POST = run;
export const GET = run;
