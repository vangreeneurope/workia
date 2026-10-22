import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Autenticación de la tarea programada: "Authorization: Bearer <CRON_SECRET>".
 * Comparación en tiempo constante (sobre la huella, sin revelar la longitud).
 * Sin CRON_SECRET configurado, nadie puede ejecutar las tareas.
 */
export function isAuthorizedCron(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(header.slice(7)).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}
