import { unstable_rethrow } from "next/navigation";

import { announce, hasAnnouncer } from "./announcer";
import { FORM_SUCCESS_EVENT } from "./drafts";
import type { FormState } from "./forms";

/**
 * Un éxito con mensaje se anuncia en el avisador global (si lo hay) y todo
 * éxito borra el borrador del formulario enviado (src/lib/drafts.ts).
 */
function announceSuccess<S extends FormState>(result: S): S {
  if (result.status === "success" && result.message && hasAnnouncer()) announce(result.message);
  if (result.status === "success" && typeof window !== "undefined") {
    window.dispatchEvent(new Event(FORM_SUCCESS_EVENT));
  }
  return result;
}

export const NETWORK_ERROR_MESSAGE =
  "No se ha podido confirmar el envío con el servidor. Comprueba la conexión, revisa si el cambio aparece y vuelve a intentarlo.";

/**
 * Envuelve una Server Action de formulario para que un fallo de red (o una
 * respuesta 5xx) se muestre como error en el propio formulario, sin perder lo
 * escrito ni saltar a la página de error; un éxito se anuncia en el avisador global. Nunca simula éxito; las redirecciones
 * y `notFound()` de Next.js siguen su curso. Las acciones con clave de
 * idempotencia pueden reintentarse sin duplicar.
 */
export function networkSafe<S extends FormState>(
  action: (prev: S, formData: FormData) => Promise<S>,
): (prev: S, formData: FormData) => Promise<S> {
  return async (prev, formData) => {
    try {
      return announceSuccess(await action(prev, formData));
    } catch (error) {
      unstable_rethrow(error);
      return { status: "error", message: NETWORK_ERROR_MESSAGE } as S;
    }
  };
}

/** Igual que `networkSafe`, para llamadas sueltas a una acción (botones). */
export async function safeCall<S extends FormState>(call: () => Promise<S>): Promise<S> {
  try {
    return announceSuccess(await call());
  } catch (error) {
    unstable_rethrow(error);
    return { status: "error", message: NETWORK_ERROR_MESSAGE } as S;
  }
}
