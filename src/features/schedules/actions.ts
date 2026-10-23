"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { adminAction, FORBIDDEN } from "@/features/admin/action-helpers";
import { addDays } from "@/lib/dates";
import { dbErrorState } from "@/lib/db-errors";
import type { FormState } from "@/lib/forms";

import {
  assignmentCloseSchema,
  assignmentPublishSchema,
  assignmentSchema,
  calendarLinkEndSchema,
  calendarLinkSchema,
  calendarSchema,
  holidayImportSchema,
  holidaySchema,
  parseHolidayLines,
  templateCreateSchema,
  templateDraftSchema,
  templatePublishSchema,
} from "./schemas";
import { todayIn } from "./zoned-time";

/*
 * Todas las acciones siguen el patrón de administración: autorizan el área con
 * la sesión (adminAction), validan con el esquema compartido y escriben con el
 * cliente del usuario. La empresa es siempre ctx.companyId: antes de llamar a
 * una función de la base de datos se comprueba que el sujeto es de esa empresa.
 */

const statusSchema = z.object({ id: z.uuid(), status: z.enum(["active", "inactive"]) });

const NOT_FOUND: FormState = { status: "error", message: "No encontrado en la empresa activa." };

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

export async function createTemplate(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction(
    "plantillas",
    templateCreateSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { data: row, error } = await supabase
        .from("shift_templates")
        .insert({ company_id: ctx.companyId, code: data.code, name: data.name })
        .select("id")
        .single();
      if (error?.code === "23505") {
        return {
          status: "error",
          message: "Ya hay una plantilla con ese código.",
          fieldErrors: { code: ["Código repetido"] },
        };
      }
      if (error || !row) return dbErrorState(error ?? {});
      redirect(`/admin/plantillas/${row.id}`);
    },
  );
}

export async function saveTemplateDraft(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction(
    "plantillas",
    templateDraftSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { data: template } = await supabase
        .from("shift_templates")
        .select("id")
        .eq("id", data.template_id)
        .eq("company_id", ctx.companyId)
        .maybeSingle();
      if (!template) return NOT_FOUND;
      const { error } = await supabase.rpc("save_shift_template_draft", {
        p_template: data.template_id,
        p_kind: data.kind,
        p_target_minutes: data.target_minutes,
        p_tolerance_early: data.tolerance_early,
        p_tolerance_late: data.tolerance_late,
        p_flex_start: data.kind === "flexible" ? (data.flex_start ?? undefined) : undefined,
        p_flex_end: data.kind === "flexible" ? (data.flex_end ?? undefined) : undefined,
        p_segments: data.segments,
      });
      if (error) return dbErrorState(error);
      refresh();
      return { status: "success", message: "Borrador guardado. Aún no afecta a ningún horario." };
    },
  );
}

export async function publishTemplateVersion(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return adminAction(
    "plantillas",
    templatePublishSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { data: version } = await supabase
        .from("shift_template_versions")
        .select("id")
        .eq("id", data.version_id)
        .eq("company_id", ctx.companyId)
        .maybeSingle();
      if (!version) return NOT_FOUND;
      const { data: notified, error } = await supabase.rpc("publish_shift_template_version", {
        p_version: data.version_id,
        p_valid_from: data.valid_from,
      });
      if (error) return dbErrorState(error);
      refresh();
      return {
        status: "success",
        message: `Versión publicada. Avisos generados para ${notified ?? 0} persona(s).`,
      };
    },
  );
}

export async function setTemplateStatus(input: {
  id: string;
  status: "active" | "inactive";
}): Promise<FormState> {
  return adminAction("plantillas", statusSchema, input, async ({ ctx, data, supabase }) => {
    const { data: rows, error } = await supabase
      .from("shift_templates")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("company_id", ctx.companyId)
      .select("id");
    if (error) return dbErrorState(error);
    if (!rows?.length) return FORBIDDEN;
    refresh();
    return { status: "success" };
  });
}

// ---------------------------------------------------------------------------
// Asignaciones
// ---------------------------------------------------------------------------

