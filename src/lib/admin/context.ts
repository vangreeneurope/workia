import "server-only";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { canUseArea, type AdminArea, type CompanyPermission } from "@/lib/admin/access";
import { getUserContext, MFA_PATH } from "@/lib/auth/dal";
import { administersCompany, mfaPending, type UserContext } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export type AdminContext = {
  user: UserContext;
  /** Empresa activa: toda operación de administración se hace sobre ella. */
  companyId: string;
  companyName: string;
  permissions: CompanyPermission[];
  groupAdmin: boolean;
};

/**
 * Contexto de administración de la empresa activa. Los permisos vienen de la
 * base de datos (my_company_permissions), que aplica las mismas reglas que RLS.
 * El company_id de cualquier escritura sale de aquí, nunca del cliente.
 */
export const getAdminContext = cache(async (): Promise<AdminContext | null> => {
  const user = await getUserContext();
  const companyId = user.activeCompanyId;
  if (!companyId) return null;
  const supabase = await createClient();
  const [permissionsRes, scheduleRes, timeRes, absenceRes, expenseRes] = await Promise.all([
    supabase.rpc("my_company_permissions", { p_company: companyId }),
    supabase.rpc("my_schedule_access", { p_company: companyId }),
    supabase.rpc("my_time_access", { p_company: companyId }),
    supabase.rpc("my_absence_access", { p_company: companyId }),
    supabase.rpc("my_expense_access", { p_company: companyId }),
  ]);
  if (
    permissionsRes.error ||
    scheduleRes.error ||
    timeRes.error ||
    absenceRes.error ||
    expenseRes.error
  ) {
    throw new Error("No se pudieron cargar tus permisos.");
  }
  const toPermissions = (
    prefix: string,
    rows: { action: string; scope_type: string; work_center_id: string; team_id: string }[] | null,
  ): CompanyPermission[] =>
    (rows ?? []).map((s) => ({
      permission: `${prefix}.${s.action}`,
      scope_type: s.scope_type,
      work_center_id: s.work_center_id,
      team_id: s.team_id,
    }));
  const schedule = [
    ...toPermissions("schedule", scheduleRes.data),
    ...toPermissions("time", timeRes.data),
    ...toPermissions("absence", absenceRes.data),
    ...toPermissions("expense", expenseRes.data),
  ];
  return {
    user,
    companyId,
    companyName: user.companies.find((c) => c.id === companyId)?.name ?? "",
    permissions: [...(permissionsRes.data ?? []), ...schedule],
    groupAdmin: administersCompany(user, companyId),
  };
});

/** Exige acceso a un área de administración; 404 si no lo hay (no revela la ruta). */
export async function requireAdminArea(area: AdminArea): Promise<AdminContext> {
  if (mfaPending(await getUserContext())) redirect(`${MFA_PATH}?motivo=verificar`);
  const ctx = await getAdminContext();
  if (!ctx || !canUseArea(area, ctx.permissions, { groupAdmin: ctx.groupAdmin })) notFound();
  return ctx;
}

/** Variante para Server Actions: devuelve null en lugar de lanzar 404. */
export async function adminAreaOrNull(area: AdminArea): Promise<AdminContext | null> {
  const ctx = await getAdminContext();
  if (!ctx || !canUseArea(area, ctx.permissions, { groupAdmin: ctx.groupAdmin })) return null;
  return ctx;
}
