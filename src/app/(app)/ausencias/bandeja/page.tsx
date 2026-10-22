import { Paperclip } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AbsenceDecisionForm } from "@/features/absences/components/request-actions";
import { getAbsenceAccess } from "@/features/absences/queries";
import { minuteToClock } from "@/features/absences/time";
import { formatAmount, STATUS_LABELS, type RequestStatus } from "@/features/absences/units";
import { getOwnEmployeeId } from "@/features/schedules/queries";
import { requireSection } from "@/lib/auth/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Bandeja de aprobación" };

const ROUTING_LABELS: Record<string, string> = {
  manager: "Aprobador asignado",
  substitute: "Por suplencia",
  hr_no_approver: "Sin aprobador asignado: la resuelve RR. HH.",
  hr_self_approval: "La persona sería su propia aprobadora: la resuelve RR. HH.",
};

const EVENT_LABELS: Record<string, string> = {
  submitted: "Enviada",
  info_requested: "Se pidió información",
  info_provided: "Respondió",
  attachment_added: "Añadió justificante",
};

export default async function BandejaPage() {
  await requireSection("ausencias");
  const [access, ownId] = await Promise.all([getAbsenceAccess(), getOwnEmployeeId()]);
  if (!access.review) notFound();
  const supabase = await createClient();

  // RLS devuelve solo las solicitudes del ámbito del usuario (o en las que es aprobador).
  const { data, error } = await supabase
    .from("absence_requests")
    .select(
      "id, unit, start_date, end_date, half, start_minute, end_minute, amount, amount_unit, status, routing, employee_note, balance_id, employees (first_name, last_name, employee_code), absence_types (name), absence_attachments (id, sensitive), absence_request_events (id, action, message, created_at)",
    )
    .in("status", ["pending", "info_requested"])
    .neq("employee_id", ownId ?? "00000000-0000-0000-0000-000000000000")
    .order("start_date")
    .limit(50);
  if (error) throw new Error("No se pudo cargar la bandeja.");
  const requests = data ?? [];

  // Saldo de cada solicitud (lo ve quien la decide) para decidir con datos.
  const balanceIds = [
    ...new Set(requests.map((r) => r.balance_id).filter((b): b is string => b !== null)),
  ];
  const { data: movements } = balanceIds.length
    ? await supabase
        .from("balance_movements")
        .select("balance_id, amount")
        .in("balance_id", balanceIds)
    : { data: [] };
  const available = new Map<string, number>();
  for (const m of movements ?? [])
    available.set(m.balance_id, (available.get(m.balance_id) ?? 0) + m.amount);

  return (
    <>
      <BackLink href="/ausencias" label="Ausencias" />
      <PageHeader
        title="Bandeja de aprobación"
        description="Solicitudes pendientes de las personas que apruebas o de tu ámbito de RR. HH."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pendientes ({requests.length})</CardTitle>
          <CardDescription>
            Aprobar confirma la reserva de saldo; rechazar la libera. Nadie decide sus propias
            solicitudes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-muted-foreground text-sm">No hay solicitudes pendientes.</p>
          ) : (
            <ul className="divide-y">
              {requests.map((r) => (
                <li key={r.id} className="grid gap-2 py-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {r.employees?.last_name}, {r.employees?.first_name} (
                      {r.employees?.employee_code})
                    </span>
                    <Badge variant="outline">{STATUS_LABELS[r.status as RequestStatus]}</Badge>
                  </div>
                  <p>
                    {r.absence_types?.name} ·{" "}
                    {r.unit === "half_day"
                      ? `${formatDate(r.start_date)} · ${r.half === "morning" ? "mañana" : "tarde"}`
                      : r.unit === "hour"
                        ? `${formatDate(r.start_date)} · ${minuteToClock(r.start_minute ?? 0)}–${minuteToClock(r.end_minute ?? 0)}`
                        : `${formatDate(r.start_date)} – ${formatDate(r.end_date)}`}{" "}
                    · {formatAmount(r.amount, r.amount_unit)}
                  </p>
                  {r.balance_id && available.has(r.balance_id) ? (
                    <p className="text-muted-foreground">
                      Saldo disponible ya descontada esta reserva:{" "}
                      {formatAmount(available.get(r.balance_id) ?? 0, r.amount_unit)}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground">{ROUTING_LABELS[r.routing] ?? ""}</p>
                  {r.employee_note ? <p>Comentario: {r.employee_note}</p> : null}
                  {r.absence_attachments.map((a) =>
                    a.sensitive && !access.attachments ? (
                      <p key={a.id} className="flex items-center gap-2">
                        <Paperclip className="size-4" aria-hidden /> Justificante aportado (solo lo
                        abre RR. HH.)
                      </p>
                    ) : (
                      <a
                        key={a.id}
                        href={`/ausencias/justificante/${a.id}`}
                        className="flex min-h-11 items-center gap-2 underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Paperclip className="size-4" aria-hidden /> Abrir justificante
                      </a>
                    ),
                  )}
                  {r.absence_request_events.length > 1 ? (
                    <ol className="text-muted-foreground grid gap-1">
                      {[...r.absence_request_events]
                        .sort((a, b) => a.id - b.id)
                        .map((e) => (
                          <li key={e.id}>
                            {formatDate(e.created_at)} · {EVENT_LABELS[e.action] ?? e.action}
                            {e.message ? `: ${e.message}` : ""}
                          </li>
                        ))}
                    </ol>
                  ) : null}
                  {r.status === "pending" ? (
                    <AbsenceDecisionForm requestId={r.id} />
                  ) : (
                    <p className="text-muted-foreground">Esperando la respuesta de la persona.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
