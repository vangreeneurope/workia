/**
 * Canal de avisos de éxito hacia el avisador global (components/layout/announcer).
 * Se anuncia desde el envoltorio de la acción, antes de que React pinte la
 * respuesta: así el aviso no se pierde si el formulario desaparece con ella.
 */

type Listener = (message: string) => void;
const listeners = new Set<Listener>();

/** Si hay un avisador montado (no en el terminal ni en las páginas públicas). */
export function hasAnnouncer(): boolean {
  return listeners.size > 0;
}

export function announce(message: string): void {
  for (const listener of listeners) listener(message);
}

export function subscribeAnnouncer(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
