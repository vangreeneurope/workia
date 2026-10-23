"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { requireUserId } from "@/lib/auth/dal";
import type { FormState } from "@/lib/forms";
import { log } from "@/lib/log";
import { novedadVersions } from "@/lib/ops/release";
import { createClient } from "@/lib/supabase/server";

const versionSchema = z.string().regex(/^v\d{2}\.\d{1,6}$/);

/**
 * Marca como vistas las novedades hasta `version` para la persona de la sesión.
 * Solo se aceptan versiones que este build ha publicado con novedades.
 */
export async function markNovedadesSeen(version: string): Promise<FormState> {
  const userId = await requireUserId();
  const parsed = versionSchema.safeParse(version);
  if (!parsed.success || !Object.values(novedadVersions()).includes(parsed.data)) {
    return { status: "error", message: "Versión no válida." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ last_seen_release: parsed.data })
    .eq("id", userId);
  if (error) {
    log.warn("novedades.mark_seen_failed", { code: error.code });
    return { status: "error", message: "No se pudo guardar. Inténtalo de nuevo." };
  }
  refresh();
  return { status: "success" };
}
