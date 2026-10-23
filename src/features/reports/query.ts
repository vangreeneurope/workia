import "server-only";

import type { createClient } from "@/lib/supabase/server";

import type { ReportKey } from "./catalog";
import type { ReportFilters } from "./filters";
import { mapRow, type ReportRow } from "./rows";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type ReportPage = { rows: ReportRow[]; total: number; failed: boolean };

/** Filas por página en pantalla y por lote al exportar (máximo de la base de datos: 500). */
export const SCREEN_PAGE_SIZE = 50;
export const EXPORT_BATCH_SIZE = 500;

/**
 * Una página de un informe, con la sesión del usuario: las funciones de la base
 * de datos aplican los permisos y devuelven ya los totales calculados. La
 * empresa sale siempre de la empresa activa del servidor, nunca de la URL.
 */
export async function fetchReport(
  supabase: Supabase,
  companyId: string,
  key: ReportKey,
  f: ReportFilters,
  limit: number,
  offset: number,
): Promise<ReportPage> {
  const people = {
    p_employee: f.employee ?? undefined,
    p_team: f.team ?? undefined,
    p_center: f.center ?? undefined,
  };
  const page = { p_limit: limit, p_offset: offset };
  const range = { p_company: companyId, p_from: f.from, p_to: f.to };
  const res = await (() => {
    switch (key) {
      case "time_daily":
        return supabase.rpc("report_time_daily", { ...range, ...people, ...page });
      case "time_summary":
        return supabase.rpc("report_time_summary", { ...range, ...people, ...page });
      case "time_register":
        return supabase.rpc("report_time_register", { ...range, ...people, ...page });
      case "absence_balances":
        return supabase.rpc("report_absence_balances", {
          p_company: companyId,
          p_day: f.day,
          ...people,
          ...page,
        });
      case "absence_requests":
        return supabase.rpc("report_absence_requests", { ...range, ...people, ...page });
      case "expenses":
        return supabase.rpc("report_expenses", {
          ...range,
          p_group: f.group,
          ...people,
          p_client: f.client ?? undefined,
          p_project: f.project ?? undefined,
          ...page,
        });
      case "approvals":
        return supabase.rpc("report_approvals", range);
      case "closures":
        return supabase.rpc("report_closures", range);
      case "audit":
        return supabase.rpc("report_audit", {
          ...range,
          p_actor: f.actor ?? undefined,
          p_entity: f.entity ?? undefined,
          p_entity_id: f.object ?? undefined,
          p_action: f.action ?? undefined,
          ...page,
        });
    }
  })();
  if (res.error) return { rows: [], total: 0, failed: true };
  const data = (res.data ?? []) as Record<string, unknown>[];
  const first = data[0];
  const total = first && typeof first.total_count === "number" ? first.total_count : data.length;
  return { rows: data.map((r) => mapRow(key, r)), total, failed: false };
}
