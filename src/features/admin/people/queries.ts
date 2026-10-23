import "server-only";

import { cookies } from "next/headers";

import type { AdminContext } from "@/lib/admin/context";
import { pageRange } from "@/lib/admin/pagination";
import { businessDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

import { sanitizeSearch, type SituationFilter } from "./situation";

/** Cookie con el texto de búsqueda: así no aparece en URLs ni en registros de acceso. */
export const PEOPLE_SEARCH_COOKIE = "busqueda_personas";

export async function getPeopleSearch(): Promise<string> {
  const store = await cookies();
  return sanitizeSearch(store.get(PEOPLE_SEARCH_COOKIE)?.value);
}

export type PeopleFilters = {
  situation: SituationFilter;
  workCenterId?: string;
  teamId?: string;
  search: string;
};

const LIST_COLUMNS =
  "id, employee_code, first_name, last_name, work_email, end_date, status, work_centers (name), teams (name)";

/** Consulta de personas con filtros en servidor. RLS limita a lo que el usuario puede ver. */
export async function queryPeople(
  ctx: AdminContext,
  filters: PeopleFilters,
  range: { page: number } | { all: true },
) {
  const supabase = await createClient();
  const today = businessDate();
  let query = supabase
    .from("employees")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("company_id", ctx.companyId);

  if (filters.situation === "activas") query = query.or(`end_date.is.null,end_date.gte.${today}`);
  if (filters.situation === "baja") query = query.lt("end_date", today);
  if (filters.workCenterId) query = query.eq("work_center_id", filters.workCenterId);
  if (filters.teamId) query = query.eq("team_id", filters.teamId);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.or(
      `employee_code.ilike."${term}",first_name.ilike."${term}",last_name.ilike."${term}"`,
    );
  }
  query = query.order("last_name").order("first_name");

  if ("all" in range) return query.limit(5000);
  const [from, to] = pageRange(range.page);
  return query.range(from, to);
}

export async function organizationOptions(ctx: AdminContext) {
  const supabase = await createClient();
  const [centers, teams] = await Promise.all([
    supabase
      .from("work_centers")
      .select("id, name, code, status")
      .eq("company_id", ctx.companyId)
      .order("name"),
    supabase
      .from("teams")
      .select("id, name, status, work_center_id")
      .eq("company_id", ctx.companyId)
      .order("name"),
  ]);
  return { workCenters: centers.data ?? [], teams: teams.data ?? [] };
}
