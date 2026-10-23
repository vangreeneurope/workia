import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/admin/action-button";
import { BackLink } from "@/components/admin/back-link";
import { StatusBadge } from "@/components/admin/status-badge";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { discardAssignment } from "@/features/schedules/actions";
import { assignmentFormOptions, cycleSummary } from "@/features/schedules/admin-data";
import {
  AssignmentEditor,
  CloseAssignmentForm,
  PublishAssignmentForm,
} from "@/features/schedules/components/schedule-forms";
import { ASSIGNMENT_SCOPE_LABELS } from "@/features/schedules/schemas";
import { todayIn } from "@/features/schedules/zoned-time";
import { requireAdminArea } from "@/lib/admin/context";
import { uuidParam } from "@/lib/admin/pagination";
import { addDays, formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Asignación de horario" };

const CODE_LABELS: Record<string, string> = {
  OVERLAP: "Solape",
  TEMPLATE_WITHOUT_VERSION: "Plantilla sin versión",
  ABSENCE: "Ausencia aprobada",
  AFTER_TERMINATION: "Después de la baja",
  NO_CONTRACT: "Sin condiciones vigentes",
};

export default async function HorarioAdminPage({ params }: PageProps<"/admin/horarios/[id]">) {
  const ctx = await requireAdminArea("horarios");
  const id = uuidParam((await params).id);
  if (!id) notFound();
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("shift_assignments")
    .select(
      "id, scope_type, status, employee_id, team_id, employment_terms_id, valid_from, valid_to, cycle_days, anchor_date, note, published_by, published_at, employees (first_name, last_name, employee_code), teams (name), shift_assignment_days (day_index, template_id)",
    )
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .maybeSingle();
  if (!a) notFound();
  const { data: company } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", ctx.companyId)
    .single();
  const today = todayIn(company?.timezone ?? "Europe/Madrid");

  const [options, conflictsRes, publisherRes] = await Promise.all([
    assignmentFormOptions(supabase, ctx, today),
    a.status === "draft"
      ? supabase.rpc("shift_assignment_conflicts", { p_assignment: a.id })
      : Promise.resolve({ data: [], error: null }),
    a.published_by
      ? supabase.rpc("group_user_labels", { p_company: ctx.companyId, p_users: [a.published_by] })
      : Promise.resolve({ data: [] }),
  ]);
  const conflicts = conflictsRes.data ?? [];
  const errors = conflicts.filter((c) => c.severity === "error");
  const warnings = conflicts.filter((c) => c.severity === "warning");
  const codes = Object.fromEntries(
    options.templates.map((t) => [t.id, t.label.split(" · ")[0] ?? ""]),
  );
  const subject =
    a.scope_type === "team"
      ? `Equipo ${a.teams?.name ?? ""}`
      : `${a.employees?.first_name ?? ""} ${a.employees?.last_name ?? ""} (${a.employees?.employee_code ?? ""})`;
  const days = Array.from(
    { length: a.cycle_days },
    (_, i) => a.shift_assignment_days.find((d) => d.day_index === i)?.template_id ?? null,
  );
  const open = a.status === "published" && (!a.valid_to || a.valid_to > today);

  return (
    <>
      <BackLink href="/admin/horarios" label="Asignación de horarios" />
      <PageHeader
        title={subject}
        description={`${ASSIGNMENT_SCOPE_LABELS[a.scope_type]} · ${formatDate(a.valid_from)} – ${a.valid_to ? formatDate(addDays(a.valid_to, -1)) : "sin fin"}`}
        actions={<StatusBadge status={a.status} />}
      />
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ciclo</CardTitle>
            <CardDescription>
              {a.cycle_days} día(s) desde el {formatDate(a.anchor_date)}:{" "}
              {cycleSummary(a.cycle_days, a.shift_assignment_days, codes)} (– = descanso)
            </CardDescription>
          </CardHeader>
          {a.published_at ? (
            <CardContent className="text-muted-foreground text-sm">
              Publicado el {formatDate(a.published_at)} por{" "}
              {publisherRes.data?.[0]?.full_name || "una persona del grupo"}.
            </CardContent>
          ) : null}
        </Card>

        {a.status === "draft" ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Conflictos antes de publicar</CardTitle>
                <CardDescription>
                  Los errores impiden publicar. Los avisos requieren tu confirmación.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {conflictsRes.error ? (
                  <p className="text-destructive text-sm">
                    No se pudieron calcular los conflictos.
                  </p>
                ) : conflicts.length === 0 ? (
                  <p className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="size-4" aria-hidden /> Sin conflictos.
                  </p>
                ) : (
                  <ul className="grid gap-2 text-sm">
                    {conflicts.map((c) => (
                      <li
                        key={`${c.code}-${c.employee_code ?? ""}-${c.first_day ?? ""}`}
                        className="flex items-start gap-2 rounded-md border p-2"
                      >
                        {c.severity === "error" ? (
                          <AlertCircle
                            className="text-destructive mt-0.5 size-4 shrink-0"
                            aria-hidden
                          />
                        ) : (
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                        )}
                        <span>
                          <strong className="font-medium">
                            {c.severity === "error" ? "Error" : "Aviso"}:{" "}
                            {CODE_LABELS[c.code] ?? c.code}
                          </strong>
                          {c.employee_code ? ` · ${c.employee_code}` : ""} · {c.message}
                          {c.first_day
                            ? ` (${formatDate(c.first_day)}${c.last_day && c.last_day !== c.first_day ? ` – ${formatDate(c.last_day)}` : ""}${c.days ? `, ${c.days} día(s)` : ""})`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {errors.length === 0 ? (
                  <PublishAssignmentForm id={a.id} warnings={warnings.length} />
                ) : null}
                <div>
                  <ActionButton
                    action={discardAssignment.bind(null, a.id)}
                    label="Descartar borrador"
                    confirmMessage="¿Descartar este borrador? No afecta a ningún horario publicado."
                  />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Editar borrador</CardTitle>
              </CardHeader>
              <CardContent>
                <AssignmentEditor
                  today={today}
                  {...options}
                  initial={{
                    id: a.id,
                    scope: a.scope_type,
                    employeeId: a.employee_id,
                    teamId: a.team_id,
                    termsId: a.employment_terms_id,
                    validFrom: a.valid_from,
                    lastDay: a.valid_to ? addDays(a.valid_to, -1) : null,
                    cycleDays: a.cycle_days,
                    anchorDate: a.anchor_date,
                    days,
                    note: a.note,
                  }}
                />
              </CardContent>
            </Card>
          </>
        ) : null}

        {open ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Finalizar o cambiar</CardTitle>
              <CardDescription>
                Un horario publicado no se edita: se finaliza y se crea otro con la fecha de efecto
                del cambio. Así los periodos pasados no se alteran.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CloseAssignmentForm id={a.id} today={today} />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}
