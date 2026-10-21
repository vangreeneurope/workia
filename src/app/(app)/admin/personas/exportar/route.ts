import { type NextRequest } from "next/server";

import { getPeopleSearch, queryPeople } from "@/features/admin/people/queries";
import { employeeSituation, SITUATION_FILTERS } from "@/features/admin/people/situation";
import { canUseArea } from "@/lib/admin/access";
import { getAdminContext } from "@/lib/admin/context";
import { pickParam, uuidParam } from "@/lib/admin/pagination";
import { toCsv } from "@/lib/csv";
import { businessDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

const SITUATION_LABELS = {
  active: "En activo",
  leaving: "Baja programada",
  terminated: "Baja",
} as const;

/**
 * Exportación autorizada: mismo filtro y mismo RLS que el listado, registro en
 * audit_events (sin el texto buscado) y sin datos personales en el nombre del
 * archivo ni en la URL.
 */
export async function GET(request: NextRequest) {
  const ctx = await getAdminContext();
  if (!ctx || !canUseArea("personas", ctx.permissions, { groupAdmin: ctx.groupAdmin })) {
    return new Response("No encontrado", { status: 404 });
  }
  const params = request.nextUrl.searchParams;
  const filters = {
    situation: pickParam(params.get("situacion") ?? undefined, SITUATION_FILTERS) ?? "activas",
    workCenterId: uuidParam(params.get("centro") ?? undefined),
    teamId: uuidParam(params.get("equipo") ?? undefined),
    search: await getPeopleSearch(),
  };
  const { data, error } = await queryPeople(ctx, filters, { all: true });
  if (error) return new Response("No se pudo exportar", { status: 500 });

  const today = businessDate();
  const rows = (data ?? []).map((r) => [
    r.employee_code,
    r.first_name,
    r.last_name,
    r.work_email ?? "",
    r.work_centers?.name ?? "",
    r.teams?.name ?? "",
    SITUATION_LABELS[employeeSituation(r.end_date, today)],
    r.end_date ?? "",
  ]);

  const supabase = await createClient();
  const { error: logError } = await supabase.rpc("log_admin_event", {
    p_company: ctx.companyId,
    p_action: "export",
    p_entity: "employees",
    p_rows: rows.length,
    p_filters: {
      situation: filters.situation,
      work_center_id: filters.workCenterId ?? null,
      team_id: filters.teamId ?? null,
      format: "csv",
    },
  });
  // Sin registro de auditoría no hay exportación.
  if (logError) return new Response("No se pudo registrar la exportación", { status: 500 });

  const csv = toCsv(
    [
      "Código",
      "Nombre",
      "Apellidos",
      "Correo corporativo",
      "Centro",
      "Equipo",
      "Situación",
      "Último día",
    ],
    rows,
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="personas-${today}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
