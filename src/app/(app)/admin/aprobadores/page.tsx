import type { Metadata } from "next";

import { ActionButton } from "@/components/admin/action-button";
import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { Pagination } from "@/components/admin/pagination";
import { SelectField } from "@/components/admin/select-field";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { endSubstitution } from "@/features/admin/approvers/actions";
import { ApproverChecker } from "@/features/admin/approvers/components/approver-checker";
import { AssignmentForm } from "@/features/admin/approvers/components/assignment-form";
import { EndAssignmentForm } from "@/features/admin/approvers/components/end-assignment-form";
import { SubstitutionForm } from "@/features/admin/approvers/components/substitution-form";
import { APPROVAL_TYPE_LABELS, APPROVAL_TYPES } from "@/features/admin/schemas";
import { requireAdminArea } from "@/lib/admin/context";
import { pageRange, parsePage, pickParam } from "@/lib/admin/pagination";
import { isCurrent } from "@/lib/auth/validity";
import { addDays, businessDate, formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Aprobadores" };

const STATES = ["vigentes", "todas"] as const;

/** Fecha mostrada para un fin exclusivo: el último día incluido. */
function lastDay(validTo: string | null): string {
  return validTo ? formatDate(addDays(businessDate(validTo), -1)) : "sin fin";
}

export default async function AprobadoresPage({ searchParams }: PageProps<"/admin/aprobadores">) {
  const ctx = await requireAdminArea("aprobadores");
  const params = await searchParams;
  const type = pickParam(params.tipo, APPROVAL_TYPES);
  const state = pickParam(params.estado, STATES) ?? "vigentes";
  const page = parsePage(params.pagina);
  const supabase = await createClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const today = businessDate();

  let query = supabase
    .from("manager_assignments")
    .select(
      "id, scope_type, request_type, manager_user_id, status, valid_from, valid_to, employees (first_name, last_name), teams (name)",
      { count: "exact" },
    )
    .eq("company_id", ctx.companyId)
    .order("created_at", { ascending: false });
  if (type) query = query.eq("request_type", type);
  if (state === "vigentes")
    query = query.eq("status", "active").or(`valid_to.is.null,valid_to.gt."${nowIso}"`);
  const [from, to] = pageRange(page);

  const [assignmentsRes, substitutionsRes, employeesRes, teamsRes] = await Promise.all([
    query.range(from, to),
    supabase
      .from("approver_substitutions")
      .select(
        "id, absent_user_id, substitute_user_id, request_type, reason, status, valid_from, valid_to",
      )
      .eq("company_id", ctx.companyId)
      .eq("status", "active")
      .gt("valid_to", nowIso)
      .order("valid_from"),
    supabase
      .from("employees")
      .select("id, first_name, last_name, employee_code")
      .eq("company_id", ctx.companyId)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order("last_name")
      .limit(1000),
    supabase
      .from("teams")
      .select("id, name")
      .eq("company_id", ctx.companyId)
      .eq("status", "active")
      .order("name"),
  ]);
  if (assignmentsRes.error) throw new Error("No se pudieron cargar las asignaciones.");

  const assignments = assignmentsRes.data ?? [];
  const substitutions = substitutionsRes.data ?? [];
  const userIds = [
    ...new Set([
      ...assignments.map((a) => a.manager_user_id),
      ...substitutions.flatMap((s) => [s.absent_user_id, s.substitute_user_id]),
    ]),
  ];
  const { data: labels } = userIds.length
    ? await supabase.rpc("group_user_labels", { p_company: ctx.companyId, p_users: userIds })
    : { data: [] };
  const nameOf = (id: string) =>
    labels?.find((l) => l.user_id === id)?.full_name || "Persona del grupo";

  // Para suplencias: managers con alguna asignación vigente en la empresa.
  const { data: currentManagers } = await supabase
    .from("manager_assignments")
    .select("manager_user_id")
    .eq("company_id", ctx.companyId)
    .eq("status", "active")
    .or(`valid_to.is.null,valid_to.gt."${nowIso}"`)
    .limit(1000);
  const managerIds = [...new Set((currentManagers ?? []).map((m) => m.manager_user_id))];
  const { data: managerLabels } = managerIds.length
    ? await supabase.rpc("group_user_labels", { p_company: ctx.companyId, p_users: managerIds })
    : { data: [] };

  const employeeOptions = (employeesRes.data ?? []).map((e) => ({
    id: e.id,
    label: `${e.last_name}, ${e.first_name} (${e.employee_code})`,
  }));

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Aprobadores"
        description="Quién aprueba las solicitudes de cada persona. Un aprobador puede ser de otra empresa del grupo."
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comprobar aprobador</CardTitle>
            <CardDescription>
              Aplica las prioridades, las suplencias vigentes y las bajas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApproverChecker employees={employeeOptions} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Asignaciones</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form className="flex flex-wrap items-end gap-2" action="/admin/aprobadores">
              <SelectField
                name="tipo"
                label="Tipo"
                defaultValue={type ?? ""}
                placeholder="Todos los tipos"
                options={APPROVAL_TYPES.map((t) => ({ value: t, label: APPROVAL_TYPE_LABELS[t] }))}
              />
              <SelectField
                name="estado"
                label="Mostrar"
                defaultValue={state}
                options={[
                  { value: "vigentes", label: "Vigentes y futuras" },
                  { value: "todas", label: "Todas (historial)" },
                ]}
              />
              <Button type="submit" variant="outline">
                Filtrar
              </Button>
            </form>
            <DataTable
              caption="Asignaciones de aprobador"
              rows={assignments}
              rowKey={(a) => a.id}
              empty="No hay asignaciones con esos filtros."
              columns={[
                {
                  key: "subject",
                  header: "Persona o equipo",
                  cell: (a) =>
                    a.scope_type === "employee"
                      ? `${a.employees?.last_name ?? ""}, ${a.employees?.first_name ?? ""}`
                      : `Equipo ${a.teams?.name ?? ""}`,
                },
                { key: "type", header: "Tipo", cell: (a) => APPROVAL_TYPE_LABELS[a.request_type] },
                { key: "manager", header: "Aprobador", cell: (a) => nameOf(a.manager_user_id) },
                {
                  key: "validity",
                  header: "Vigencia",
                  cell: (a) => `${formatDate(a.valid_from)} – ${lastDay(a.valid_to)}`,
                },
                {
                  key: "status",
                  header: "Estado",
                  cell: (a) => (
                    <StatusBadge
                      status={
                        a.status === "revoked"
                          ? "revoked"
                          : isCurrent(a, now)
                            ? "active"
                            : new Date(a.valid_from) > now
                              ? "scheduled"
                              : "expired"
                      }
                    />
                  ),
                },
                {
                  key: "actions",
                  header: "Acciones",
                  cell: (a) =>
                    a.status === "active" && (!a.valid_to || new Date(a.valid_to) > now) ? (
                      <EndAssignmentForm id={a.id} today={today} label="la asignación" />
                    ) : null,
                },
              ]}
            />
            <Pagination
              base="/admin/aprobadores"
              params={{ tipo: type, estado: state === "vigentes" ? undefined : state }}
              page={page}
              count={assignmentsRes.count ?? 0}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nueva asignación</CardTitle>
            <CardDescription>
              No se admiten dos aprobadores vigentes del mismo nivel para la misma persona o equipo
              y tipo: así nunca hay ambigüedad.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AssignmentForm employees={employeeOptions} teams={teamsRes.data ?? []} today={today} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Suplencias vigentes</CardTitle>
            <CardDescription>
              Durante una suplencia, la persona suplente aprueba en lugar del ausente. Máximo un
              año.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <DataTable
              caption="Suplencias"
              rows={substitutions}
              rowKey={(s) => s.id}
              empty="No hay suplencias vigentes."
              columns={[
                { key: "absent", header: "Ausente", cell: (s) => nameOf(s.absent_user_id) },
                {
                  key: "substitute",
                  header: "Suplente",
                  cell: (s) => nameOf(s.substitute_user_id),
                },
                { key: "type", header: "Tipo", cell: (s) => APPROVAL_TYPE_LABELS[s.request_type] },
                {
                  key: "validity",
                  header: "Vigencia",
                  cell: (s) => `${formatDate(s.valid_from)} – ${lastDay(s.valid_to)}`,
                },
                { key: "reason", header: "Motivo", cell: (s) => s.reason, desktopOnly: true },
                {
                  key: "actions",
                  header: "Acciones",
                  cell: (s) => (
                    <ActionButton
                      action={endSubstitution.bind(null, s.id)}
                      label="Finalizar"
                      confirmMessage="¿Finalizar esta suplencia desde ahora?"
                    />
                  ),
                },
              ]}
            />
            <SubstitutionForm
              managers={(managerLabels ?? []).map((m) => ({
                id: m.user_id,
                label: m.full_name || "Persona del grupo",
              }))}
              today={today}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
