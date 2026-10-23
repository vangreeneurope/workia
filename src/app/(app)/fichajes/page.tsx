import { History, Info, KeyRound, ListChecks } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PunchPanel } from "@/features/time-tracking/components/punch-panel";
import { formatClock, formatSeconds } from "@/features/time-tracking/format";
import { getMyTimeStatus, getReviewAccess } from "@/features/time-tracking/queries";
import { PUNCH_LABELS, type PunchKind } from "@/features/time-tracking/state-machine";
import { todayIn } from "@/features/schedules/zoned-time";
import { requireSection } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Fichajes" };

const linkClass =
  "hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium";

export default async function FichajesPage() {
  await requireSection("fichajes");
  const [status, review] = await Promise.all([getMyTimeStatus(), getReviewAccess()]);

  if (!status) {
    return (
      <>
        <PageHeader title="Fichajes" description="Registro diario de jornada." />
        <Alert>
          <Info />
          <AlertTitle>No tienes ficha de empleado en la empresa activa</AlertTitle>
          <AlertDescription>
            Pide a RR. HH. que complete tu ficha para poder fichar.
          </AlertDescription>
        </Alert>
        {review.read ? (
          <Link href="/fichajes/revision" className={`${linkClass} mt-4`}>
            <ListChecks className="size-4" aria-hidden /> Revisar fichajes del equipo
          </Link>
        ) : null}
      </>
    );
  }

  const supabase = await createClient();
  const today = todayIn(status.timeZone);
  const { data: entries } = await supabase
    .from("time_entries")
    .select("id, work_date, status, worked_seconds, punches (id, kind, server_at)")
    .eq("employee_id", status.employeeId)
    .or(`work_date.eq.${today}${status.entryId ? `,id.eq.${status.entryId}` : ""}`)
    .order("started_at");

  const punches = (entries ?? [])
    .flatMap((e) => e.punches)
    .sort((a, b) => a.server_at.localeCompare(b.server_at));
  const worked = (entries ?? []).reduce((sum, e) => sum + e.worked_seconds, 0);

  return (
    <>
      <PageHeader
        title="Fichajes"
        description="Registra tu entrada, pausas y salida. La hora oficial es la del servidor."
      />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardContent className="pt-6">
            <PunchPanel
              state={status.state}
              startedAt={status.startedAt}
              timeZone={status.timeZone}
              locationMode={status.locationMode}
              locationNotice={status.locationNotice}
              selfieEnabled={status.selfieEnabled}
            />
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hoy</CardTitle>
              <CardDescription>
                {worked > 0
                  ? `Trabajado: ${formatSeconds(worked)} (jornadas cerradas o en curso)`
                  : "Sin tiempo cerrado todavía."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {punches.length === 0 ? (
                <p className="text-muted-foreground text-sm">Aún no has fichado hoy.</p>
              ) : (
                <ol className="grid gap-1 text-sm">
                  {punches.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span>{PUNCH_LABELS[p.kind as PunchKind]}</span>
                      <span className="tabular-nums">
                        {formatClock(p.server_at, status.timeZone)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          <nav aria-label="Más opciones de fichaje" className="grid gap-2">
            <Link href="/fichajes/historial" className={linkClass}>
              <History className="size-4" aria-hidden /> Historial, incidencias y correcciones
            </Link>
            {review.read ? (
              <Link href="/fichajes/revision" className={linkClass}>
                <ListChecks className="size-4" aria-hidden /> Revisar fichajes del equipo
              </Link>
            ) : null}
            <Link href="/perfil#pin-terminal" className={linkClass}>
              <KeyRound className="size-4" aria-hidden />
              {status.hasKioskPin ? "Cambiar mi PIN del terminal" : "Crear mi PIN del terminal"}
            </Link>
          </nav>
        </div>
      </div>
    </>
  );
}
