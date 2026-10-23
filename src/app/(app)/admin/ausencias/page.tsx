import type { Metadata } from "next";
import Link from "next/link";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { StatusToggle } from "@/components/admin/status-toggle";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setTypeStatus } from "@/features/absences/actions";
import {
  AdjustmentForm,
  AssignmentForm,
  EndAssignmentForm,
  PolicyForm,
  TypeForm,
} from "@/features/absences/components/admin-forms";
import { UNIT_LABELS, type AbsenceUnit } from "@/features/absences/units";
import { todayIn } from "@/features/schedules/zoned-time";
import { requireAdminArea } from "@/lib/admin/context";
import { addDays, formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Vacaciones y ausencias" };

const SCOPE_LABELS: Record<string, string> = {
  company: "Toda la empresa",
  work_center: "Centro",
  team: "Equipo",
  employee: "Persona",
};

export default async function AdminAusenciasPage() {
  const ctx = await requireAdminArea("ausencias");
  const supabase = await createClient();
  const today = todayIn("Europe/Madrid");
  const [typesRes, policiesRes, assignmentsRes, employeesRes, teamsRes, centersRes] =
    await Promise.all([
      supabase
        .from("absence_types")
        .select(
          "id, code, name, allowed_units, uses_balance, requires_approval, requires_attachment, is_private, status",
        )
        .eq("company_id", ctx.companyId)
        .order("code"),
      supabase
        .from("vacation_policies")
        .select(
          "id, code, name, absence_types (name), vacation_policy_versions (version, status, valid_from, valid_to)",
        )
        .eq("company_id", ctx.companyId)
        .order("code"),
      supabase
        .from("policy_assignments")
        .select(
          "id, scope_type, valid_from, valid_to, status, vacation_policies (code), employees (first_name, last_name), teams (name), work_centers (name)",
        )
        .eq("company_id", ctx.companyId)
        .eq("status", "active")
        .or(`valid_to.is.null,valid_to.gt.${today}`)
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
      supabase
        .from("work_centers")
        .select("id, name")
        .eq("company_id", ctx.companyId)
        .eq("status", "active")
        .order("name"),
    ]);
  const types = typesRes.data ?? [];
  const policies = policiesRes.data ?? [];
  const employees = (employeesRes.data ?? []).map((e) => ({
    id: e.id,
    label: `${e.last_name}, ${e.first_name} (${e.employee_code})`,
  }));
  const policyOptions = policies.map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` }));

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Vacaciones y ausencias"
        description="Tipos y políticas de tu empresa. Este catálogo no sustituye al Estatuto de los Trabajadores, al convenio colectivo ni al asesoramiento laboral: configúralo según tus fuentes."
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tipos de ausencia</CardTitle>
            <CardDescription>
              No hay una lista legal predefinida: cada empresa crea los suyos.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <DataTable
              caption="Tipos de ausencia"
              rows={types}
              rowKey={(t) => t.id}
              empty="Aún no hay tipos."
              columns={[
                { key: "name", header: "Tipo", cell: (t) => `${t.code} · ${t.name}` },
                {
                  key: "units",
                  header: "Unidades",
                  cell: (t) =>
                    (Array.isArray(t.allowed_units) ? t.allowed_units : [])
                      .map((u) => UNIT_LABELS[u as AbsenceUnit])
                      .join(", "),
                },
                {
                  key: "rules",
                  header: "Reglas",
                  desktopOnly: true,
                  cell: (t) =>
                    [
                      t.uses_balance ? "con saldo" : "sin saldo",
                      t.requires_approval ? "con aprobación" : "aprobación automática (regla)",
                      t.requires_attachment ? "justificante" : null,
                      t.is_private ? "reservado" : null,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                },
                {
                  key: "status",
                  header: "Estado",
                  cell: (t) => (
                    <StatusToggle
                      id={t.id}
                      status={t.status === "active" ? "active" : "inactive"}
                      action={setTypeStatus}
                      entityLabel={`el tipo ${t.code}`}
                    />
                  ),
                },
              ]}
            />
            <TypeForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Políticas de saldo</CardTitle>
            <CardDescription>
              Derecho, devengo, prorrateo, redondeo, arrastre y caducidad, con versiones por
              vigencia.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            <DataTable
              caption="Políticas"
              rows={policies}
              rowKey={(p) => p.id}
              empty="Aún no hay políticas."
              columns={[
                {
                  key: "name",
                  header: "Política",
                  cell: (p) => (
                    <Link
                      href={`/admin/ausencias/politicas/${p.id}`}
                      className="font-medium underline"
                    >
                      {p.code} · {p.name}
                    </Link>
                  ),
                },
                { key: "type", header: "Tipo", cell: (p) => p.absence_types?.name ?? "" },
                {
                  key: "version",
                  header: "Versión vigente",
                  cell: (p) => {
                    const current = p.vacation_policy_versions.find(
                      (v) =>
                        v.status === "published" &&
                        v.valid_from !== null &&
                        v.valid_from <= today &&
                        (!v.valid_to || v.valid_to > today),
                    );
                    return current
                      ? `v${current.version} desde ${formatDate(current.valid_from)}`
                      : "Sin versión vigente";
                  },
                },
              ]}
            />
            <PolicyForm
              types={types
                .filter((t) => t.uses_balance && t.status === "active")
                .map((t) => ({ id: t.id, label: t.name }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Asignaciones vigentes y futuras</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <DataTable
              caption="Asignaciones de políticas"
              rows={assignmentsRes.data ?? []}
              rowKey={(a) => a.id}
              empty="Ninguna política asignada."
              columns={[
                { key: "policy", header: "Política", cell: (a) => a.vacation_policies?.code ?? "" },
                {
                  key: "scope",
                  header: "Ámbito",
                  cell: (a) =>
                    a.scope_type === "employee"
                      ? `${a.employees?.last_name ?? ""}, ${a.employees?.first_name ?? ""}`
                      : a.scope_type === "team"
                        ? `Equipo ${a.teams?.name ?? ""}`
                        : a.scope_type === "work_center"
                          ? `Centro ${a.work_centers?.name ?? ""}`
                          : SCOPE_LABELS.company,
                },
                {
                  key: "validity",
                  header: "Vigencia",
                  cell: (a) =>
                    `${formatDate(a.valid_from)} – ${a.valid_to ? formatDate(addDays(a.valid_to, -1)) : "sin fin"}`,
                },
                {
                  key: "end",
                  header: "Acciones",
                  cell: (a) => <EndAssignmentForm id={a.id} today={today} />,
                },
              ]}
            />
            <AssignmentForm
              policies={policyOptions}
              employees={employees}
              teams={(teamsRes.data ?? []).map((t) => ({ id: t.id, label: t.name }))}
              centers={(centersRes.data ?? []).map((c) => ({ id: c.id, label: c.name }))}
              today={today}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ajuste manual de saldo</CardTitle>
            <CardDescription>
              Queda como movimiento del libro, con su motivo y autor en la auditoría. El saldo nunca
              se edita directamente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdjustmentForm employees={employees} policies={policyOptions} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
