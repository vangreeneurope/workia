/**
 * Cola de fichajes sin conexión. Si el envío falla por red, el fichaje se
 * guarda en el dispositivo con su clave de idempotencia y su hora declarada, y
 * se reintenta con la MISMA clave: el servidor nunca lo duplica. La hora
 * oficial será la de llegada al servidor (la del dispositivo queda declarada y,
 * si difiere más de 5 minutos, se genera una incidencia para revisarla).
 *
 * Por minimización no se guardan en el dispositivo ni ubicación ni foto.
 */

import type { PunchKind } from "./state-machine";

export const QUEUE_STORAGE_KEY = "fichajes-pendientes";
const MAX_ITEMS = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PendingPunch = {
  key: string;
  kind: PunchKind;
  deviceAt: string;
  source: "mobile" | "web";
  attempts: number;
};

export type QueueStorage = { get(): string | null; set(value: string): void };

export type SendResult =
  { type: "ok" } | { type: "rejected"; message: string } | { type: "network" };

function isPendingPunch(value: unknown): value is PendingPunch {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.key === "string" &&
    UUID_RE.test(v.key) &&
    (v.kind === "start" ||
      v.kind === "break_start" ||
      v.kind === "break_end" ||
      v.kind === "end") &&
    typeof v.deviceAt === "string" &&
    !Number.isNaN(Date.parse(v.deviceAt)) &&
    (v.source === "mobile" || v.source === "web") &&
    typeof v.attempts === "number"
  );
}

export function loadQueue(storage: QueueStorage): PendingPunch[] {
  try {
    const parsed: unknown = JSON.parse(storage.get() ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isPendingPunch).slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

export function saveQueue(storage: QueueStorage, queue: PendingPunch[]): void {
  storage.set(JSON.stringify(queue.slice(0, MAX_ITEMS)));
}

/** Añade un fichaje; si ya está su clave (doble toque), no lo repite. */
export function enqueue(queue: PendingPunch[], punch: PendingPunch): PendingPunch[] {
  if (queue.some((p) => p.key === punch.key)) return queue;
  return [...queue, punch].slice(0, MAX_ITEMS);
}

/**
 * Envía en orden. Se detiene en el primer fallo de red (el orden importa:
 * entrada antes que pausa). Un rechazo del servidor (transición imposible)
 * retira el fichaje y se informa; reintentarlo no lo arreglaría.
 */
export async function flushQueue(
  queue: PendingPunch[],
  send: (punch: PendingPunch) => Promise<SendResult>,
): Promise<{
  remaining: PendingPunch[];
  sent: PendingPunch[];
  rejected: { punch: PendingPunch; message: string }[];
}> {
  const sent: PendingPunch[] = [];
  const rejected: { punch: PendingPunch; message: string }[] = [];
  for (let i = 0; i < queue.length; i++) {
    const punch = queue[i] as PendingPunch;
    const result = await send(punch);
    if (result.type === "network") {
      const remaining = queue
        .slice(i)
        .map((p, j) => (j === 0 ? { ...p, attempts: p.attempts + 1 } : p));
      return { remaining, sent, rejected };
    }
    if (result.type === "ok") sent.push(punch);
    else rejected.push({ punch, message: result.message });
  }
  return { remaining: [], sent, rejected };
}
