import type { Metadata } from "next";
import Link from "next/link";

import { BackLink } from "@/components/admin/back-link";
import { DataTable } from "@/components/admin/data-table";
import { Pagination } from "@/components/admin/pagination";
import { SelectField } from "@/components/admin/select-field";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { assignmentFormOptions, cycleSummary } from "@/features/schedules/admin-data";
import { AssignmentEditor } from "@/features/schedules/components/schedule-forms";
import { ASSIGNMENT_SCOPE_LABELS, ASSIGNMENT_SCOPES } from "@/features/schedules/schemas";
import { todayIn } from "@/features/schedules/zoned-time";
import { requireAdminArea } from "@/lib/admin/context";
import { pageRange, parsePage, pickParam } from "@/lib/admin/pagination";
import { addDays, formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Asignación de horarios" };

const STATES = ["vigentes", "borradores", "todas"] as const;

export default async function HorariosAdminPage({ searchParams }: PageProps<"/admin/horarios">) {
  const ctx = await requireAdminArea("horarios");
  const params = await searchParams;
  const level = pickParam(params.nivel, ASSIGNMENT_SCOPES);
  const state = pickParam(params.estado, STATES) ?? "vigentes";
  const page = parsePage(params.pagina);
  const supabase = await createClient();
  const { data: company } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", ctx.companyId)
    .single();
  const today = todayIn(company?.timezone ?? "Europe/Madrid");

  let query = supabase
    .from("shift_assignments")
    .select(
      "id, scope_type, status, valid_from, valid_to, cycle_days, employees (first_name, last_name, employee_code), teams (name), shift_assignment_days (day_index, template_id)",
      { count: "exact" },
    )
    .eq("company_id", ctx.companyId)
    .order("valid_from", { ascending: false });
  if (level) query = query.eq("scope_type", level);
  if (state === "borradores") query = query.eq("status", "draft");
  if (state === "vigentes")
    query = query.in("status", ["draft", "published"]).or(`valid_to.is.null,valid_to.gt.${today}`);
  const [from, to] = pageRange(page);

  const [assignmentsRes, options] = await Promise.all([
    query.range(from, to),
    assignmentFormOptions(supabase, ctx, today),
  ]);
  if (assignmentsRes.error) throw new Error("No se pudieron cargar las asignaciones.");
  const codes = Object.fromEntries(
    options.templates.map((t) => [t.id, t.label.split(" · ")[0] ?? ""]),
  );

  return (
    <>
      <BackLink href="/admin" label="Administración" />
      <PageHeader
        title="Asignación de horarios"
        description="Turnos por persona, equipo o contrato con fecha de inicio. Se revisan los conflictos antes de publicar."
      />
      <div className="grid gap-4">
        <Card>
          <CardContent className="grid gap-4 pt-6">
            <form className="flex flex-wrap items-end gap-2" action="/admin/horarios">
              <SelectField
                name="nivel"
                label="Nivel"
                defaultValue={level ?? ""}
                placeholder="Todos"
                options={ASSIGNMENT_SCOPES.map((s) => ({
                  value: s,
                  label: ASSIGNMENT_SCOPE_LABELS[s],
                }))}
              />
              <SelectField
                name="estado"
                label="Mostrar"
                defaultValue={state}
                options={[
                  { value: "vigentes", label: "Vigentes, futuras y borradores" },
                  { value: "borradores", label: "Solo borradores" },
                  { value: "todas", label: "Todas (historial)" },
                ]}
              />
              <Button type="submit" variant="outline">
                Filtrar
              </Button>
            </form>
            <DataTable
              caption="Asignaciones de horario"
              rows={assignmentsRes.data ?? []}
              rowKey={(a) => a.id}
              empty="No hay asignaciones con esos filtros."
              columns={[
                {
                  key: "subject",
                  header: "Aplica a",
                  cell: (a) => (
                    <Link href={`/admin/horarios/${a.id}`} className="font-medium underline">
                      {a.scope_type === "team"
                        ? `Equipo ${a.teams?.name ?? ""}`
                        : `${a.employees?.last_name ?? ""}, ${a.employees?.first_name ?? ""} (${a.employees?.employee_code ?? ""})`}
                    </Link>
                  ),
                },
                {
                  key: "level",
                  header: "Nivel",
                  cell: (a) => ASSIGNMENT_SCOPE_LABELS[a.scope_type],
                },
                {
                  key: "validity",
                  header: "Vigencia",
                  cell: (a) =>
                    `${formatDate(a.valid_from)} – ${a.valid_to ? formatDate(addDays(a.valid_to, -1)) : "sin fin"}`,
                },
                {
                  key: "cycle",
                  header: "Ciclo",
                  desktopOnly: true,
                  cell: (a) => cycleSummary(a.cycle_days, a.shift_assignment_days, codes),
                },
                { key: "status", header: "Estado", cell: (a) => <StatusBadge status={a.status} /> },
              ]}
            />
            <Pagination
              base="/admin/horarios"
              params={{ nivel: level, estado: state === "vigentes" ? undefined : state }}
              page={page}
              count={assignmentsRes.count ?? 0}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nueva asignación</CardTitle>
            <CardDescription>
              Se crea como borrador: no afecta a nadie hasta que la publiques.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AssignmentEditor initial={null} today={today} {...options} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
