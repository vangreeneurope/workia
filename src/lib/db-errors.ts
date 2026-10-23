import type { FormState } from "@/lib/forms";

type DbError = { code?: string; message?: string; hint?: string | null; details?: string | null };

const APPROVER_MESSAGES: Record<string, string> = {
  APROBADOR_NO_ASIGNADO:
    "No hay ningún manager vigente para este tipo de solicitud. Asigna uno a la persona o a su equipo.",
  APROBADOR_INACTIVO:
    "El manager asignado ya no tiene una cuenta vigente. Asigna otro manager o registra una suplencia.",
  APROBADOR_AUTOAPROBACION:
    "La persona sería su propia aprobadora. Asígnale un manager específico.",
  APROBADOR_AMBIGUO: "Hay varios managers con la misma prioridad. Cierra una de las asignaciones.",
  APROBADOR_EMPLEADO_DE_BAJA: "La persona está de baja en esa fecha: no se admiten solicitudes.",
};

/**
 * Traduce errores de PostgreSQL/PostgREST a mensajes accionables en español.
 * Solo se muestran literalmente los mensajes redactados por nosotros en la
 * base de datos (en español); el resto se sustituye por un texto genérico para
 * no exponer detalles internos.
 */
export function dbErrorMessage(error: DbError): string {
  const message = error.message ?? "";
  const approver = /^(APROBADOR_[A-Z_]+)/.exec(message)?.[1];
  if (approver) return APPROVER_MESSAGES[approver] ?? "No se pudo determinar el aprobador.";

  switch (error.code) {
    case "23505":
      return "Ya existe un registro con esos datos (código, nombre o correo repetido).";
    case "23P01":
      return "Se solapa con otro registro vigente del mismo tipo. Cierra el anterior o cambia las fechas.";
    case "23503":
      return "Alguna referencia no es válida o no pertenece a esta empresa.";
    case "42501":
      return /^[A-ZÁÉÍÓÚ][a-záéíóúñ ]/.test(message) && !message.includes("row-level security")
        ? message
        : "No tienes permiso para esta operación.";
    case "P0002":
      return "No encontrado.";
    case "23514":
    case "P0001":
    case "22023":
      if (message && !/violates|invalid input|syntax/i.test(message)) {
        return error.hint ? `${message}. ${error.hint}` : message;
      }
      return "Algún dato no es válido. Revisa fechas y valores.";
    default:
      return "No se pudo guardar. Inténtalo de nuevo.";
  }
}

export function dbErrorState(error: DbError): FormState {
  return { status: "error", message: dbErrorMessage(error) };
}
