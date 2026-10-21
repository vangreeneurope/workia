import "server-only";

import { cache } from "react";

import { getUserContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

import type { CurrentState } from "./state-machine";

export type TimeStatus = {
  employeeId: string;
  timeZone: string;
  entryId: string | null;
  state: CurrentState;
  startedAt: string | null;
  locationMode: "off" | "optional" | "required";
  locationNotice: string | null;
  selfieEnabled: boolean;
  hasKioskPin: boolean;
};

/** Estado de fichaje de la propia persona en la empresa activa (null si no es empleada). */
export const getMyTimeStatus = cache(async (): Promise<TimeStatus | null> => {
  const ctx = await getUserContext();
  if (!ctx.activeCompanyId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_time_status", { p_company: ctx.activeCompanyId });
  if (error) throw new Error("No se pudo cargar tu estado de fichaje.");
  const row = data?.[0];
  if (!row?.employee_id) return null;
  return {
    employeeId: row.employee_id,
    timeZone: row.time_zone,
    entryId: row.entry_id ?? null,
    state: row.entry_status === "open" || row.entry_status === "on_break" ? row.entry_status : null,
    startedAt: row.started_at ?? null,
    locationMode: row.location_mode,
    locationNotice: row.location_notice ?? null,
    selfieEnabled: row.selfie_enabled,
    hasKioskPin: row.has_kiosk_pin,
  };
});

/** ¿Revisa fichajes de otras personas? (manager con supervisados o permiso de lectura). */
export const getReviewAccess = cache(async (): Promise<{ read: boolean; manage: boolean }> => {
  const ctx = await getUserContext();
  if (!ctx.activeCompanyId) return { read: false, manage: false };
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_time_access", { p_company: ctx.activeCompanyId });
  const actions = new Set((data ?? []).map((a) => a.action));
  return { read: actions.has("read") || ctx.supervisedCount > 0, manage: actions.has("manage") };
});
