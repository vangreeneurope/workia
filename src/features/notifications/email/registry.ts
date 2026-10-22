import "server-only";

import { FakeEmailProvider } from "./fake";
import type { EmailProvider } from "./types";

/**
 * Proveedor de correo configurado. No hay ningún proveedor real aprobado: sin
 * él, los avisos llegan solo a la bandeja y las entregas quedan "skipped". El
 * falso solo fuera de producción. Para activar uno real, ver docs/AVISOS.md
 * (guía): ADR, contrato, dominio verificado (EMAIL_FROM) y credenciales en el
 * servidor. No se inventan credenciales ni dominios.
 */
let fake: FakeEmailProvider | null = null;

export function getEmailProvider(): EmailProvider | null {
  if (process.env.EMAIL_PROVIDER === "fake" && process.env.NODE_ENV !== "production") {
    fake ??= new FakeEmailProvider({ webhookSecret: process.env.EMAIL_WEBHOOK_SECRET });
    return fake;
  }
  return null;
}
