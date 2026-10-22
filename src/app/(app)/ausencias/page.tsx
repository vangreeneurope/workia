import { ChevronLeft, ChevronRight, Inbox, Info, Paperclip } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/admin/action-button";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelAbsence } from "@/features/absences/actions";
import { AttachForm, InfoResponseForm } from "@/features/absences/components/request-actions";
import { RequestForm, type TypeOption } from "@/features/absences/components/request-form";
import { getAbsenceAccess } from "@/features/absences/queries";
import { minuteToClock } from "@/features/absences/time";
import {
  formatAmount,
  STATUS_LABELS,
  type AbsenceUnit,
  type RequestStatus,
} from "@/features/absences/units";
import { addMonths, monthLabel } from "@/features/schedules/calendar";
import { getOwnEmployeeId } from "@/features/schedules/queries";
import { todayIn } from "@/features/schedules/zoned-time";
import { requireSection } from "@/lib/auth/dal";
import { addDays, formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Ausencias" };

const STATUS_BADGE: Record<RequestStatus, string> = {
  pending: "scheduled",
  info_requested: "scheduled",
  approved: "active",
  rejected: "revoked",
  cancelled: "inactive",
  withdrawn: "inactive",
};

function when(r: {
  unit: AbsenceUnit;
  start_date: string;
  end_date: string;
  half: string | null;
  start_minute: number | null;
  end_minute: number | null;
}) {
  if (r.unit === "half_day")
    return `${formatDate(r.start_date)} · ${r.half === "morning" ? "mañana" : "tarde"}`;
  if (r.unit === "hour")
    return `${formatDate(r.start_date)} · ${minuteToClock(r.start_minute ?? 0)}–${minuteToClock(r.end_minute ?? 0)}`;
  return r.start_date === r.end_date
    ? formatDate(r.start_date)
    : `${formatDate(r.start_date)} – ${formatDate(r.end_date)}`;
}

export default async function AusenciasPage({ searchParams }: PageProps<"/ausencias">) {
  const ctx = await requireSection("ausencias");
  const companyId = ctx.activeCompanyId as string;
  const [employeeId, access, params] = await Promise.all([
    getOwnEmployeeId(),
    getAbsenceAccess(),
    searchParams,
  ]);
  const supabase = await createClient();
  const today = todayIn("Europe/Madrid");
  const month =
    typeof params.mes === "string" && /^\d{4}-\d{2}$/.test(params.mes)
      ? params.mes
      : today.slice(0, 7);
  const from = `${month}-01`;
  const to = addDays(addMonths(from, 1), -1);

  const [balancesRes, typesRes, requestsRes, calendarRes] = await Promise.all([
    employeeId
      ? supabase.rpc("my_vacation_balances", { p_company: companyId })
      : Promise.resolve({ data: [] }),
    supabase
      .from("absence_types")
      .select("id, name, allowed_units, requires_attachment, uses_balance, requires_approval")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("name"),
    employeeId
      ? supabase
          .from("absence_requests")
          .select(
            "id, unit, start_date, end_date, half, start_minute, end_minute, amount, amount_unit, status, absence_types (name, requires_attachment), absence_attachments (id), absence_request_events (id, action, message, created_at)",
          )
          .eq("employee_id", employeeId)
          .order("start_date", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
    supabase.rpc("absence_calendar", { p_company: companyId, p_from: from, p_to: to }),
  ]);

  const types: TypeOption[] = (typesRes.data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    units: (Array.isArray(t.allowed_units) ? t.allowed_units : []) as AbsenceUnit[],
    requiresAttachment: t.requires_attachment,
    usesBalance: t.uses_balance,
    requiresApproval: t.requires_approval,
  }));
  const balances = balancesRes.data ?? [];
  const requests = requestsRes.data ?? [];
  const calendar = calendarRes.data ?? [];

  return (
    <>
      <PageHeader
        title="Vacaciones y ausencias"
        description="Tu saldo, tus solicitudes y el calendario de tu equipo."
        actions={
          access.review ? (
            <Link
              href="/ausencias/bandeja"
              className="hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium"
            >
              <Inbox className="size-4" aria-hidden /> Bandeja de aprobación
            </Link>
          ) : null
        }
      />
      {!employeeId ? (
        <Alert>
          <Info />
          <AlertTitle>No tienes ficha de empleado en la empresa activa</AlertTitle>
          <AlertDescription>
            Pide a RR. HH. que complete tu ficha para solicitar ausencias.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="grid content-start gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Mi saldo</CardTitle>
                <CardDescription>
                  Se calcula con el libro de movimientos de tu política; no se edita a mano.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {balances.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No tienes políticas con saldo asignadas.
                  </p>
                ) : (
                  <ul className="grid gap-3">
                    {balances.map((b) => (
                      <li key={b.balance_id} className="grid gap-1 rounded-lg border p-3 text-sm">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-medium">{b.policy_name}</span>
                          <span className="text-lg font-semibold">
                            {formatAmount(b.available, b.unit)}
                          </span>
                        </div>
                        <p className="text-muted-foreground">
                          Periodo {formatDate(b.period_start)} –{" "}
                          {formatDate(addDays(b.period_end, -1))} · derecho{" "}
                          {formatAmount(b.entitled, b.unit)}
                          {b.carried ? ` · arrastre ${formatAmount(b.carried, b.unit)}` : ""}
                          {b.used ? ` · usado ${formatAmount(b.used, b.unit)}` : ""}
                          {b.reserved ? ` · pendiente ${formatAmount(b.reserved, b.unit)}` : ""}
                          {b.adjusted ? ` · ajustes ${formatAmount(b.adjusted, b.unit)}` : ""}
                          {b.expired ? ` · caducado ${formatAmount(b.expired, b.unit)}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Nueva solicitud</CardTitle>
                <CardDescription>
                  Se comprueban tu contrato, la política, el saldo, los solapes, los festivos y tu
                  turno. El saldo se reserva al enviar.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RequestForm types={types} today={today} />
              </CardContent>
            </Card>
          </div>

          <Card className="content-start">
            <CardHeader>
              <CardTitle className="text-base">Mis solicitudes</CardTitle>
            </CardHeader>
            <CardContent>
              {requests.length === 0 ? (
                <p className="text-muted-foreground text-sm">Aún no has enviado solicitudes.</p>
              ) : (
                <ul className="divide-y">
                  {requests.map((r) => {
                    const status = r.status as RequestStatus;
                    const lastInfo = [...r.absence_request_events]
                      .filter((e) => e.action === "info_requested" || e.action === "rejected")
                      .sort((a, b) => b.id - a.id)[0];
                    return (
                      <li key={r.id} className="grid gap-2 py-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{r.absence_types?.name}</span>
                          <StatusBadge
                            status={STATUS_BADGE[status]}
                            label={STATUS_LABELS[status]}
                          />
                        </div>
                        <p>
                          {when(r)} · {formatAmount(r.amount, r.amount_unit)}
                          {r.absence_attachments.length > 0 ? (
                            <Badge variant="outline" className="ml-2">
                              <Paperclip aria-hidden /> justificante
                            </Badge>
                          ) : null}
                        </p>
                        {lastInfo?.message &&
                        (status === "info_requested" || status === "rejected") ? (
                          <p className="bg-muted/50 rounded p-2">
                            {status === "rejected" ? "Motivo del rechazo: " : "Te piden: "}
                            {lastInfo.message}
                          </p>
                        ) : null}
                        {status === "info_requested" ? <InfoResponseForm requestId={r.id} /> : null}
                        {["pending", "info_requested", "approved"].includes(status) &&
                        r.absence_types?.requires_attachment ? (
                          <details>
                            <summary className="min-h-11 cursor-pointer py-2">
                              Añadir justificante
                            </summary>
                            <AttachForm requestId={r.id} />
                          </details>
                        ) : null}
                        {status === "pending" || status === "info_requested" ? (
                          <div>
                            <ActionButton
                              action={cancelAbsence.bind(null, r.id)}
                              label="Cancelar"
                              confirmMessage="¿Cancelar esta solicitud? Se libera el saldo reservado."
                            />
                          </div>
                        ) : null}
                        {status === "approved" && r.start_date > today ? (
                          <div>
                            <ActionButton
                              action={cancelAbsence.bind(null, r.id)}
                              label="Retirar"
                              confirmMessage="¿Retirar esta ausencia aprobada? Se devuelve el saldo y se avisa."
                            />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="mt-4">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base first-letter:uppercase">
              Calendario · {monthLabel(from)}
            </CardTitle>
            <nav aria-label="Cambiar de mes" className="flex gap-2">
              <Link
                href={`/ausencias?mes=${addMonths(from, -1).slice(0, 7)}`}
                className="hover:bg-accent inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-sm"
              >
                <ChevronLeft className="size-4" aria-hidden /> Anterior
              </Link>
              <Link
                href={`/ausencias?mes=${addMonths(from, 1).slice(0, 7)}`}
                className="hover:bg-accent inline-flex min-h-11 items-center gap-1 rounded-md border px-3 text-sm"
              >
                Siguiente <ChevronRight className="size-4" aria-hidden />
              </Link>
            </nav>
          </div>
          <CardDescription>
            Tus ausencias y las de tu equipo. De tus compañeros solo se muestra que están ausentes,
            nunca el motivo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {calendar.length === 0 ? (
            <p className="text-muted-foreground text-sm">No hay ausencias este mes.</p>
          ) : (
            <ul className="divide-y text-sm">
              {calendar.map((c, i) => (
                <li
                  key={`${c.employee_id}-${c.start_date}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span>
                    <span className="font-medium">
                      {c.relation === "self" ? "Tú" : c.employee_label}
                    </span>{" "}
                    · {when({ ...c, unit: c.unit as AbsenceUnit })}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">{c.label}</span>
                    {c.status !== "approved" ? (
                      <Badge variant="outline">{STATUS_LABELS[c.status as RequestStatus]}</Badge>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="text-muted-foreground mt-4 text-xs">
        Los tipos y las políticas los configura tu empresa. No sustituyen al Estatuto de los
        Trabajadores, a tu convenio colectivo ni al asesoramiento laboral.
      </p>
    </>
  );
}
