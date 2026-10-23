/**
 * Máquina de estados de la jornada. Es la misma tabla que
 * private.punch_transition() en la base de datos, que es la que decide; aquí
 * sirve para mostrar solo las acciones posibles.
 */

export type PunchKind = "start" | "break_start" | "break_end" | "end";
export type EntryState = "open" | "on_break" | "closed" | "incomplete";
/** Estado "sin jornada abierta" (null en la base de datos). */
export type CurrentState = "open" | "on_break" | null;

export const PUNCH_KINDS: readonly PunchKind[] = ["start", "break_start", "break_end", "end"];

export const PUNCH_LABELS: Record<PunchKind, string> = {
  start: "Entrada",
  break_start: "Pausa",
  break_end: "Reanudar",
  end: "Salida",
};

export const ENTRY_STATE_LABELS: Record<EntryState, string> = {
  open: "Trabajando",
  on_break: "En pausa",
  closed: "Cerrada",
  incomplete: "Incompleta",
};

export function transition(state: CurrentState, kind: PunchKind): EntryState | null {
  if (state === null && kind === "start") return "open";
  if (state === "open" && kind === "break_start") return "on_break";
  if (state === "open" && kind === "end") return "closed";
  if (state === "on_break" && kind === "break_end") return "open";
  return null;
}

export function allowedPunches(state: CurrentState): PunchKind[] {
  return PUNCH_KINDS.filter((k) => transition(state, k) !== null);
}

/** Estado actual tras aplicar una secuencia (null si alguna transición es imposible). */
export function replay(kinds: PunchKind[]): CurrentState | "closed" | "invalid" {
  let state: CurrentState | "closed" = null;
  for (const kind of kinds) {
    if (state === "closed") return "invalid";
    const next = transition(state, kind);
    if (next === null) return "invalid";
    state = next === "closed" ? "closed" : (next as CurrentState);
  }
  return state;
}
