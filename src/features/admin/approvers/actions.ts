"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { addDays, businessDate, startOfBusinessDay } from "@/lib/dates";
import { dbErrorMessage, dbErrorState } from "@/lib/db-errors";
import type { FormState } from "@/lib/forms";

import { adminAction, FORBIDDEN } from "../action-helpers";
import {
  approverCheckSchema,
  assignmentEndSchema,
  assignmentSchema,
  substitutionSchema,
} from "../schemas";

const NO_PERSON: FormState = {
  status: "error",
  message: "No hay ninguna persona con cuenta vigente en el grupo con ese correo.",
  fieldErrors: {},
};

function startInstant(date: string): string | undefined {
  return date === businessDate() ? undefined : startOfBusinessDay(date);
}

/** Primer instante del día siguiente: el último día indicado queda incluido. */
function endInstant(lastDay: string): string {
  return startOfBusinessDay(addDays(lastDay, 1));
}

export async function createAssignment(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("aprobadores", assignmentSchema, formData, async ({ ctx, data, supabase }) => {
    const { data: managerId } = await supabase.rpc("find_group_user_by_email", {
      p_company: ctx.companyId,
      p_email: data.manager_email,
    });
    if (!managerId) return { ...NO_PERSON, fieldErrors: { manager_email: [NO_PERSON.message!] } };

    const { error } = await supabase.from("manager_assignments").insert({
      company_id: ctx.companyId,
      scope_type: data.scope_type,
      employee_id: data.employee_id,
      team_id: data.team_id,
      request_type: data.request_type,
      manager_user_id: managerId,
      valid_from: startInstant(data.valid_from),
      valid_to: data.valid_to ? endInstant(data.valid_to) : null,
    });
    if (error?.code === "23P01") {
      return {
        status: "error",
        message:
          "Ya hay un aprobador vigente para esa persona o equipo y ese tipo de solicitud en esas fechas. Finaliza la asignación actual o elige otras fechas.",
      };
    }
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success", message: "Asignación creada." };
  });
}

export async function endAssignment(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction(
    "aprobadores",
    assignmentEndSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { data: row } = await supabase
        .from("manager_assignments")
        .select("valid_from")
        .eq("id", data.id)
        .eq("company_id", ctx.companyId)
        .maybeSingle();
      if (!row) return FORBIDDEN;
      const end = endInstant(data.end_date);
      // Si aún no había empezado, se anula en lugar de acortarse.
      const patch = end <= row.valid_from ? { status: "revoked" as const } : { valid_to: end };
      const { data: rows, error } = await supabase
        .from("manager_assignments")
        .update(patch)
        .eq("id", data.id)
        .eq("company_id", ctx.companyId)
        .select("id");
      if (error) return dbErrorState(error);
      if (!rows?.length) return FORBIDDEN;
      refresh();
      return { status: "success", message: "Asignación finalizada." };
    },
  );
}

export async function createSubstitution(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction(
    "aprobadores",
    substitutionSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { data: substituteId } = await supabase.rpc("find_group_user_by_email", {
        p_company: ctx.companyId,
        p_email: data.substitute_email,
      });
      if (!substituteId)
        return { ...NO_PERSON, fieldErrors: { substitute_email: [NO_PERSON.message!] } };
      if (substituteId === data.absent_user_id) {
        return {
          status: "error",
          message: "La persona suplente no puede ser la misma que la ausente.",
        };
      }
      const { error } = await supabase.from("approver_substitutions").insert({
        company_id: ctx.companyId,
        absent_user_id: data.absent_user_id,
        substitute_user_id: substituteId,
        request_type: data.request_type,
        reason: data.reason,
        valid_from: startInstant(data.valid_from),
        valid_to: endInstant(data.valid_to),
      });
      if (error?.code === "23P01") {
        return {
          status: "error",
          message:
            "Ya hay una suplencia vigente para esa persona y tipo de solicitud en esas fechas.",
        };
      }
      if (error) return dbErrorState(error);
      refresh();
      return { status: "success", message: "Suplencia registrada." };
    },
  );
}

export async function endSubstitution(id: string): Promise<FormState> {
  return adminAction(
    "aprobadores",
    z.object({ id: z.uuid() }),
    { id },
    async ({ ctx, data, supabase }) => {
      const { data: rows, error } = await supabase
        .from("approver_substitutions")
        .update({ status: "revoked" })
        .eq("id", data.id)
        .eq("company_id", ctx.companyId)
        .select("id");
      if (error) return dbErrorState(error);
      if (!rows?.length) return FORBIDDEN;
      refresh();
      return { status: "success", message: "Suplencia finalizada." };
    },
  );
}

export type ApproverCheck = FormState & { approverName?: string; viaSubstitution?: boolean };

export async function checkApprover(
  _prev: ApproverCheck,
  formData: FormData,
): Promise<ApproverCheck> {
  return adminAction(
    "aprobadores",
    approverCheckSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { data: rows, error } = await supabase.rpc("resolve_approver", {
        p_employee: data.employee_id,
        p_type: data.request_type,
      });
      if (error) return { status: "error", message: dbErrorMessage(error) };
      const result = rows?.[0];
      if (!result) return { status: "error", message: "No se pudo determinar el aprobador." };
      const { data: labels } = await supabase.rpc("group_user_labels", {
        p_company: ctx.companyId,
        p_users: [result.approver_user_id],
      });
      return {
        status: "success",
        approverName: labels?.[0]?.full_name || "Persona del grupo",
        viaSubstitution: Boolean(result.substitution_id),
      };
    },
  );
}
