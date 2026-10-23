import { describe, expect, it, vi } from "vitest";

import { NOTIFICATION_EVENTS, type NotificationEvent } from "@/features/notifications/catalog";
import { FAKE_WEBHOOK_HEADER, FakeEmailProvider } from "@/features/notifications/email/fake";
import { signWebhook, verifySignature } from "@/features/notifications/email/signature";
import { EmailProviderError, type EmailProvider } from "@/features/notifications/email/types";
import { isAuthorizedCron } from "@/features/notifications/machine-auth";
import { sendPendingEmails, type NotificationStore } from "@/features/notifications/service";
import { renderEmail, renderNotification, TEMPLATES } from "@/features/notifications/templates";
import { isMachinePath, safeRedirectPath } from "@/lib/auth/routes";

const SECRET = "s".repeat(40);

describe("plantillas", () => {
  it("hay plantilla versionada para cada evento del catálogo", () => {
    for (const event of Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[]) {
      expect(TEMPLATES[event][1]).toBeTypeOf("function");
      const r = renderNotification(event, 1, {
        company: "Empresa Alfa",
        date: "2026-10-27",
        period: "2026-09",
        count: 2,
      });
      expect(r.title.length).toBeGreaterThan(5);
      expect(r.body).toContain("Empresa Alfa");
    }
  });

  it("solo usa los parámetros permitidos: un dato sensible añadido no aparece", () => {
    const params = {
      company: "Empresa Alfa",
      date: "2026-10-27",
      type: "Baja médica",
      amount: "1.234,56 €",
      lat: 40.41,
      merchant: "Clínica",
    };
    for (const event of Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[]) {
      const email = renderEmail(event, 1, params, "https://portal.ejemplo.invalid/avisos/abc");
      const all = `${email.subject}\n${email.text}\n${email.html}`;
      expect(all).not.toMatch(/médica|1\.234|40\.41|Clínica/);
      expect(email.subject).not.toMatch(/\d{2}\/\d{2}\/\d{4}|€/);
    }
  });

  it("el correo lleva un enlace que solo identifica el aviso y escapa el HTML", () => {
    const email = renderEmail(
      "absence_submitted",
      1,
      { company: "<b>Alfa</b>", date: "2026-10-27" },
      "https://p.invalid/avisos/1",
    );
    expect(email.text).toContain("https://p.invalid/avisos/1");
    expect(email.text).toContain("no da acceso por sí solo");
    expect(email.html).toContain("&lt;b&gt;Alfa&lt;/b&gt;");
    expect(email.html).not.toContain("<b>Alfa</b>");
  });

  it("una versión desconocida usa la primera; parámetros no válidos no rompen", () => {
    expect(renderNotification("shift_changed", 99, null).title).toBe("Ha cambiado tu horario");
    expect(renderNotification("approval_overdue", 1, { count: "muchas" }).body).toContain(
      "0 solicitudes",
    );
  });
});

describe("proveedor falso y webhooks", () => {
  const signal = new AbortController().signal;
  const message = {
    to: "persona@ejemplo.invalid",
    subject: "Aviso",
    text: "t",
    html: "<p>t</p>",
    idempotencyKey: "k1",
  };

  it("deduplica por clave de idempotencia", async () => {
    const p = new FakeEmailProvider();
    const a = await p.send(message, { signal });
    const b = await p.send(message, { signal });
    expect(a.externalId).toBe(b.externalId);
    expect(p.sent.size).toBe(1);
  });

  it("simula fallos temporales y permanentes", async () => {
    const flaky = new FakeEmailProvider({ failWith: "provider_unavailable", failTimes: 1 });
    await expect(flaky.send(message, { signal })).rejects.toMatchObject({ retryable: true });
    await expect(flaky.send(message, { signal })).resolves.toBeTruthy();
    const bad = new FakeEmailProvider({ failWith: "invalid_recipient", permanent: true });
    await expect(bad.send(message, { signal })).rejects.toMatchObject({ retryable: false });
  });

  it("acepta solo webhooks con firma válida y reciente", () => {
    const p = new FakeEmailProvider({ webhookSecret: SECRET });
    const body = JSON.stringify({
      events: [
        { id: "evt-1", message_id: "fake_1", type: "bounced", occurred_at: "2026-10-27T10:00:00Z" },
      ],
    });
    const now = Math.floor(Date.now() / 1000);
    const ok = new Headers({ [FAKE_WEBHOOK_HEADER]: signWebhook(SECRET, body, now) });
    expect(p.verifyWebhook(body, ok)).toEqual([
      {
        eventId: "evt-1",
        externalId: "fake_1",
        type: "bounced",
        occurredAt: "2026-10-27T10:00:00Z",
      },
    ]);
    expect(() => p.verifyWebhook(body.replace("bounced", "delivered"), ok)).toThrow(
      EmailProviderError,
    );
    const old = new Headers({ [FAKE_WEBHOOK_HEADER]: signWebhook(SECRET, body, now - 3600) });
    expect(() => p.verifyWebhook(body, old)).toThrow(EmailProviderError);
    expect(() => new FakeEmailProvider().verifyWebhook(body, ok)).toThrow(EmailProviderError);
    expect(verifySignature(SECRET, body, "t=1,v1=zz")).toBe(false);
  });
});

