import { isNotificationEvent } from "./catalog";
import { EmailProviderError, type EmailErrorCode, type EmailProvider } from "./email/types";
import { renderEmail } from "./templates";

/** Operaciones de base de datos que necesita el servicio (con la clave de servicio). */
export type NotificationStore = {
  runReminders(now: Date): Promise<number>;
  processOutbox(
    limit: number,
  ): Promise<{ processed: number; notifications: number; deliveries: number }>;
  claimDeliveries(limit: number): Promise<
    {
      delivery_id: string;
      to_email: string;
      event_type: string;
      template_version: number;
      params: unknown;
      notification_id: string;
      idempotency_key: string;
    }[]
  >;
  completeDelivery(input: {
    id: string;
    status: "sent" | "failed" | "skipped";
    provider?: string;
    externalId?: string;
    errorCode?: string;
    retryable?: boolean;
  }): Promise<string | null>;
};

export type SendSummary = {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  skipped: number;
};

/**
 * Envía los correos pendientes. Cada correo se procesa por separado: un fallo
 * del proveedor se registra (con código, sin contenido) y se reintenta más
 * tarde sin afectar a los demás ni a la operación que originó el aviso.
 */
export async function sendPendingEmails(
  store: NotificationStore,
  provider: EmailProvider | null,
  siteUrl: string,
  options: { batch?: number; timeoutMs?: number } = {},
): Promise<SendSummary> {
  const summary: SendSummary = { claimed: 0, sent: 0, retrying: 0, failed: 0, skipped: 0 };
  const rows = await store.claimDeliveries(options.batch ?? 50);
  summary.claimed = rows.length;
  for (const row of rows) {
    if (!provider || !isNotificationEvent(row.event_type)) {
      await store.completeDelivery({
        id: row.delivery_id,
        status: "skipped",
        errorCode: provider ? "unknown_template" : "no_provider",
      });
      summary.skipped += 1;
      continue;
    }
    const link = new URL(`/avisos/${row.notification_id}`, siteUrl).toString();
    const content = renderEmail(row.event_type, row.template_version, row.params, link);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
    try {
      const result = await Promise.race([
        provider.send(
          { to: row.to_email, ...content, idempotencyKey: row.idempotency_key },
          { signal: controller.signal },
        ),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener("abort", () =>
            reject(new EmailProviderError("timeout", true)),
          ),
        ),
      ]);
      await store.completeDelivery({
        id: row.delivery_id,
        status: "sent",
        provider: provider.id,
        externalId: result.externalId,
      });
      summary.sent += 1;
    } catch (error) {
      const code: EmailErrorCode =
        error instanceof EmailProviderError ? error.code : "internal_error";
      const retryable = error instanceof EmailProviderError ? error.retryable : true;
      const status = await store.completeDelivery({
        id: row.delivery_id,
        status: "failed",
        provider: provider.id,
        errorCode: code,
        retryable,
      });
      if (status === "pending") summary.retrying += 1;
      else summary.failed += 1;
    } finally {
      clearTimeout(timer);
    }
  }
  return summary;
}
