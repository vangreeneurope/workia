import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/admin/action-button";
import { BackLink } from "@/components/admin/back-link";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addMonths, monthLabel } from "@/features/schedules/calendar";
import { todayIn } from "@/features/schedules/zoned-time";
import { cancelCorrection } from "@/features/time-tracking/actions";
import { CorrectionRequestForm } from "@/features/time-tracking/components/correction-forms";
import {
  CORRECTION_STATUS_LABELS,
  describeIncidentDetail,
  formatClock,
  formatDayTime,
  formatSeconds,
  INCIDENT_LABELS,
  toLocalInput,
} from "@/features/time-tracking/format";
import { getMyTimeStatus } from "@/features/time-tracking/queries";
import { CORRECTION_ACTION_LABELS } from "@/features/time-tracking/schemas";
import {
  ENTRY_STATE_LABELS,
  PUNCH_LABELS,
  type EntryState,
  type PunchKind,
} from "@/features/time-tracking/state-machine";
import { requireSection } from "@/lib/auth/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Historial de fichajes" };

const SOURCE_LABELS: Record<string, string> = { mobile: "móvil", web: "web", kiosk: "terminal" };

export default async function HistorialPage({ searchParams }: PageProps<"/fichajes/historial">) {
  await requireSection("fichajes");
  const status = await getMyTimeStatus();
  if (!status) notFound();
  const params = await searchParams;
  const today = todayIn(status.timeZone);
  const requested =
    typeof params.mes === "string" && /^\d{4}-\d{2}$/.test(params.mes)
      ? params.mes
      : today.slice(0, 7);
  const from = `${requested}-01`;
  const to = addMonths(from, 1);
  const tz = status.timeZone;
  const supabase = await createClient();

  const [entriesRes, requestsRes] = await Promise.all([
    supabase
      .from("time_entries")
      .select(
        "id, work_date, status, started_at, ended_at, worked_seconds, break_seconds, punches (id, kind, server_at, source, location_status), time_adjustments (id, action, punch_id, kind, effective_at, created_at), time_incidents (id, kind, status, detail)",
      )
      .eq("employee_id", status.employeeId)
      .gte("work_date", from)
      .lt("work_date", to)
      .order("work_date", { ascending: false }),
    supabase
      .from("time_correction_requests")
      .select("id, action, kind, proposed_at, reason, status, decision_note, created_at")
      .eq("employee_id", status.employeeId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (entriesRes.error) throw new Error("No se pudo cargar el historial.");
  const entries = entriesRes.data ?? [];
  const monthWorked = entries.reduce((sum, e) => sum + e.worked_seconds, 0);

  return (
    <>
      <BackLink href="/fichajes" label="Fichajes" />
      <PageHeader
        title="Historial de fichajes"
        description="Tus jornadas, incidencias y correcciones. Los fichajes originales no se modifican nunca."
      />
      <div className="grid gap-4">
        <nav aria-label="Cambiar de mes" className="flex flex-wrap items-center gap-2">
          <Link
            href={`/fichajes/historial?mes=${addMonths(from, -1).slice(0, 7)}`}
            className="hover:bg-accent inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-sm"
          >
            <ChevronLeft className="size-4" aria-hidden /> Mes anterior
          </Link>
          <span className="px-2 font-medium first-letter:uppercase">{monthLabel(from)}</span>
          {to <= `${today.slice(0, 7)}-01` ? (
            <Link
              href={`/fichajes/historial?mes=${to.slice(0, 7)}`}
              className="hover:bg-accent inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-sm"
            >
              Mes siguiente <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : null}
          <span className="text-muted-foreground ml-auto text-sm">
            Total del mes: {formatSeconds(monthWorked)}
          </span>
        </nav>

        {entries.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
            No hay jornadas este mes.
          </p>
        ) : (
          <ul className="grid gap-3">
            {entries.map((e) => {
              const changed = new Map(
                e.time_adjustments
                  .filter((a) => a.punch_id && a.action !== "add")
                  .map((a) => [a.punch_id, a]),
              );
              const openIncidents = e.time_incidents.filter((i) => i.status === "open");
              return (
                <li key={e.id}>
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-base">{formatDate(e.work_date)}</CardTitle>
                        <Badge variant={e.status === "closed" ? "secondary" : "outline"}>
                          {ENTRY_STATE_LABELS[e.status as EntryState]}
                        </Badge>
                      </div>
                      <CardDescription>
                        Trabajado {formatSeconds(e.worked_seconds)}
                        {e.break_seconds > 0 ? ` · pausas ${formatSeconds(e.break_seconds)}` : ""}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 text-sm">
                      <ol className="grid gap-1">
                        {[...e.punches]
                          .sort((a, b) => a.server_at.localeCompare(b.server_at))
                          .map((p) => {
                            const adj = changed.get(p.id);
                            return (
                              <li key={p.id} className="flex flex-wrap justify-between gap-2">
                                <span
                                  className={adj ? "text-muted-foreground line-through" : undefined}
                                >
                                  {PUNCH_LABELS[p.kind as PunchKind]} ·{" "}
                                  {formatClock(p.server_at, tz)}
                                </span>
                                <span className="text-muted-foreground text-xs">
                                  {adj
                                    ? adj.action === "void"
                                      ? "Anulado por corrección"
                                      : `Corregido a ${adj.effective_at ? formatClock(adj.effective_at, tz) : "—"}`
                                    : SOURCE_LABELS[p.source]}
                                </span>
                              </li>
                            );
                          })}
                        {e.time_adjustments
                          .filter((a) => a.action === "add")
                          .map((a) => (
                            <li key={a.id} className="flex flex-wrap justify-between gap-2">
                              <span>
                                {PUNCH_LABELS[a.kind as PunchKind]} ·{" "}
                                {a.effective_at ? formatClock(a.effective_at, tz) : "—"}
                              </span>
                              <span className="text-muted-foreground text-xs">
                                Añadido por corrección
                              </span>
                            </li>
                          ))}
                      </ol>
                      {openIncidents.length > 0 ? (
                        <ul className="grid gap-1">
                          {openIncidents.map((i) => (
                            <li key={i.id} className="flex items-start gap-2">
                              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                              <span>
                                {INCIDENT_LABELS[i.kind] ?? i.kind}
                                {describeIncidentDetail(i.kind, i.detail)
                                  ? ` · ${describeIncidentDetail(i.kind, i.detail)}`
                                  : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <details>
                        <summary className="min-h-11 cursor-pointer py-2 font-medium">
                          Solicitar una corrección
                        </summary>
                        <CorrectionRequestForm
                          employeeId={status.employeeId}
                          entryId={e.id}
                          defaultLocal={toLocalInput(e.started_at ?? new Date().toISOString(), tz)}
                          punches={e.punches
                            .filter((p) => !changed.has(p.id))
                            .map((p) => ({
                              id: p.id,
                              label: `${PUNCH_LABELS[p.kind as PunchKind]} · ${formatClock(p.server_at, tz)}`,
                              localValue: toLocalInput(p.server_at, tz),
                            }))}
                        />
                      </details>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">¿Olvidaste fichar un día entero?</CardTitle>
            <CardDescription>
              Solicita la entrada; cuando se apruebe, solicita también la salida desde esa jornada.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CorrectionRequestForm
              employeeId={status.employeeId}
              entryId={null}
              punches={[]}
              defaultLocal={`${today}T09:00`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mis solicitudes de corrección</CardTitle>
          </CardHeader>
          <CardContent>
            {(requestsRes.data ?? []).length === 0 ? (
              <p className="text-muted-foreground text-sm">No has enviado solicitudes.</p>
            ) : (
              <ul className="divide-y text-sm">
                {(requestsRes.data ?? []).map((r) => (
                  <li key={r.id} className="grid gap-1 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {CORRECTION_ACTION_LABELS[r.action]}
                        {r.kind ? ` · ${PUNCH_LABELS[r.kind as PunchKind]}` : ""}
                        {r.proposed_at ? ` · ${formatDayTime(r.proposed_at, tz)}` : ""}
                      </span>
                      <StatusBadge status={r.status} label={CORRECTION_STATUS_LABELS[r.status]} />
                    </div>
                    <p className="text-muted-foreground">Motivo: {r.reason}</p>
                    {r.decision_note ? <p>Respuesta: {r.decision_note}</p> : null}
                    {r.status === "pending" ? (
                      <div>
                        <ActionButton
                          action={cancelCorrection.bind(null, r.id)}
                          label="Cancelar solicitud"
                          confirmMessage="¿Cancelar esta solicitud?"
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
