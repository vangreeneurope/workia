import "server-only";

import { cache } from "react";

import { getUserContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/** Accesos de ausencias del usuario en la empresa activa. */
export const getAbsenceAccess = cache(
  async (): Promise<{ review: boolean; manage: boolean; attachments: boolean }> => {
    const ctx = await getUserContext();
    if (!ctx.activeCompanyId) return { review: false, manage: false, attachments: false };
    const supabase = await createClient();
    const { data } = await supabase.rpc("my_absence_access", { p_company: ctx.activeCompanyId });
    const actions = new Set((data ?? []).map((a) => a.action));
    return {
      review: actions.has("read") || ctx.supervisedCount > 0,
      manage: actions.has("manage"),
      attachments: actions.has("attachments"),
    };
  },
);
