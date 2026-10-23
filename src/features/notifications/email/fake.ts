import { createHash } from "node:crypto";

import { verifySignature } from "./signature";
import {
  EmailProviderError,
  type EmailErrorCode,
  type EmailMessage,
  type EmailProvider,
  type WebhookEvent,
} from "./types";

export const FAKE_WEBHOOK_HEADER = "x-correo-firma";

type Sent = { externalId: string; to: string; subject: string; idempotencyKey: string };

/**
 * Proveedor falso para desarrollo y pruebas: no envía nada. Guarda en memoria
 * lo "enviado" (deduplicando por clave de idempotencia, como un proveedor
 * real) y puede simular fallos. Nunca se activa en producción.
 */
export class FakeEmailProvider implements EmailProvider {
  readonly id = "fake";
  readonly sent = new Map<string, Sent>();
  private calls = 0;

  constructor(
    private readonly options: {
      webhookSecret?: string;
      failWith?: EmailErrorCode;
      failTimes?: number;
      permanent?: boolean;
    } = {},
  ) {}

  async send(
    message: EmailMessage,
    { signal }: { signal: AbortSignal },
  ): Promise<{ externalId: string }> {
    if (signal.aborted) throw new EmailProviderError("timeout", true);
    this.calls += 1;
    if (
      this.options.failWith &&
      (!this.options.failTimes || this.calls <= this.options.failTimes)
    ) {
      throw new EmailProviderError(this.options.failWith, !this.options.permanent);
    }
    const existing = this.sent.get(message.idempotencyKey);
    if (existing) return { externalId: existing.externalId };
    const externalId = `fake_${createHash("sha256").update(message.idempotencyKey).digest("hex").slice(0, 24)}`;
    this.sent.set(message.idempotencyKey, {
      externalId,
      to: message.to,
      subject: message.subject,
      idempotencyKey: message.idempotencyKey,
    });
    return { externalId };
  }

  verifyWebhook(rawBody: string, headers: Headers): WebhookEvent[] {
    if (
      !verifySignature(this.options.webhookSecret ?? "", rawBody, headers.get(FAKE_WEBHOOK_HEADER))
    ) {
      throw new EmailProviderError("invalid_signature", false);
    }
    const parsed: unknown = JSON.parse(rawBody);
    const events = (parsed as { events?: unknown }).events;
    if (!Array.isArray(events)) throw new EmailProviderError("invalid_signature", false);
    return events.flatMap((e: unknown) => {
      const ev = e as Record<string, unknown>;
      const type = ev.type;
      if (
        typeof ev.id !== "string" ||
        typeof ev.message_id !== "string" ||
        typeof ev.occurred_at !== "string" ||
        (type !== "delivered" && type !== "bounced" && type !== "complained" && type !== "deferred")
      )
        return [];
      return [{ eventId: ev.id, externalId: ev.message_id, type, occurredAt: ev.occurred_at }];
    });
  }
}
