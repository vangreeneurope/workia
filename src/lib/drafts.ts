/**
 * Borradores de formularios (ADR-069): lo que se escribe en los campos de texto
 * se guarda en este navegador mientras se escribe, para que no se pierda si la
 * sesión se cierra (por tiempo máximo o por la red) antes de enviarlo.
 *
 *  - Solo campos de texto, números, fechas, listas y áreas de texto con nombre.
 *    Nunca contraseñas, PIN, códigos de un solo uso ni campos marcados con
 *    `data-sin-borrador` (en el campo o en un contenedor).
 *  - Por persona (la clave lleva su id) y por formulario y pantalla.
 *  - Caducan a las 24 horas, se borran al enviar con éxito y todos los de la
 *    persona al cerrar la sesión a mano (dispositivos compartidos).
 */

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const PREFIX = "workia:borradores:";

export type Draft = {
  savedAt: number;
  fields: Record<string, string>;
  /** Enviado y sin confirmar: si se navega a otra pantalla, fue un éxito. */
  submittedAt?: number;
};
export type DraftStore = Record<string, Draft>;

const TEXT_TYPES = new Set([
  "text",
  "email",
  "number",
  "tel",
  "url",
  "search",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);
const SENSITIVE_NAME = /pass|contrase|pin|codigo|code|otp|token|secret|clave|iban|tarjeta/i;
const SENSITIVE_AUTOCOMPLETE = /one-time-code|current-password|new-password|cc-/i;

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** ¿Se puede guardar este campo como borrador? */
export function isDraftable(el: Element): el is Field {
  if (!(
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  )) {
    return false;
  }
  if (!el.name || el.name.startsWith("$ACTION") || el.disabled) return false;
  if (el instanceof HTMLInputElement && (!TEXT_TYPES.has(el.type) || el.readOnly)) return false;
  if (el instanceof HTMLTextAreaElement && el.readOnly) return false;
  if (SENSITIVE_NAME.test(el.name)) return false;
  if (SENSITIVE_AUTOCOMPLETE.test(el.getAttribute("autocomplete") ?? "")) return false;
  if (el.closest("[data-sin-borrador]")) return false;
  return true;
}

function draftableFields(form: HTMLFormElement): Field[] {
  return [...form.elements].filter(isDraftable);
}

/**
 * Identidad estable de un formulario en una pantalla: su id o etiqueta si los
 * tiene y, si no, su posición y los nombres de sus campos.
 */
export function formKey(pathname: string, form: HTMLFormElement, index: number): string {
  const label = form.id || form.getAttribute("aria-label") || form.getAttribute("name");
  const names = draftableFields(form)
    .map((f) => f.name)
    .join(",");
  return `${pathname}|${label ?? `#${index}`}|${names}`;
}

/** Valores actuales de los campos guardables (vacíos fuera). */
export function readFields(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of draftableFields(form)) {
    if (field.value !== "") out[field.name] = field.value;
  }
  return out;
}

const setters = () => ({
  input: Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set,
  textarea: Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set,
  select: Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set,
});

/**
 * Vuelca un borrador en el formulario. Usa el setter nativo y emite los eventos
 * para que los campos controlados por React también se enteren. Devuelve
 * cuántos campos ha cambiado.
 */
export function applyFields(form: HTMLFormElement, fields: Record<string, string>): number {
  const set = setters();
  let changed = 0;
  for (const field of draftableFields(form)) {
    const value = fields[field.name];
    if (value === undefined || value === field.value) continue;
    if (field instanceof HTMLSelectElement && ![...field.options].some((o) => o.value === value)) {
      continue;
    }
    const setter =
      field instanceof HTMLInputElement
        ? set.input
        : field instanceof HTMLTextAreaElement
          ? set.textarea
          : set.select;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    changed++;
  }
  return changed;
}

function storageKey(userId: string) {
  return `${PREFIX}${userId}`;
}

/** Lee los borradores vigentes de la persona (los caducados se descartan). */
export function loadDrafts(userId: string, now = Date.now()): DraftStore {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: DraftStore = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const draft = value as Partial<Draft> | null;
      if (
        draft &&
        typeof draft.savedAt === "number" &&
        now - draft.savedAt < DRAFT_TTL_MS &&
        draft.fields &&
        typeof draft.fields === "object"
      ) {
        out[key] = draft as Draft;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveDrafts(userId: string, store: DraftStore): void {
  try {
    if (Object.keys(store).length === 0) window.localStorage.removeItem(storageKey(userId));
    else window.localStorage.setItem(storageKey(userId), JSON.stringify(store));
  } catch {
    // Almacenamiento lleno o bloqueado (navegación privada): sin borradores.
  }
}

/** Borra todos los borradores guardados en este navegador (cierre de sesión). */
export function clearAllDrafts(): void {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith(PREFIX)) window.localStorage.removeItem(key);
    }
  } catch {
    // Sin acceso al almacenamiento: no hay nada que borrar.
  }
}

/** Evento que emite el cliente cuando una acción de formulario termina bien. */
export const FORM_SUCCESS_EVENT = "workia:formulario-correcto";
