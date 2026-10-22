import "server-only";

import type { createClient } from "@/lib/supabase/server";

import type { ReportDef } from "./catalog";
import type { FilterOptions } from "./components/report-filters";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Opciones como mucho: un selector más largo no es usable (para eso está el filtro de equipo o centro). */
export const OPTIONS_LIMIT = 500;

/**
 * Opciones de los selectores de filtro con la sesión del usuario: cada lista
 * contiene solo lo que RLS le deja ver (sus personas, equipos y centros).
 */
export async function loadFilterOptions(
  supabase: Supabase,
  companyId: string,
  def: ReportDef,
): Promise<FilterOptions> {
  const has = (k: ReportDef["filters"][number]) => def.filters.includes(k);
  const [employees, teams, centers, actors] = await Promise.all([
    has("employee")
      ? supabase
          .from("employees")
          .select("id, employee_code, first_name, last_name")
          .eq("company_id", companyId)
          .order("employee_code")
          .limit(OPTIONS_LIMIT)
      : null,
    has("team")
      ? supabase
          .from("teams")
          .select("id, name")
          .eq("company_id", companyId)
          .order("name")
          .limit(OPTIONS_LIMIT)
      : null,
    has("center")
      ? supabase
          .from("work_centers")
          .select("id, name")
          .eq("company_id", companyId)
          .order("name")
          .limit(OPTIONS_LIMIT)
      : null,
    has("actor")
      ? supabase
          .from("company_memberships")
          .select("user_id, profiles (full_name)")
          .eq("company_id", companyId)
          .limit(OPTIONS_LIMIT)
      : null,
  ]);
  return {
    employees: (employees?.data ?? []).map((e) => ({
      value: e.id,
      label: `${e.employee_code} · ${e.last_name}, ${e.first_name}`,
    })),
    teams: (teams?.data ?? []).map((t) => ({ value: t.id, label: t.name })),
    centers: (centers?.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    actors: (actors?.data ?? [])
      .map((m) => ({ value: m.user_id, label: m.profiles?.full_name || m.user_id.slice(0, 8) }))
      .sort((a, b) => a.label.localeCompare(b.label, "es")),
  };
}
