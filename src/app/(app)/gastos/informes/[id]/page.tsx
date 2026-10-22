import { Paperclip } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/admin/back-link";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/features/expenses/money";
import { getOwnEmployeeId } from "@/features/schedules/queries";
import { CompleteStepForm, LineDecisionForm } from "@/features/settlement/components/forms";
import {
  LINE_DECISION_LABELS,
  periodLabel,
  REPORT_STATUS_BADGE,
  REPORT_STATUS_LABELS,
  ROUTING_LABELS,
  STEP_STATUS_LABELS,
  sumByCurrency,
  type ReportStatus,
} from "@/features/settlement/labels";
import { requireSection } from "@/lib/auth/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Informe de gastos" };

const DECISION_BADGE: Record<string, "secondary" | "outline" | "destructive"> = {
  approved: "secondary",
  pending: "outline",
  returned: "outline",
  rejected: "destructive",
};

function text(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const v = (snapshot as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

export default async function InformePage({ params }: PageProps<"/gastos/informes/[id]">) {
  const ctx = await requireSection("gastos");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  // RLS: la persona, quien la supervisa, Contabilidad y quien tiene un paso asignado.
  const { data: report } = await supabase
    .from("expense_reports")
    .select("*, employees (first_name, last_name, employee_code)")
    .eq("id", id)
    .maybeSingle();
  if (!report) notFound();
  const [itemsRes, instanceRes, nextRes, pendingRes, ownId] = await Promise.all([
    supabase
      .from("expense_report_items")
      .select(
        "id, expense_id, snapshot, expense_date, currency, base_cents, tax_cents, total_cents, cost_center, project_code, decision, decision_comment, decided_at, carried_from_item_id",
      )
      .eq("report_id", id)
      .order("expense_date"),
    supabase
      .from("approval_instances")
      .select(
        "id, status, current_step, approval_steps (id, step_order, routing, status, acted_at, comment, delegated_from_user_id)",
      )
      .eq("report_id", id)
      .maybeSingle(),
    supabase.from("expense_reports").select("id, version").eq("previous_version_id", id),
    supabase.rpc("my_pending_expense_approvals", { p_company: ctx.activeCompanyId as string }),
    getOwnEmployeeId(),
  ]);
  const items = itemsRes.data ?? [];
  const steps = [...(instanceRes.data?.approval_steps ?? [])].sort(
    (a, b) => a.step_order - b.step_order,
  );
  const myStep = (pendingRes.data ?? []).find((p) => p.report_id === id);
  const status = report.status as ReportStatus;
  const owner = ownId !== null && report.employee_id === ownId;
  const lineStep = myStep?.step_order === 1;
  const approved = items.filter((i) => i.decision === "approved");
  const who = report.employees
    ? `${report.employees.last_name}, ${report.employees.first_name} (${report.employees.employee_code})`
    : "";

  return (
    <>
      <BackLink
        href={owner ? "/gastos/informes" : "/gastos/bandeja"}
        label={owner ? "Informes" : "Bandeja"}
      />
      <PageHeader
        title={`Informe de ${periodLabel(report.period_month)}`}
        description={`${owner ? "" : `${who} · `}Versión ${report.version} · enviado el ${formatDate(report.submitted_at)}`}
        actions={
          <StatusBadge status={REPORT_STATUS_BADGE[status]} label={REPORT_STATUS_LABELS[status]} />
        }
      />

      {owner && status === "returned" && nextRes.data?.length === 0 ? (
        <Alert className="mb-4">
          <AlertTitle>Te han devuelto el informe</AlertTitle>
          <AlertDescription>
            Corrige las líneas devueltas desde Gastos (Corregir) y vuelve a enviar el informe del
            mes. Las líneas aprobadas que no cambies conservan su aprobación; las rechazadas no se
            vuelven a enviar.
          </AlertDescription>
        </Alert>
      ) : null}
      {report.previous_version_id || (nextRes.data?.length ?? 0) > 0 ? (
        <p className="text-muted-foreground mb-4 text-sm">
          {report.previous_version_id ? (
            <Link className="underline" href={`/gastos/informes/${report.previous_version_id}`}>
              Ver la versión anterior
            </Link>
          ) : null}
          {report.previous_version_id && nextRes.data?.length ? " · " : ""}
          {nextRes.data?.map((n) => (
            <Link key={n.id} className="underline" href={`/gastos/informes/${n.id}`}>
              Ver la versión {n.version}
            </Link>
          ))}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Líneas ({items.length})</CardTitle>
            <CardDescription>
              Total enviado:{" "}
              {sumByCurrency(items)
                .map(([c, t]) => formatCents(t, c))
                .join(" + ")}
              {approved.length !== items.length && approved.length > 0
                ? ` · aprobado: ${sumByCurrency(approved)
                    .map(([c, t]) => formatCents(t, c))
                    .join(" + ")}`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {items.map((i) => (
                <li key={i.id} className="grid gap-2 py-4 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="grid gap-0.5">
                      <span className="font-medium">
                        {text(i.snapshot, "merchant_name") ??
                          (text(i.snapshot, "source") === "mileage"
                            ? "Kilometraje"
                            : "Sin proveedor")}
                      </span>
                      <span className="text-muted-foreground">
                        {formatDate(i.expense_date)} · {text(i.snapshot, "category_name")}
                        {i.project_code ? ` · proyecto ${i.project_code}` : ""}
                        {i.cost_center ? ` · ${i.cost_center}` : ""}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-semibold tabular-nums">
                        {formatCents(i.total_cents, i.currency)}
                      </span>
                      <Badge variant={DECISION_BADGE[i.decision]}>
                        {LINE_DECISION_LABELS[i.decision]}
                      </Badge>
                    </span>
                  </div>
                  {text(i.snapshot, "receipt_id") ? (
                    <a
                      href={`/gastos/ticket/${text(i.snapshot, "receipt_id")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-11 w-fit items-center gap-2 underline"
                    >
                      <Paperclip className="size-4" aria-hidden /> Ver ticket
                    </a>
                  ) : null}
                  {i.decision_comment ? (
                    <p className="bg-muted/60 rounded-lg p-2">{i.decision_comment}</p>
                  ) : null}
                  {i.carried_from_item_id ? (
                    <p className="text-muted-foreground text-xs">
                      Aprobada en la versión anterior sin cambios.
                    </p>
                  ) : null}
                  {lineStep && ["submitted", "in_review"].includes(status) ? (
                    <LineDecisionForm itemId={i.id} />
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          {myStep ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {lineStep ? "Terminar la revisión" : "Tu aprobación"}
                </CardTitle>
                <CardDescription>
                  No puedes aprobar tus propios gastos ni dos pasos del mismo informe.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CompleteStepForm reportId={report.id} managerStep={lineStep} />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Aprobación</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-3 text-sm">
                {steps.map((s) => (
                  <li key={s.id} className="grid gap-1 rounded-xl border p-3">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {s.step_order}. {ROUTING_LABELS[s.routing] ?? s.routing}
                      </span>
                      <Badge variant="outline">{STEP_STATUS_LABELS[s.status] ?? s.status}</Badge>
                    </span>
                    {s.acted_at ? (
                      <span className="text-muted-foreground">
                        {formatDate(s.acted_at)}
                        {s.delegated_from_user_id ? " · por delegación (suplencia)" : ""}
                      </span>
                    ) : null}
                    {s.comment ? <span>{s.comment}</span> : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
