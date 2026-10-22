"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { adminAction, FORBIDDEN } from "@/features/admin/action-helpers";
import { getUserContext } from "@/lib/auth/dal";
import { dbErrorState } from "@/lib/db-errors";
import type { FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

import { NOTIFICATION_EVENTS, type NotificationEvent } from "./catalog";

/* Identidad desde la sesión; empresa, la activa. RLS decide qué avisos son tuyos. */

export async function markAllRead(): Promise<FormState> {
  const ctx = await getUserContext();
  if (!ctx.activeCompanyId) return FORBIDDEN;
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_notifications_read", {
    p_company: ctx.activeCompanyId,
  });
  if (error) return dbErrorState(error);
  refresh();
  return { status: "success", message: "Todos los avisos marcados como leídos." };
}

export async function savePreferences(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getUserContext();
  if (!ctx.activeCompanyId) return FORBIDDEN;
  const supabase = await createClient();
  const optional = (Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[]).filter(
    (e) => !NOTIFICATION_EVENTS[e].mandatory,
  );
  const rows = optional.map((event_type) => ({
    company_id: ctx.activeCompanyId as string,
    user_id: ctx.userId,
    event_type,
    channel: "email",
    enabled: formData.get(`email_${event_type}`) === "on",
  }));
  const { error } = await supabase
    .from("notification_preferences")
    .upsert(rows, { onConflict: "company_id,user_id,event_type,channel" });
  if (error) return dbErrorState(error);
  refresh();
  return { status: "success", message: "Preferencias guardadas." };
}

export async function retryDelivery(id: string): Promise<FormState> {
  return adminAction("avisos", z.object({ id: z.uuid() }), { id }, async ({ data, supabase }) => {
    const { error } = await supabase.rpc("retry_email_delivery", { p_delivery: data.id });
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success", message: "La entrega vuelve a la cola." };
  });
}
