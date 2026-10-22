import "server-only";

import type { z } from "zod";

import type { AdminArea } from "@/lib/admin/access";
import { adminAreaOrNull, type AdminContext } from "@/lib/admin/context";
import { getUserContext } from "@/lib/auth/dal";
import { mfaPending } from "@/lib/auth/permissions";
import { formToObject, validate, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

export const FORBIDDEN: FormState = {
  status: "error",
  message: "No tienes permiso para esta operación.",
};

export const MFA_REQUIRED: FormState = {
  status: "error",
  message:
    "Verifica tu identidad con el segundo factor (Mi perfil › Seguridad) para usar tus permisos.",
};

type RunArgs<T> = {
  ctx: AdminContext;
  data: T;
  supabase: Awaited<ReturnType<typeof createClient>>;
};

/**
 * Esqueleto de toda Server Action de administración:
 *  1. autoriza el área con la sesión del usuario (getAdminContext),
 *  2. valida con el esquema compartido,
 *  3. ejecuta con el cliente del usuario (RLS siempre activo).
 * El company_id lo aporta ctx.companyId, nunca el formulario.
 */
export async function adminAction<S extends z.ZodType>(
  area: AdminArea,
  schema: S,
  input: FormData | Record<string, unknown>,
  run: (args: RunArgs<z.infer<S>>) => Promise<FormState>,
): Promise<FormState> {
  if (mfaPending(await getUserContext())) return MFA_REQUIRED;
  const ctx = await adminAreaOrNull(area);
  if (!ctx) return FORBIDDEN;
  const result = validate(schema, input instanceof FormData ? formToObject(input) : input);
  if (!result.ok) return result.state;
  const supabase = await createClient();
  return run({ ctx, data: result.data, supabase });
}