export async function saveAssignment(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("horarios", assignmentSchema, formData, async ({ ctx, data, supabase }) => {
    // El sujeto debe ser de la empresa activa (RLS y la función vuelven a comprobar el permiso).
    let subject: { id: string } | null = null;
    if (data.scope_type === "team") {
      ({ data: subject } = await supabase
        .from("teams")
        .select("id")
        .eq("id", data.team_id ?? "")
        .eq("company_id", ctx.companyId)
        .maybeSingle());
    } else if (data.scope_type === "contract") {
      ({ data: subject } = await supabase
        .from("employment_terms")
        .select("id")
        .eq("id", data.employment_terms_id ?? "")
        .eq("company_id", ctx.companyId)
        .maybeSingle());
    } else {
      ({ data: subject } = await supabase
        .from("employees")
        .select("id")
        .eq("id", data.employee_id ?? "")
        .eq("company_id", ctx.companyId)
        .maybeSingle());
    }
    if (!subject) return NOT_FOUND;

    const { data: id, error } = await supabase.rpc("save_shift_assignment", {
      p_id: data.id ?? undefined,
      p_scope: data.scope_type,
      p_employee:
        data.scope_type === "employee" || data.scope_type === "exception"
          ? (data.employee_id ?? undefined)
          : undefined,
      p_team: data.scope_type === "team" ? (data.team_id ?? undefined) : undefined,
      p_terms: data.scope_type === "contract" ? (data.employment_terms_id ?? undefined) : undefined,
      p_valid_from: data.valid_from,
      p_valid_to: data.last_day ? addDays(data.last_day, 1) : undefined,
      p_cycle_days: data.cycle_days,
      p_anchor: data.anchor_date ?? data.valid_from,
      p_days: data.days,
      p_note: data.note ?? undefined,
    });
    if (error?.code === "23514" && /exception_check/.test(error.message)) {
      return { status: "error", message: "Una excepción dura como mucho 31 días." };
    }
    if (error || !id) return dbErrorState(error ?? {});
    if (data.id) {
      refresh();
      return {
        status: "success",
        message: "Borrador actualizado. Revisa los conflictos antes de publicar.",
      };
    }
    redirect(`/admin/horarios/${id}`);
  });
}

export async function publishAssignment(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction(
    "horarios",
    assignmentPublishSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { data: row } = await supabase
        .from("shift_assignments")
        .select("id")
        .eq("id", data.id)
        .eq("company_id", ctx.companyId)
        .maybeSingle();
      if (!row) return NOT_FOUND;
      const { data: notified, error } = await supabase.rpc("publish_shift_assignment", {
        p_id: data.id,
        p_accept_warnings: data.accept_warnings,
      });
      if (error) return dbErrorState(error);
      refresh();
      return {
        status: "success",
        message: `Horario publicado. Avisos generados para ${notified ?? 0} persona(s).`,
      };
    },
  );
}

export async function closeAssignment(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction(
    "horarios",
    assignmentCloseSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { data: row } = await supabase
        .from("shift_assignments")
        .select("id")
        .eq("id", data.id)
        .eq("company_id", ctx.companyId)
        .maybeSingle();
      if (!row) return NOT_FOUND;
      const { error } = await supabase.rpc("close_shift_assignment", {
        p_id: data.id,
        p_last_day: data.last_day,
      });
      if (error) return dbErrorState(error);
      refresh();
      return {
        status: "success",
        message: "Asignación actualizada. Se ha avisado a las personas afectadas.",
      };
    },
  );
}

export async function discardAssignment(id: string): Promise<FormState> {
  return adminAction(
    "horarios",
    z.object({ id: z.uuid() }),
    { id },
    async ({ ctx, data, supabase }) => {
      const { data: row } = await supabase
        .from("shift_assignments")
        .select("id, status")
        .eq("id", data.id)
        .eq("company_id", ctx.companyId)
        .maybeSingle();
      if (!row || row.status !== "draft") return NOT_FOUND;
      const { error } = await supabase.rpc("close_shift_assignment", {
        p_id: data.id,
        p_last_day: todayIn("Europe/Madrid"),
      });
      if (error) return dbErrorState(error);
      redirect("/admin/horarios");
    },
  );
}

// ---------------------------------------------------------------------------
// Calendarios laborales
// ---------------------------------------------------------------------------

