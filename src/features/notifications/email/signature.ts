import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma HMAC-SHA256 de webhooks: cabecera "t=<segundos>,v1=<hex>" sobre
 * "<t>.<cuerpo>". Se rechazan firmas fuera de una ventana de 5 minutos.
 */
export function signWebhook(secret: string, rawBody: string, timestamp: number): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

export function verifySignature(
  secret: string,
  rawBody: string,
  header: string | null,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): boolean {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.trim().split("=", 2) as [string, string]),
  );
  const t = Number(parts.t);
  const v1 = parts.v1 ?? "";
  if (
    !Number.isInteger(t) ||
    Math.abs(nowSeconds - t) > toleranceSeconds ||
    !/^[0-9a-f]{64}$/.test(v1)
  )
    return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(v1, "hex"));
}
