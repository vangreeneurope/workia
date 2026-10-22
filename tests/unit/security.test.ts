import { describe, expect, it } from "vitest";

import { checkAttachment } from "@/features/absences/attachments";
import {
  dataRequestSchema,
  legalHoldSchema,
  supportGrantSchema,
  totpCodeSchema,
} from "@/features/security/schemas";
import { mfaPending, needsMfaStepUp } from "@/lib/auth/permissions";
import { checkPdf } from "@/lib/files/pdf";
import { isCrossSiteRequest } from "@/lib/http";
import { formatLog, redact } from "@/lib/log";

import { companyA, makeContext } from "./fixtures";

describe("registro técnico con redacción", () => {
  it("oculta claves sensibles y enmascara correos, tokens y claves en los valores", () => {
    const out = redact({
      email: "ana@empresa.example",
      full_name: "Ana",
      latitude: 40.4,
      template_version: 3,
      status: "ok",
      code: "PGRST116",
      request_id: "req-12345678",
      detail: "contacto ana@empresa.example con Bearer abcdefghijklmnop y sb_secret_abcdefghijk",
      // Token sintético montado por partes para no versionar nada con forma de JWT.
      value: ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "c2lnbmF0dXJhX2ZhbHNh"].join(
        ".",
      ),
      nested: { phone: "600000000", counts: { ok: 2 } },
    }) as Record<string, unknown>;
    expect(out.email).toBe("[redactado]");
    expect(out.full_name).toBe("[redactado]");
    expect(out.latitude).toBe("[redactado]");
    expect(out.template_version).toBe(3);
    expect(out).toMatchObject({ status: "ok", code: "PGRST116", request_id: "req-12345678" });
    expect(out.detail).toBe("contacto [correo] con Bearer [token] y [clave]");
    expect(out.value).toBe("[jwt]");
    expect(out.nested).toEqual({ phone: "[redactado]", counts: { ok: 2 } });
  });

  it("de un error solo guarda el tipo y el código (los mensajes pueden llevar datos)", () => {
    const e = Object.assign(new Error("Fallo con ana@empresa.example"), { code: "23505" });
    expect(redact(e)).toEqual({ error: "Error", code: "23505" });
  });

  it("una línea por evento, JSON, con alerta en eventos de seguridad", () => {
    const line = JSON.parse(formatLog("warn", "cron.unauthorized", { ip: "1.2.3.4" }, true));
    expect(line).toMatchObject({
      level: "warn",
      event: "cron.unauthorized",
      alert: true,
      ip: "[redactado]",
    });
    expect(JSON.parse(formatLog("info", "Nombre con espacios")).event).toBe("evento_no_valido");
  });
});

describe("MFA por rol (interfaz)", () => {
  it("solo las secciones de gestión piden el segundo factor", () => {
    const ctx = makeContext([[companyA, ["hr", "employee"]]], {
      mfa: { required: true, satisfied: false },
    });
    expect(mfaPending(ctx)).toBe(true);
    expect(needsMfaStepUp(ctx, "admin")).toBe(true);
    expect(needsMfaStepUp(ctx, "informes")).toBe(true);
    expect(needsMfaStepUp(ctx, "fichajes")).toBe(false);
    expect(needsMfaStepUp(ctx, "perfil")).toBe(false);
    const verified = { ...ctx, mfa: { required: true, satisfied: true } };
    expect(needsMfaStepUp(verified, "admin")).toBe(false);
    const employee = makeContext([[companyA, ["employee"]]]);
    expect(mfaPending(employee)).toBe(false);
  });
});

describe("descargas desde otro sitio", () => {
  const req = (site?: string) =>
    new Request("https://portal.example/informes/descargas/x", {
      headers: site ? { "sec-fetch-site": site } : {},
    });
  it("bloquea las iniciadas desde otro sitio y permite las propias o directas", () => {
    expect(isCrossSiteRequest(req("cross-site"))).toBe(true);
    expect(isCrossSiteRequest(req("same-site"))).toBe(true);
    expect(isCrossSiteRequest(req("same-origin"))).toBe(false);
    expect(isCrossSiteRequest(req("none"))).toBe(false);
    expect(isCrossSiteRequest(req())).toBe(false);
  });
});

const enc = (s: string) => new TextEncoder().encode(s);

describe("subidas maliciosas", () => {
  it("rechaza PDF con JavaScript, acciones al abrir o adjuntos, y los truncados", () => {
    expect(checkPdf(enc("%PDF-1.7\n1 0 obj << /OpenAction 2 0 R >> endobj\n%%EOF")).ok).toBe(false);
    expect(checkPdf(enc("%PDF-1.7\n<< /S /JavaScript /JS (app.alert(1)) >>\n%%EOF")).ok).toBe(
      false,
    );
    expect(checkPdf(enc("%PDF-1.7\n<< /Type /EmbeddedFile >>\n%%EOF")).ok).toBe(false);
    expect(checkPdf(enc("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj"))).toEqual({
      ok: false,
      reason: "truncated",
    });
    expect(checkPdf(enc("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF")).ok).toBe(true);
  });

  it("los justificantes también: PDF activo rechazado y PNG sin metadatos", () => {
    const pdf = checkAttachment(enc("%PDF-1.7\n<< /AA << /O 3 0 R >> >>\n%%EOF"));
    expect(pdf.ok).toBe(false);
    // PNG mínimo con un fragmento de texto (tEXt) que debe desaparecer.
    const chunk = (type: string, data: number[]) => {
      const len = data.length;
      return [
        (len >>> 24) & 255,
        (len >>> 16) & 255,
        (len >>> 8) & 255,
        len & 255,
        ...enc(type),
        ...data,
        0,
        0,
        0,
        0,
      ];
    };
    const png = Uint8Array.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
      ...chunk("tEXt", [...enc("Author\u0000Ana")]),
      ...chunk("IEND", []),
    ]);
    const out = checkAttachment(png);
    expect(out.ok).toBe(true);
    if (out.ok) expect(new TextDecoder("latin1").decode(out.bytes)).not.toContain("Ana");
  });

  it("no acepta tipos activos aunque digan ser imagen", () => {
    expect(checkAttachment(enc("<svg onload=alert(1)>")).ok).toBe(false);
    expect(checkAttachment(enc("<html><script>")).ok).toBe(false);
  });
});

describe("esquemas de seguridad y privacidad", () => {
  it("códigos TOTP de 6 dígitos", () => {
    const id = "ab000000-0000-4000-8000-000000000001";
    expect(totpCodeSchema.safeParse({ factor_id: id, code: "123456" }).success).toBe(true);
    expect(totpCodeSchema.safeParse({ factor_id: id, code: "12345a" }).success).toBe(false);
  });

  it("solicitudes, retenciones y soporte exigen motivo y límites", () => {
    expect(
      dataRequestSchema.safeParse({ kind: "erasure", idempotency_key: crypto.randomUUID() })
        .success,
    ).toBe(true);
    expect(
      dataRequestSchema.safeParse({ kind: "borrar_todo", idempotency_key: crypto.randomUUID() })
        .success,
    ).toBe(false);
    expect(legalHoldSchema.safeParse({ category: "time", reason: "corto" }).success).toBe(false);
    expect(
      supportGrantSchema.safeParse({
        support_user_id: crypto.randomUUID(),
        hours: "48",
        reason: "Incidencia 123 con importación",
      }).success,
    ).toBe(false);
    expect(
      supportGrantSchema.safeParse({
        support_user_id: crypto.randomUUID(),
        hours: "4",
        reason: "Incidencia 123 con importación",
      }).success,
    ).toBe(true);
  });
});
