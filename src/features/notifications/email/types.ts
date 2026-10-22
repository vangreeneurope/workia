/**
 * Contrato de cualquier proveedor de correo. La aplicación entrega el mensaje ya
 * renderizado y una clave de idempotencia (el proveedor debe deduplicar con
 * ella); el proveedor devuelve su id externo. Los webhooks de entrega se
 * verifican con firma antes de aceptar ningún evento.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
};

export type WebhookEvent = {
  eventId: string;
  externalId: string;
  type: "delivered" | "bounced" | "complained" | "deferred";
  occurredAt: string;
};

export interface EmailProvider {
  readonly id: string;
  send(message: EmailMessage, options: { signal: AbortSignal }): Promise<{ externalId: string }>;
  /** Verifica la firma y devuelve los eventos; lanza si la firma no es válida. */
  verifyWebhook(rawBody: string, headers: Headers): WebhookEvent[];
}

export type EmailErrorCode =
  | "provider_unavailable"
  | "rate_limited"
  | "timeout"
  | "invalid_recipient"
  | "rejected"
  | "invalid_signature"
  | "internal_error";

export class EmailProviderError extends Error {
  constructor(
    readonly code: EmailErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "EmailProviderError";
  }
}
