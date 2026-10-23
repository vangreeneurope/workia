import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import type { NotificationStore } from "./service";

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

/** Operaciones de avisos con la clave de servicio (solo tareas programadas, ADR-048). */
export function supabaseNotificationStore(admin: Admin): NotificationStore {
  return {
    async runReminders(now) {
      const { data, error } = await admin.rpc("run_scheduled_reminders", {
        p_now: now.toISOString(),
      });
      if (error) throw new Error("run_scheduled_reminders");
      return data ?? 0;
    },
    async processOutbox(limit) {
      const { data, error } = await admin.rpc("process_notification_outbox", { p_limit: limit });
      if (error) throw new Error("process_notification_outbox");
      const row = data?.[0];
      return {
        processed: row?.processed ?? 0,
        notifications: row?.notifications ?? 0,
        deliveries: row?.deliveries ?? 0,
      };
    },
    async claimDeliveries(limit) {
      const { data, error } = await admin.rpc("claim_email_deliveries", { p_limit: limit });
      if (error) throw new Error("claim_email_deliveries");
      return data ?? [];
    },
    async completeDelivery(input) {
      const { data, error } = await admin.rpc("complete_email_delivery", {
        p_delivery: input.id,
        p_status: input.status,
        p_provider: input.provider,
        p_external_id: input.externalId,
        p_error_code: input.errorCode,
        p_retryable: input.retryable ?? false,
      });
      if (error) throw new Error("complete_email_delivery");
      return data;
    },
  };
}
