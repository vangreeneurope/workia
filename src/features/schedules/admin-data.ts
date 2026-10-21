import "server-only";

import type { AdminContext } from "@/lib/admin/context";
import type { createClient } from "@/lib/supabase/server";

import { CONTRACT_TYPE_LABELS } from "../admin/schemas";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Option = { id: string; label: string };

/** ¿Gestiona horarios en toda la empresa o solo en algunos centros o equipos? */
function scheduleScope(ctx: AdminContext) {
  const manage = ctx.permissions.filter((p) => p.permission === "schedule.manage");
  return {
    company: manage.some((p) => p.scope_type === "company"),
    workCenters: manage.flatMap((p) =>
      p.scope_type === "work_center" && p.work_center_id ? [p.work_center_id] : [],
    ),
    teams: manage.flatMap((p) => (p.scope_type === "team" && p.team_id ? [p.team_id] : [])),
  };
}

/**
 * Opciones de los formularios de asignación. RLS ya limita lo que se ve; aquí
 * se filtran además equipos fuera del ámbito para no ofrecer lo que la base de
 * datos rechazará.
 */
export async function assignmentFormOptions(
  supabase: Supabase,
  ctx: AdminContext,
  today: string,
): Promise<{ employees: Option[]; teams: Option[]; terms: Option[]; templates: Option[] }> {
  const scope = scheduleScope(ctx);
  const [employeesRes, teamsRes, termsRes, templatesRes] = await Promise.all([
    supabase
      .from("employees")
      .select("id, first_name, last_name, employee_code, work_center_id, team_id")
      .eq("company_id", ctx.companyId)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .order("last_name")
      .limit(1000),
    supabase
      .from("teams")
      .select("id, name, work_center_id")
      .eq("company_id", ctx.companyId)
      .eq("status", "active")
      .order("name"),
    supabase
      .from("employment_terms")
      .select(
        "id, contract_type, valid_from, employee_id, employees (first_name, last_name, employee_code)",
      )
      .eq("company_id", ctx.companyId)
      .eq("status", "active")
      .or(`valid_to.is.null,valid_to.gt.${today}`)
      .order("valid_from")
      .limit(1000),
    supabase
      .from("shift_templates")
      .select("id, code, name")
      .eq("company_id", ctx.companyId)
      .eq("status", "active")
      .order("code"),
  ]);
  const inScope = (workCenterId: string | null, teamId: string | null) =>
    scope.company ||
    (workCenterId !== null && scope.workCenters.includes(workCenterId)) ||
    (teamId !== null && scope.teams.includes(teamId));
  const employees = (employeesRes.data ?? []).filter((e) => inScope(e.work_center_id, e.team_id));
  const allowedEmployees = new Set(employees.map((e) => e.id));
  return {
    employees: employees.map((e) => ({
      id: e.id,
      label: `${e.last_name}, ${e.first_name} (${e.employee_code})`,
    })),
    teams: (teamsRes.data ?? [])
      .filter((t) => inScope(t.work_center_id, t.id))
      .map((t) => ({ id: t.id, label: t.name })),
    terms: (termsRes.data ?? [])
      .filter((t) => allowedEmployees.has(t.employee_id))
      .map((t) => ({
        id: t.id,
        label: `${t.employees?.last_name ?? ""}, ${t.employees?.first_name ?? ""} (${t.employees?.employee_code ?? ""}) · ${CONTRACT_TYPE_LABELS[t.contract_type]} desde ${t.valid_from}`,
      })),
    templates: (templatesRes.data ?? []).map((t) => ({ id: t.id, label: `${t.code} · ${t.name}` })),
  };
}

/** Resumen legible de un ciclo: "L-V: M · S-D: descanso" o "14 días". */
export function cycleSummary(
  cycleDays: number,
  days: { day_index: number; template_id: string | null }[],
  codes: Record<string, string>,
): string {
  const byIndex = Array.from({ length: cycleDays }, (_, i) => {
    const id = days.find((d) => d.day_index === i)?.template_id ?? null;
    return id ? (codes[id] ?? "?") : "–";
  });
  if (cycleDays > 14) return `Ciclo de ${cycleDays} días`;
  return byIndex.join(" ");
}
