/**
 * Texto de los eventos de cambio de horario (schedule_events). Los eventos no
 * llevan datos personales: solo ids, fechas y versión. El aviso por correo o
 * notificación push lo hará un proveedor futuro leyendo los eventos pendientes.
 */

import { addDays, formatDate, isIsoDate } from "@/lib/dates";
import type { Json } from "@/types/database";

function field(payload: Json, key: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function day(value: string | null): string {
  return value && isIsoDate(value) ? formatDate(value) : "—";
}

export function describeScheduleEvent(type: string, payload: Json): string {
  switch (type) {
    case "shift_assignment_published": {
      const until = field(payload, "valid_to");
      return `Se ha publicado un horario desde el ${day(field(payload, "valid_from"))}${
        until && isIsoDate(until) ? ` hasta el ${formatDate(addDays(until, -1))}` : ""
      }.`;
    }
    case "shift_assignment_changed":
      return `Un horario asignado termina el ${day(field(payload, "last_day"))} (incluido).`;
    case "shift_template_published":
      return `Cambia un turno que tienes asignado a partir del ${day(field(payload, "valid_from"))} (versión ${
        field(payload, "version") ?? "nueva"
      }).`;
    default:
      return "Cambio en tu horario.";
  }
}
