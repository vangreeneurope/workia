"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { dbErrorState } from "@/lib/db-errors";
import type { FormState } from "@/lib/forms";

import { adminAction, FORBIDDEN } from "../action-helpers";
import {
  companyCreateSchema,
  companySchema,
  statusToggleSchema,
  teamSchema,
  workCenterSchema,
} from "../schemas";

// Empresas (administración de grupo) ------------------------------------------

export async function createCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  const state = await adminAction(
    "empresas",
    companyCreateSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      if (!ctx.user.administeredGroupIds.includes(data.group_id)) return FORBIDDEN;
      const { error } = await supabase.from("companies").insert(data);
      return error ? dbErrorState(error) : { status: "success" };
    },
  );
  if (state.status === "success") redirect("/admin/empresas");
  return state;
}

export async function updateCompany(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return adminAction("empresas", companySchema, formData, async ({ ctx, data, supabase }) => {
    if (!ctx.user.administeredCompanyIds.includes(id)) return FORBIDDEN;
    const { error } = await supabase.from("companies").update(data).eq("id", id);
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success", message: "Empresa actualizada." };
  });
}

export async function setCompanyStatus(input: {
  id: string;
  status: "active" | "inactive";
}): Promise<FormState> {
  return adminAction("empresas", statusToggleSchema, input, async ({ ctx, data, supabase }) => {
    if (!ctx.user.administeredCompanyIds.includes(data.id)) return FORBIDDEN;
    const { error } = await supabase
      .from("companies")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success" };
  });
}

// Centros de trabajo -------------------------------------------------------------

export async function createWorkCenter(_prev: FormState, formData: FormData): Promise<FormState> {
  const state = await adminAction(
    "centros",
    workCenterSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { error } = await supabase
        .from("work_centers")
        .insert({ ...data, company_id: ctx.companyId });
      return error ? dbErrorState(error) : { status: "success" };
    },
  );
  if (state.status === "success") redirect("/admin/centros");
  return state;
}

export async function updateWorkCenter(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return adminAction("centros", workCenterSchema, formData, async ({ ctx, data, supabase }) => {
    const { data: rows, error } = await supabase
      .from("work_centers")
      .update(data)
      .eq("id", id)
      .eq("company_id", ctx.companyId)
      .select("id");
    if (error) return dbErrorState(error);
    if (!rows?.length) return FORBIDDEN;
    refresh();
    return { status: "success", message: "Centro actualizado." };
  });
}

export async function setWorkCenterStatus(input: {
  id: string;
  status: "active" | "inactive";
}): Promise<FormState> {
  return adminAction("centros", statusToggleSchema, input, async ({ ctx, data, supabase }) => {
    const { data: rows, error } = await supabase
      .from("work_centers")
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

// Equipos ------------------------------------------------------------------------

export async function createTeam(_prev: FormState, formData: FormData): Promise<FormState> {
  const state = await adminAction(
    "equipos",
    teamSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { error } = await supabase.from("teams").insert({ ...data, company_id: ctx.companyId });
      return error ? dbErrorState(error) : { status: "success" };
    },
  );
  if (state.status === "success") redirect("/admin/equipos");
  return state;
}

export async function updateTeam(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return adminAction("equipos", teamSchema, formData, async ({ ctx, data, supabase }) => {
    const { data: rows, error } = await supabase
      .from("teams")
      .update(data)
      .eq("id", id)
      .eq("company_id", ctx.companyId)
      .select("id");
    if (error) return dbErrorState(error);
    if (!rows?.length) return FORBIDDEN;
    refresh();
    return { status: "success", message: "Equipo actualizado." };
  });
}

export async function setTeamStatus(input: {
  id: string;
  status: "active" | "inactive";
}): Promise<FormState> {
  return adminAction("equipos", statusToggleSchema, input, async ({ ctx, data, supabase }) => {
    const { data: rows, error } = await supabase
      .from("teams")
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