/** Almacén en memoria con la misma lógica de reintentos que la base de datos. */
function memoryStore(rows: { id: string; event?: string }[]) {
  const results: { id: string; status: string; errorCode?: string; retryable?: boolean }[] = [];
  let claimed = false;
  const store: NotificationStore = {
    runReminders: vi.fn(async () => 0),
    processOutbox: vi.fn(async () => ({ processed: 0, notifications: 0, deliveries: 0 })),
    claimDeliveries: vi.fn(async () => {
      if (claimed) return [];
      claimed = true;
      return rows.map((r) => ({
        delivery_id: r.id,
        to_email: "persona@ejemplo.invalid",
        event_type: r.event ?? "absence_submitted",
        template_version: 1,
        params: { company: "Alfa", date: "2026-10-27" },
        notification_id: `n-${r.id}`,
        idempotency_key: `key-${r.id}`,
      }));
    }),
    completeDelivery: vi.fn(async (input) => {
      results.push({
        id: input.id,
        status: input.status,
        errorCode: input.errorCode,
        retryable: input.retryable,
      });
      return input.status === "failed" ? (input.retryable ? "pending" : "failed") : input.status;
    }),
  };
  return { store, results };
}

describe("envío de correos", () => {
  it("envía con la clave de idempotencia y el enlace al aviso", async () => {
    const provider = new FakeEmailProvider();
    const { store, results } = memoryStore([{ id: "d1" }]);
    const summary = await sendPendingEmails(store, provider, "https://portal.ejemplo.invalid");
    expect(summary).toMatchObject({ claimed: 1, sent: 1 });
    expect(results).toEqual([
      { id: "d1", status: "sent", errorCode: undefined, retryable: undefined },
    ]);
    expect([...provider.sent.values()][0]).toMatchObject({ idempotencyKey: "key-d1" });
  });

  it("un fallo temporal se reintenta más tarde y no afecta a los demás", async () => {
    const provider = new FakeEmailProvider({ failWith: "provider_unavailable", failTimes: 1 });
    const { store, results } = memoryStore([{ id: "d1" }, { id: "d2" }]);
    const summary = await sendPendingEmails(store, provider, "https://portal.ejemplo.invalid");
    expect(summary).toMatchObject({ retrying: 1, sent: 1 });
    expect(results[0]).toMatchObject({
      status: "failed",
      errorCode: "provider_unavailable",
      retryable: true,
    });
  });

  it("un rechazo permanente no se reintenta; tiempo agotado sí", async () => {
    const bad = memoryStore([{ id: "d1" }]);
    await sendPendingEmails(
      bad.store,
      new FakeEmailProvider({ failWith: "invalid_recipient", permanent: true }),
      "https://p.invalid",
    );
    expect(bad.results[0]).toMatchObject({ errorCode: "invalid_recipient", retryable: false });
    const slow: EmailProvider = {
      id: "lento",
      send: () => new Promise(() => {}),
      verifyWebhook: () => [],
    };
    const timeout = memoryStore([{ id: "d2" }]);
    await sendPendingEmails(timeout.store, slow, "https://p.invalid", { timeoutMs: 20 });
    expect(timeout.results[0]).toMatchObject({ errorCode: "timeout", retryable: true });
  });

  it("sin proveedor aprobado no se envía nada y queda registrado", async () => {
    const { store, results } = memoryStore([{ id: "d1" }]);
    await sendPendingEmails(store, null, "https://p.invalid");
    expect(results[0]).toMatchObject({ status: "skipped", errorCode: "no_provider" });
  });
});

describe("rutas de máquina", () => {
  it("la tarea programada exige el secreto exacto", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
    expect(isAuthorizedCron("Bearer corto", "corto")).toBe(false);
    expect(isAuthorizedCron(`Bearer ${SECRET}`, undefined)).toBe(false);
  });

  it("solo esas dos rutas evitan el acceso y nunca son destino de redirección", () => {
    expect(isMachinePath("/api/tareas")).toBe(true);
    expect(isMachinePath("/api/correo/webhook")).toBe(true);
    expect(isMachinePath("/api/tareas/otra")).toBe(false);
    expect(isMachinePath("/api/salud/listo")).toBe(true);
    expect(isMachinePath("/api/salud/otra")).toBe(false);
    expect(safeRedirectPath("/api/tareas")).toBe("/panel");
  });
});
