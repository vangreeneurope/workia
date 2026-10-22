import { z } from "zod";

import type { NotificationEvent } from "./catalog";

/**
 * Plantillas versionadas en español. Contenido mínimo: empresa, acción, fecha y
 * enlace. Nunca tipos de ausencia, motivos, importes, coordenadas ni imágenes,
 * ni en el asunto ni en el cuerpo. Una versión publicada no se modifica: los
 * cambios van en una versión nueva (cada aviso guarda la suya).
 */

export const paramsSchema = z.object({
  company: z.string().max(120).default(""),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  work_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  count: z.number().int().min(0).max(100000).optional(),
  outcome: z.enum(["approved", "rejected"]).optional(),
});

export type TemplateParams = z.infer<typeof paramsSchema>;

type Rendered = { title: string; body: string };
type Template = (p: TemplateParams) => Rendered;

const fmt = (iso?: string) => (iso ? iso.split("-").reverse().join("/") : "");
const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const month = (p?: string) =>
  p ? `${MONTHS[Number(p.slice(5, 7)) - 1] ?? ""} de ${p.slice(0, 4)}` : "";
const at = (p: TemplateParams) => (p.company ? ` en ${p.company}` : "");

/** TEMPLATES[evento][versión] */
export const TEMPLATES: Record<NotificationEvent, Record<number, Template>> = {
  absence_submitted: {
    1: (p) => ({
      title: "Solicitud de ausencia pendiente de aprobar",
      body: `Tienes una solicitud de ausencia pendiente de tu aprobación${at(p)} (${fmt(p.date)}).`,
    }),
  },
  absence_decided: {
    1: (p) => ({
      title:
        p.outcome === "rejected"
          ? "Solicitud de ausencia rechazada"
          : "Solicitud de ausencia aprobada",
      body: `Se ha ${p.outcome === "rejected" ? "rechazado" : "aprobado"} tu solicitud de ausencia${at(p)} (${fmt(p.date)}).`,
    }),
  },
  absence_info_requested: {
    1: (p) => ({
      title: "Te piden información sobre una solicitud",
      body: `Quien aprueba tu solicitud de ausencia${at(p)} necesita más información (${fmt(p.date)}).`,
    }),
  },
  absence_info_provided: {
    1: (p) => ({
      title: "Respuesta a la información que pediste",
      body: `La persona ha respondido sobre su solicitud de ausencia${at(p)} (${fmt(p.date)}).`,
    }),
  },
  absence_cancelled: {
    1: (p) => ({
      title: "Solicitud de ausencia cancelada",
      body: `Se ha cancelado o retirado una solicitud de ausencia que te correspondía${at(p)} (${fmt(p.date)}).`,
    }),
  },
  expense_step_pending: {
    1: (p) => ({
      title: "Informe de gastos pendiente de aprobar",
      body: `Tienes un informe de gastos de ${month(p.period) || "un mes"} pendiente de tu aprobación${at(p)}.`,
    }),
  },
  expense_report_returned: {
    1: (p) => ({
      title: "Te han devuelto un informe de gastos",
      body: `Tu informe de gastos de ${month(p.period)} necesita correcciones${at(p)}.`,
    }),
  },
  expense_report_approved: {
    1: (p) => ({
      title: "Informe de gastos aprobado",
      body: `Se ha aprobado tu informe de gastos de ${month(p.period)}${at(p)}.`,
    }),
  },
  expense_report_settled: {
    1: (p) => ({
      title: "Informe de gastos liquidado",
      body: `Tu informe de gastos de ${month(p.period)} se ha incluido en la liquidación contable${at(p)}.`,
    }),
  },
  time_missing_start: {
    1: (p) => ({
      title: "No has fichado la entrada",
      body: `Según tu horario${at(p)} hoy (${fmt(p.work_date ?? p.date)}) ya deberías haber fichado la entrada.`,
    }),
  },
  time_open_entry: {
    1: (p) => ({
      title: "Tienes una jornada abierta",
      body: `Tu jornada del ${fmt(p.work_date ?? p.date)}${at(p)} sigue abierta. Ficha la salida o pide una corrección.`,
    }),
  },
  time_incident: {
    1: (p) => ({
      title: "Hay una incidencia en tus fichajes",
      body: `Se ha detectado una incidencia en tu jornada del ${fmt(p.work_date ?? p.date)}${at(p)}.`,
    }),
  },
  time_correction_decided: {
    1: (p) => ({
      title: "Corrección de fichaje resuelta",
      body: `Se ha resuelto tu solicitud de corrección de fichaje${at(p)} (${fmt(p.date)}).`,
    }),
  },
  shift_changed: {
    1: (p) => ({
      title: "Ha cambiado tu horario",
      body: `Se ha publicado un cambio en tu horario${at(p)} (${fmt(p.date)}).`,
    }),
  },
  approval_overdue: {
    1: (p) => ({
      title: "Tienes aprobaciones pendientes",
      body: `Tienes ${p.count === 1 ? "1 solicitud pendiente" : `${p.count ?? 0} solicitudes pendientes`} de aprobar desde hace días${at(p)}.`,
    }),
  },
};

export function renderNotification(
  event: NotificationEvent,
  version: number,
  rawParams: unknown,
): Rendered {
  const params = paramsSchema.safeParse(rawParams ?? {});
  const template = TEMPLATES[event][version] ?? TEMPLATES[event][1];
  if (!template) return { title: "Aviso", body: "Tienes un aviso nuevo." };
  return template(params.success ? params.data : { company: "" });
}

export type EmailContent = { subject: string; text: string; html: string };

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Correo: asunto = título (sin datos sensibles), cuerpo mínimo y enlace al aviso.
 * El enlace solo identifica el aviso: abrirlo exige iniciar sesión.
 */
export function renderEmail(
  event: NotificationEvent,
  version: number,
  params: unknown,
  link: string,
): EmailContent {
  const { title, body } = renderNotification(event, version, params);
  const footer =
    "Para verlo, inicia sesión en el portal del empleado. Este enlace no da acceso por sí solo. Este correo es automático: no respondas.";
  const text = `${body}\n\nAbrir en el portal: ${link}\n\n${footer}\n`;
  const html = `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#1f2a24;line-height:1.5"><p>${escapeHtml(body)}</p><p><a href="${escapeHtml(link)}">Abrir en el portal</a></p><p style="color:#5b6660;font-size:12px">${escapeHtml(footer)}</p></body></html>`;
  return { subject: title, text, html };
}
