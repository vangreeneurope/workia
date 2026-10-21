import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  changeTerms,
  reactivateEmployee,
  terminateEmployee,
  updateEmployee,
} from "@/features/admin/people/actions";
import { EmployeeForm } from "@/features/admin/people/components/employee-form";
import { TermsChangeForm } from "@/features/admin/people/components/terms-change-form";
import {
  ReactivateForm,
  TerminationForm,
} from "@/features/admin/people/components/termination-form";
import { organizationOptions } from "@/features/admin/people/queries";
import { employeeSituation } from "@/features/admin/people/situation";
import {
  APPROVAL_TYPE_LABELS,
  APPROVAL_TYPES,
  CONTRACT_TYPE_LABELS,
  WORKING_TIME_LABELS,
} from "@/features/admin/schemas";
import { hasPermission } from "@/lib/admin/access";
import { requireAdminArea } from "@/lib/admin/context";
import { uuidParam } from "@/lib/admin/pagination";
import { dbErrorMessage } from "@/lib/db-errors";
import { addDays, businessDate, formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Ficha de persona" };

export default async function PersonaPage({ params }: PageProps<"/admin/personas/[id]">) {
  const ctx = await requireAdminArea("personas");
  const id = uuidParam((await params).id);
  if (!id) notFound();
  const supabase = await createClient();

  const [employeeRes, termsRes, options] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, employee_code, first_name, last_name, work_email, work_center_id, team_id, end_date, membership_id",
      )
      .eq("id", id)
      .eq("company_id", ctx.companyId)
      .maybeSingle(),
    supabase
      .from("employment_terms")
      .select(
        "id, contract_type, working_time, weekly_hours, job_title, valid_from, valid_to, status",
      )
      .eq("employee_id", id)
      .order("valid_from", { ascending: false }),
    organizationOptions(ctx),
  ]);
  const employee = employeeRes.data;
  if (!employee) notFound();

  // Aprobador efectivo por tipo de solicitud (o el error accionable).
  const approvals = await Promise.all(
    APPROVAL_TYPES.map(async (type) => {
      const { data, error } = await supabase.rpc("resolve_approver", {
        p_employee: id,
        p_type: type,
      });
      return {
        type,
        approverId: data?.[0]?.approver_user_id ?? null,
        viaSubstitution: Boolean(data?.[0]?.substitution_id),
        error: error ? dbErrorMessage(error) : null,
      };
    }),
  );
  const approverIds = [...new Set(approvals.flatMap((a) => (a.approverId ? [a.approverId] : [])))];
  const { data: labels } = approverIds.length
    ? await supabase.rpc("group_user_labels", { p_company: ctx.companyId, p_users: approverIds })
    : { data: [] };
  const nameOf = (userId: string) =>
    labels?.find((l) => l.user_id === userId)?.full_name || "Persona del grupo";

  const today = businessDate();
  const situation = employeeSituation(employee.end_date, today);
  const canManage = hasPermission(ctx.permissions, "employees.manage");
  const canManageTerms = hasPermission(ctx.permissions, "terms.manage");
  const canReadTerms = hasPermission(ctx.permissions, "terms.read");

  return (
    <>
      <BackLink href="/admin/personas" label="Personas" />
      <PageHeader
        title={`${employee.first_name} ${employee.last_name}`}
        description={`Código ${employee.employee_code}`}
        actions={
          situation === "active" ? (
            <StatusBadge status="active" label="En activo" />
          ) : (
            <StatusBadge
              status={situation === "leaving" ? "leaving" : "terminated"}
              label={`${situation === "leaving" ? "Baja el" : "Baja desde"} ${formatDate(employee.end_date)}`}
            />
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Datos de la ficha</CardTitle>
            <CardDescription>
              Para trasladar a la persona a otra empresa se da de baja aquí y se crea una ficha en
              la otra; la empresa de una ficha no se cambia.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmployeeForm
              action={updateEmployee.bind(null, id)}
              defaults={employee}
              workCenters={options.workCenters}
              teams={options.teams}
              submitLabel="Guardar datos"
              readOnly={!canManage}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aprobadores</CardTitle>
            <CardDescription>
              Quién aprobaría hoy cada tipo de solicitud.{" "}
              <Link href="/admin/aprobadores" className="underline underline-offset-4">
                Gestionar asignaciones
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {approvals.map((a) => (
                <li key={a.type} className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr]">
                  <span className="text-sm font-medium">{APPROVAL_TYPE_LABELS[a.type]}</span>
                  {a.approverId ? (
                    <span className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="size-4 text-green-600" aria-hidden />
                      {nameOf(a.approverId)}
                      {a.viaSubstitution ? (
                        <StatusBadge status="scheduled" label="Suplencia" />
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-destructive flex items-start gap-2 text-sm">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                      {a.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {canReadTerms ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Condiciones de empleo</CardTitle>
              <CardDescription>
                Historial completo. Cada cambio crea un nuevo periodo.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6">
              <DataTable
                caption="Condiciones de empleo"
                rows={termsRes.data ?? []}
                rowKey={(t) => t.id}
                empty="Sin condiciones registradas."
                columns={[
                  {
                    key: "period",
                    header: "Periodo",
                    cell: (t) =>
                      `${formatDate(t.valid_from)} – ${t.valid_to ? formatDate(addDays(t.valid_to, -1)) : "sin fin"}`,
                  },
                  {
                    key: "type",
                    header: "Contrato",
                    cell: (t) => CONTRACT_TYPE_LABELS[t.contract_type],
                  },
                  {
                    key: "hours",
                    header: "Jornada",
                    cell: (t) => `${WORKING_TIME_LABELS[t.working_time]} · ${t.weekly_hours} h/sem`,
                  },
                  {
                    key: "title",
                    header: "Puesto",
                    cell: (t) => t.job_title ?? "—",
                    desktopOnly: true,
                  },
                  {
                    key: "status",
                    header: "Estado",
                    cell: (t) => <StatusBadge status={t.status} />,
                  },
                ]}
              />
              {canManageTerms && situation !== "terminated" ? (
                <TermsChangeForm action={changeTerms.bind(null, id)} defaultDate={today} />
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {canManage ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                {situation === "active" ? "Baja" : "Reactivación"}
              </CardTitle>
              <CardDescription>
                {situation === "active"
                  ? "Registra la baja con su fecha efectiva. No se borra ningún dato."
                  : "Vuelve a dejar vigentes la ficha y la cuenta. Después registra condiciones, roles y aprobador."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {situation === "active" ? (
                <TerminationForm action={terminateEmployee.bind(null, id)} defaultDate={today} />
              ) : (
                <ReactivateForm action={reactivateEmployee.bind(null, id)} />
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