export async function createCalendar(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("calendarios", calendarSchema, formData, async ({ ctx, data, supabase }) => {
    const { data: row, error } = await supabase
      .from("holiday_calendars")
      .insert({ company_id: ctx.companyId, ...data })
      .select("id")
      .single();
    if (error?.code === "23505") {
      return {
        status: "error",
        message: "Ya hay un calendario con ese nombre.",
        fieldErrors: { name: ["Nombre repetido"] },
      };
    }
    if (error || !row) return dbErrorState(error ?? {});
    redirect(`/admin/calendarios/${row.id}`);
  });
}

export async function setCalendarStatus(input: {
  id: string;
  status: "active" | "inactive";
}): Promise<FormState> {
  return adminAction("calendarios", statusSchema, input, async ({ ctx, data, supabase }) => {
    const { data: rows, error } = await supabase
      .from("holiday_calendars")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("company_id", ctx.companyId)
      .select("id");
    if (error) return dbErrorState(error);
    if (!rows?.length) return FORBIDDEN;
    refresh();
    return { status: "success" };
  });
}

export async function addHoliday(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("calendarios", holidaySchema, formData, async ({ ctx, data, supabase }) => {
    const { error } = await supabase.from("holidays").insert({
      company_id: ctx.companyId,
      calendar_id: data.calendar_id,
      holiday_date: data.holiday_date,
      name: data.name,
    });
    if (error?.code === "23505")
      return { status: "error", message: "Ese día ya es festivo en este calendario." };
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success", message: "Festivo añadido." };
  });
}

export async function importHolidays(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction(
    "calendarios",
    holidayImportSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { data: calendar } = await supabase
        .from("holiday_calendars")
        .select("id")
        .eq("id", data.calendar_id)
        .eq("company_id", ctx.companyId)
        .maybeSingle();
      if (!calendar) return NOT_FOUND;
      const { data: company } = await supabase
        .from("companies")
        .select("timezone")
        .eq("id", ctx.companyId)
        .single();
      const parsed = parseHolidayLines(data.lines, todayIn(company?.timezone ?? "Europe/Madrid"));
      if (parsed.errors.length) {
        return {
          status: "error",
          message: "No se ha importado nada.",
          fieldErrors: { lines: parsed.errors },
        };
      }
      // Una sola sentencia: o entran todos o ninguno.
      const { error } = await supabase.from("holidays").insert(
        parsed.rows.map((r) => ({
          company_id: ctx.companyId,
          calendar_id: data.calendar_id,
          holiday_date: r.date,
          name: r.name,
        })),
      );
      if (error?.code === "23505") {
        return {
          status: "error",
          message: "Alguna fecha ya es festivo en este calendario. No se ha importado nada.",
        };
      }
      if (error) return dbErrorState(error);
      refresh();
      return { status: "success", message: `${parsed.rows.length} festivo(s) importado(s).` };
    },
  );
}

export async function setHolidayStatus(input: {
  id: string;
  status: "active" | "inactive";
}): Promise<FormState> {
  return adminAction("calendarios", statusSchema, input, async ({ ctx, data, supabase }) => {
    const { data: rows, error } = await supabase
      .from("holidays")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("company_id", ctx.companyId)
      .select("id");
    if (error) return dbErrorState(error);
    if (!rows?.length) return FORBIDDEN;
    refresh();
    return { status: "success" };
  });
}

export async function linkCalendar(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction(
    "calendarios",
    calendarLinkSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { error } = await supabase.from("work_center_holiday_calendars").insert({
        company_id: ctx.companyId,
        work_center_id: data.work_center_id,
        calendar_id: data.calendar_id,
        valid_from: data.valid_from,
      });
      if (error?.code === "23P01") {
        return {
          status: "error",
          message: "Este calendario ya se aplica a ese centro en esas fechas.",
        };
      }
      if (error) return dbErrorState(error);
      refresh();
      return { status: "success", message: "Calendario aplicado al centro." };
    },
  );
}

export async function endCalendarLink(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction(
    "calendarios",
    calendarLinkEndSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { data: rows, error } = await supabase
        .from("work_center_holiday_calendars")
        .update({ valid_to: addDays(data.last_day, 1) })
        .eq("id", data.id)
        .eq("company_id", ctx.companyId)
        .select("id");
      if (error?.code === "23514") {
        return {
          status: "error",
          message: "El fin debe ser posterior al inicio de la aplicación.",
        };
      }
      if (error) return dbErrorState(error);
      if (!rows?.length) return FORBIDDEN;
      refresh();
      return { status: "success", message: "Aplicación finalizada." };
    },
  );
}
