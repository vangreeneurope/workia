"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { hasPermission } from "@/lib/admin/access";
import { addDays, businessDate, startOfBusinessDay } from "@/lib/dates";
import { dbErrorState } from "@/lib/db-errors";
import { getPublicEnv } from "@/lib/env";
import type { FormState } from "@/lib/forms";
import { createAdminClient } from "@/lib/supabase/admin";

import { adminAction, FORBIDDEN } from "../action-helpers";
import { memberInviteSchema, membershipEndSchema, roleGrantSchema } from "../schemas";
import { addMemberFlow } from "./invite";

/** Instante de inicio: hoy = ahora mismo; otro día = inicio de ese día en Madrid. */
function startInstant(date: string | null): string | undefined {
  if (!date || date === businessDate()) return undefined;
  return startOfBusinessDay(date);
}

export async function inviteMember(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction(
    "membresias",
    memberInviteSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      if (!hasPermission(ctx.permissions, "members.manage", "company")) return FORBIDDEN;
      const admin = createAdminClient();
      if (!admin) {
        return {
          status: "error",
          message:
            "Las invitaciones no están configuradas en este entorno (falta SUPABASE_SECRET_KEY).",
        };
      }
      const env = getPublicEnv();
      const state = await addMemberFlow(
        {
          findUserIdByEmail: async (email) => {
            const { data: row } = await admin
              .from("profiles")
              .select("id")
              .eq("email", email)
              .maybeSingle();
            return row?.id ?? null;
          },
          inviteUser: async (email, fullName) => {
            const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, {
              data: fullName ? { full_name: fullName } : undefined,
              redirectTo: env.NEXT_PUBLIC_SITE_URL
                ? `${env.NEXT_PUBLIC_SITE_URL}/auth/confirmar`
                : undefined,
            });
            return error ? { failed: true } : { userId: invited.user?.id };
          },
          createMembership: async (userId) => {
            const { error } = await supabase
              .from("company_memberships")
              .insert({ company_id: ctx.companyId, user_id: userId });
            return { error };
          },
        },
        { email: data.email, fullName: data.full_name },
      );
      if (state.status === "success") refresh();
      return state;
    },
  );
}

export async function grantRole(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction("membresias", roleGrantSchema, formData, async ({ ctx, data, supabase }) => {
    const { error } = await supabase.from("role_assignments").insert({
      company_id: ctx.companyId,
      membership_id: data.membership_id,
      role: data.role,
      scope_type: data.scope_type,
      work_center_id: data.work_center_id,
      team_id: data.team_id,
      valid_from: startInstant(data.valid_from),
      valid_to: data.valid_to ? startOfBusinessDay(data.valid_to) : null,
    });
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success", message: "Rol concedido." };
  });
}

export async function revokeRole(roleAssignmentId: string): Promise<FormState> {
  return adminAction(
    "membresias",
    z.object({ id: z.uuid() }),
    { id: roleAssignmentId },
    async ({ ctx, data, supabase }) => {
      const { data: rows, error } = await supabase
        .from("role_assignments")
        .update({ status: "revoked" })
        .eq("id", data.id)
        .eq("company_id", ctx.companyId)
        .select("id");
      if (error) return dbErrorState(error);
      if (!rows?.length)
        return { status: "error", message: "No puedes revocar este rol (o es tuyo)." };
      refresh();
      return { status: "success", message: "Rol revocado." };
    },
  );
}

/** Fin de acceso: la cuenta deja de estar vigente desde el día siguiente a end_date. */
export async function endMembership(_prev: FormState, formData: FormData): Promise<FormState> {
  return adminAction(
    "membresias",
    membershipEndSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { data: rows, error } = await supabase
        .from("company_memberships")
        .update({ valid_to: startOfBusinessDay(addDays(data.end_date, 1)) })
        .eq("id", data.membership_id)
        .eq("company_id", ctx.companyId)
        .select("id");
      if (error) return dbErrorState(error);
      if (!rows?.length) return FORBIDDEN;
      refresh();
      return { status: "success", message: "Fin de acceso registrado." };
    },
  );
}

export async function reactivateMembership(membershipId: string): Promise<FormState> {
  return adminAction(
    "membresias",
    z.object({ id: z.uuid() }),
    { id: membershipId },
    async ({ ctx, data, supabase }) => {
      const { data: rows, error } = await supabase
        .from("company_memberships")
        .update({ valid_to: null, status: "active" })
        .eq("id", data.id)
        .eq("company_id", ctx.companyId)
        .select("id");
      if (error) return dbErrorState(error);
      if (!rows?.length) return FORBIDDEN;
      refresh();
      return { status: "success", message: "Cuenta reactivada." };
    },
  );
}
