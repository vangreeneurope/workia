import "server-only";

import { cache } from "react";

import { getUserContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/** Accesos de gastos del usuario en la empresa activa. */
export const getExpenseAccess = cache(async (): Promise<{ read: boolean; manage: boolean }> => {
  const ctx = await getUserContext();
  if (!ctx.activeCompanyId) return { read: false, manage: false };
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_expense_access", { p_company: ctx.activeCompanyId });
  const actions = new Set((data ?? []).map((a) => a.action));
  return { read: actions.has("read") || ctx.supervisedCount > 0, manage: actions.has("manage") };
});
