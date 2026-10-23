import "server-only";

import { cache } from "react";

import { getUserContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/** Accesos de gastos del usuario en la empresa activa. */
export const getExpenseAccess = cache(
  async (): Promise<{
    read: boolean;
    manage: boolean;
    approve: boolean;
    accounting: boolean;
    close: boolean;
    pendingApprovals: number;
  }> => {
    const ctx = await getUserContext();
    const none = {
      read: false,
      manage: false,
      approve: false,
      accounting: false,
      close: false,
      pendingApprovals: 0,
    };
    if (!ctx.activeCompanyId) return none;
    const supabase = await createClient();
    const [accessRes, pendingRes] = await Promise.all([
      supabase.rpc("my_expense_access", { p_company: ctx.activeCompanyId }),
      supabase.rpc("my_pending_expense_approvals", { p_company: ctx.activeCompanyId }),
    ]);
    const rows = accessRes.data ?? [];
    const actions = new Set(rows.map((a) => a.action));
    // La consola contable es de toda la empresa: solo con lectura a nivel de empresa.
    const companyRead = rows.some((a) => a.action === "read" && a.scope_type === "company");
    return {
      read: actions.has("read") || ctx.supervisedCount > 0,
      manage: actions.has("manage"),
      approve:
        actions.has("approve") || ctx.supervisedCount > 0 || (pendingRes.data?.length ?? 0) > 0,
      accounting:
        companyRead || rows.some((a) => a.action === "close" && a.scope_type === "company"),
      close: rows.some((a) => a.action === "close" && a.scope_type === "company"),
      pendingApprovals: pendingRes.data?.length ?? 0,
    };
  },
);
