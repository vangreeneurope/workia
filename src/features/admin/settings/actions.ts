"use server";

import { refresh } from "next/cache";

import { dbErrorState } from "@/lib/db-errors";
import type { FormState } from "@/lib/forms";

import { adminAction, FORBIDDEN } from "../action-helpers";
import { sessionSettingsSchema } from "./schemas";

/** Duración máxima de la sesión de la empresa activa (company_id de la sesión). */
export async function saveSessionSettings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return adminAction(
    "configuracion",
    sessionSettingsSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { data: rows, error } = await supabase
        .from("companies")
        .update({ session_max_minutes: data.session_max_minutes })
        .eq("id", ctx.companyId)
        .select("id");
      if (error) return dbErrorState(error);
      // RLS filtra sin error: sin filas actualizadas es que no hay permiso.
      if (!rows || rows.length === 0) return FORBIDDEN;
      refresh();
      return {
        status: "success",
        message: `Guardado: las sesiones se cerrarán a los ${data.session_max_minutes} minutos de entrar.`,
      };
    },
  );
}
