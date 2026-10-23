import { NextResponse } from "next/server";

import { getEmailProvider } from "@/features/notifications/email/registry";
import { isAuthorizedCron } from "@/features/notifications/machine-auth";
import { sendPendingEmails } from "@/features/notifications/service";
import { supabaseNotificationStore } from "@/features/notifications/store";
import { getPublicEnv } from "@/lib/env";
import { log } from "@/lib/log";
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
    log.security("cron.unauthorized", {});
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
    // Métrica por paso (docs/OBSERVABILIDAD.md): solo recuentos y códigos.
    log.info("job.step", {
      job: name,
      ok: s?.ok ?? false,
      error_code: s?.error,
      duration_ms: Date.now() - started.getTime(),
      counts: s?.counts ?? {},
    });
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
  await step("exportaciones", async () => {
    // Caducadas (7 días) y atascadas: se marcan en la base de datos y se borra el archivo.
    const { data, error } = await admin.rpc("expire_report_exports");
    if (error) throw new Error("expire_report_exports");
    const paths = (data ?? []).map((r) => r.storage_path).filter((p): p is string => !!p);
    let removed = 0;
    for (let i = 0; i < paths.length; i += 100) {
      const res = await admin.storage.from("report-exports").remove(paths.slice(i, i + 100));
      if (!res.error) removed += res.data.length;
    }
    return { caducadas: (data ?? []).length, archivos_borrados: removed };
  });
  await step("retencion", async () => {
    // Por defecto solo se simula (recuentos). Ejecutar exige RETENTION_MODE=execute
    // tras revisar la matriz con la organización (docs/PRIVACIDAD.md).
    const mode = process.env.RETENTION_MODE === "execute" ? "execute" : "simulate";
    const { data, error } = await admin.rpc("run_retention", { p_mode: mode });
    if (error) throw new Error("run_retention");
    const counts: Record<string, number> = { ejecutada: mode === "execute" ? 1 : 0 };
    for (const row of data ?? []) counts[row.category] = row.affected;
    return counts;
  });

  // Instantánea de colas al final de cada ejecución: métricas basadas en registros
  // sin infraestructura adicional (alertas en docs/OBSERVABILIDAD.md).
  const metrics = await admin.rpc("ops_metrics");
  if (metrics.error) log.warn("ops.metrics_failed", { code: metrics.error.code });
  else log.info("ops.metrics", { metrics: metrics.data });

  const ok = Object.values(steps).every((s) => s.ok);
  if (!ok)
    log.security("cron.steps_failed", { steps: Object.keys(steps).filter((k) => !steps[k]?.ok) });
  return NextResponse.json(
    { ok, steps },
    { status: ok ? 200 : 207, headers: { "Cache-Control": "no-store" } },
  );
}

export const POST = run;
export const GET = run;
