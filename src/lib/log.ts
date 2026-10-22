/**
 * Registro técnico estructurado (una línea JSON por evento) con redacción.
 *
 * Reglas (docs/SEGURIDAD.md, § 7):
 *  - Se registran códigos y recuentos, nunca contenido: ni nombres, correos,
 *    teléfonos, NIF, coordenadas, textos de tickets o motivos, ni tokens,
 *    cookies, claves o cabeceras de autorización.
 *  - Aun así, todo campo pasa por `redact`: las claves sensibles se sustituyen y
 *    los valores con forma de correo, JWT, token o clave se enmascaran.
 *  - Cada evento lleva `request_id` cuando se conoce (lo pone la petición) para
 *    correlacionarlo con `audit_events.request_id`.
 *  - `security` marca eventos que deben generar alerta (alert: true).
 *
 * Nivel mínimo con LOG_LEVEL (debug, info, warn, error); por defecto, info.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Partes de nombre de campo (separadas por _, -, . o mayúscula) que indican contenido sensible.
const SENSITIVE_PARTS = new Set([
  "password",
  "pass",
  "secret",
  "token",
  "authorization",
  "auth",
  "cookie",
  "cookies",
  "apikey",
  "key",
  "session",
  "jwt",
  "pin",
  "email",
  "correo",
  "mail",
  "phone",
  "telefono",
  "name",
  "nombre",
  "names",
  "tax",
  "nif",
  "dni",
  "iban",
  "address",
  "direccion",
  "lat",
  "latitude",
  "lon",
  "lng",
  "longitude",
  "selfie",
  "note",
  "notes",
  "nota",
  "reason",
  "motivo",
  "comment",
  "comments",
  "details",
  "body",
  "content",
  "text",
  "message",
  "merchant",
  "headers",
  "ip",
]);
const SAFE_KEYS = new Set(["request_id", "code", "error_code", "status", "count", "event"]);

function sensitiveKey(key: string): boolean {
  if (SAFE_KEYS.has(key.toLowerCase())) return false;
  return key.split(/[_\-.]|(?=[A-Z])/).some((part) => SENSITIVE_PARTS.has(part.toLowerCase()));
}

const VALUE_PATTERNS: [RegExp, string][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[correo]"],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[jwt]"],
  [/\b(sb_(secret|publishable)_[A-Za-z0-9_-]{8,})\b/g, "[clave]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [token]"],
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, "[iban]"],
  [/\b\d{8}[A-Z]\b/g, "[documento]"],
];

const MAX_STRING = 300;
const MAX_DEPTH = 4;

/** Copia sin datos sensibles (pura; probada en tests/unit/log.test.ts). */
export function redact(value: unknown, depth = 0, key = ""): unknown {
  if (key && sensitiveKey(key)) {
    return value === null || value === undefined ? value : "[redactado]";
  }
  if (typeof value === "string") {
    let out = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
    for (const [re, mask] of VALUE_PATTERNS) out = out.replace(re, mask);
    return out;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return value;
  }
  if (value instanceof Error) {
    // Solo el tipo y un código: los mensajes pueden contener datos.
    const code = (value as Error & { code?: unknown }).code;
    return { error: value.name, ...(typeof code === "string" ? { code } : {}) };
  }
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Fields = {};
    for (const [k, v] of Object.entries(value as Fields).slice(0, 30))
      out[k] = redact(v, depth + 1, k);
    return out;
  }
  return "[no serializable]";
}

function threshold(): number {
  const level = (process.env.LOG_LEVEL ?? "info") as LogLevel;
  return ORDER[level] ?? ORDER.info;
}

/** Línea de registro ya redactada (exportada para pruebas). */
export function formatLog(
  level: LogLevel,
  event: string,
  fields: Fields = {},
  alert = false,
): string {
  const safeEvent = /^[a-z0-9_.-]{1,80}$/.test(event) ? event : "evento_no_valido";
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event: safeEvent,
    ...(alert ? { alert: true } : {}),
    ...(redact(fields) as Fields),
  });
}

function write(level: LogLevel, event: string, fields?: Fields, alert = false) {
  if (ORDER[level] < threshold()) return;
  const line = formatLog(level, event, fields, alert);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else process.stdout.write(`${line}\n`);
}

export const log = {
  debug: (event: string, fields?: Fields) => write("debug", event, fields),
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
  /** Evento de seguridad que debe disparar una alerta (docs/RUNBOOKS.md). */
  security: (event: string, fields?: Fields) => write("warn", event, fields, true),
};
