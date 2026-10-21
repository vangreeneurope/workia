import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DecisionForm, IncidentForm } from "@/features/time-tracking/components/correction-forms";
import {
  describeIncidentDetail,
  formatClock,
  formatDayTime,
  INCIDENT_LABELS,
} from "@/features/time-tracking/format";
import { getMyTimeStatus, getReviewAccess } from "@/features/time-tracking/queries";
import { CORRECTION_ACTION_LABELS } from "@/features/time-tracking/schemas";
import { PUNCH_LABELS, type PunchKind } from "@/features/time-tracking/state-machine";
import { requireSection } from "@/lib/auth/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Revisión de fichajes" };

export default async function RevisionPage() {
  const ctx = await requireSection("fichajes");
  const [review, me] = await Promise.all([getReviewAccess(), getMyTimeStatus()]);
  if (!review.read) notFound();
  const canAct = review.manage || ctx.supervisedCount > 0;
  const supabase = await createClient();
  const ownId = me?.employeeId ?? "00000000-0000-0000-0000-000000000000";

  // RLS limita a las personas que el usuario puede ver o aprobar.
  const [requestsRes, incidentsRes] = await Promise.all([
    supabase
      .from("time_correction_requests")
      .select(
        "id, action, kind, proposed_at, reason, created_at, employees (first_name, last_name, employee_code, work_centers (timezone), companies (timezone)), punches (kind, server_at), time_entries (work_date)",
      )
      .eq("status", "pending")
      .neq("employee_id", ownId)
      .order("created_at")
      .limit(50),
    supabase
      .from("time_incidents")
      .select(
        "id, kind, detail, work_date, detected_at, employees (first_name, last_name, employee_code)",
      )
      .eq("status", "open")
      .neq("employee_id", ownId)
      .order("work_date", { ascending: false })
      .limit(50),
  ]);
  if (requestsRes.error || incidentsRes.error) throw new Error("No se pudo cargar la revisión.");
  const requests = requestsRes.data ?? [];
  const incidents = incidentsRes.data ?? [];

  return (
    <>
      <BackLink href="/fichajes" label="Fichajes" />
      <PageHeader
        title="Revisión de fichajes"
        description="Correcciones pendientes e incidencias abiertas de las personas de tu ámbito."
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Correcciones pendientes ({requests.length})</CardTitle>
            <CardDescription>
              Aprobar crea un ajuste con el valor anterior y el nuevo; el fichaje original se
              conserva. Si el resultado fuera imposible (por ejemplo, dos salidas), no se aplica.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {requests.length === 0 ? (
              <p className="text-muted-foreground text-sm">No hay correcciones pendientes.</p>
            ) : (
              <ul className="divide-y">
                {requests.map((r) => {
                  const tz =
                    r.employees?.work_centers?.timezone ??
                    r.employees?.companies?.timezone ??
                    "Europe/Madrid";
                  return (
                    <li key={r.id} className="grid gap-2 py-4 text-sm">
                      <p className="font-medium">
                        {r.employees?.last_name}, {r.employees?.first_name} (
                        {r.employees?.employee_code})
                        {r.time_entries
                          ? ` · jornada del ${formatDate(r.time_entries.work_date)}`
                          : " · jornada olvidada"}
                      </p>
                      <p>
                        {CORRECTION_ACTION_LABELS[r.action]}
                        {r.punches
                          ? `: ${PUNCH_LABELS[r.punches.kind as PunchKind]} de las ${formatClock(r.punches.server_at, tz)}`
                          : r.kind
                            ? `: ${PUNCH_LABELS[r.kind as PunchKind]}`
                            : ""}
                        {r.proposed_at ? ` → ${formatDayTime(r.proposed_at, tz)}` : ""}
                      </p>
                      <p className="text-muted-foreground">Motivo: {r.reason}</p>
                      {canAct ? <DecisionForm requestId={r.id} /> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Incidencias abiertas ({incidents.length})</CardTitle>
            <CardDescription>
              Se generan solas al fichar o al recalcular una jornada, y se cierran solas si una
              corrección las resuelve.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {incidents.length === 0 ? (
              <p className="text-muted-foreground text-sm">No hay incidencias abiertas.</p>
            ) : (
              <ul className="divide-y">
                {incidents.map((i) => (
                  <li key={i.id} className="grid gap-2 py-4 text-sm">
                    <p className="font-medium">
                      {i.employees?.last_name}, {i.employees?.first_name} (
                      {i.employees?.employee_code}) · {formatDate(i.work_date)}
                    </p>
                    <p>
                      {INCIDENT_LABELS[i.kind] ?? i.kind}
                      {describeIncidentDetail(i.kind, i.detail)
                        ? ` · ${describeIncidentDetail(i.kind, i.detail)}`
                        : ""}
                    </p>
                    {canAct ? <IncidentForm incidentId={i.id} /> : null}
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
