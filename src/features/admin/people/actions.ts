"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { dbErrorState } from "@/lib/db-errors";
import type { FormState } from "@/lib/forms";

import { adminAction, FORBIDDEN } from "../action-helpers";
import { employeeSchema, terminationSchema, termsChangeSchema } from "../schemas";
import { PEOPLE_SEARCH_COOKIE } from "./queries";
import { sanitizeSearch } from "./situation";
import { adminAreaOrNull } from "@/lib/admin/context";

export async function createEmployee(_prev: FormState, formData: FormData): Promise<FormState> {
  let newId: string | undefined;
  const state = await adminAction(
    "personas",
    employeeSchema,
    formData,
    async ({ ctx, data, supabase }) => {
      const { data: row, error } = await supabase
        .from("employees")
        .insert({ ...data, company_id: ctx.companyId })
        .select("id")
        .single();
      if (error) return dbErrorState(error);
      newId = row.id;
      return { status: "success" };
    },
  );
  if (state.status === "success" && newId) redirect(`/admin/personas/${newId}?creada=1`);
  return state;
}

export async function updateEmployee(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return adminAction("personas", employeeSchema, formData, async ({ ctx, data, supabase }) => {
    const { data: rows, error } = await supabase
      .from("employees")
      .update(data)
      .eq("id", id)
      .eq("company_id", ctx.companyId)
      .select("id");
    if (error) return dbErrorState(error);
    if (!rows?.length) return FORBIDDEN;
    refresh();
    return { status: "success", message: "Datos guardados." };
  });
}

export async function changeTerms(
  employeeId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return adminAction("personas", termsChangeSchema, formData, async ({ data, supabase }) => {
    const { error } = await supabase.rpc("change_employment_terms", {
      p_employee: employeeId,
      p_effective: data.effective_date,
      p_contract_type: data.contract_type,
      p_working_time: data.working_time,
      p_weekly_hours: data.weekly_hours,
      p_job_title: data.job_title ?? undefined,
    });
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success", message: "Condiciones registradas con su fecha de efecto." };
  });
}

export async function terminateEmployee(
  employeeId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return adminAction("personas", terminationSchema, formData, async ({ data, supabase }) => {
    const { error } = await supabase.rpc("terminate_employee", {
      p_employee: employeeId,
      p_last_day: data.last_day,
    });
    if (error) return dbErrorState(error);
    refresh();
    return { status: "success", message: "Baja registrada. El historial se conserva." };
  });
}

export async function reactivateEmployee(
  employeeId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  return adminAction("personas", z.object({}), formData, async ({ supabase }) => {
    const { error } = await supabase.rpc("reactivate_employee", { p_employee: employeeId });
    if (error) return dbErrorState(error);
    refresh();
    return {
      status: "success",
      message: "Persona reactivada. Registra sus nuevas condiciones, roles y aprobadores.",
    };
  });
}

/** Guarda la búsqueda en una cookie (no en la URL) y vuelve al listado. */
export async function setPeopleSearch(formData: FormData): Promise<void> {
  if (!(await adminAreaOrNull("personas"))) return;
  const term = sanitizeSearch(String(formData.get("q") ?? ""));
  const store = await cookies();
  if (term) {
    store.set(PEOPLE_SEARCH_COOKIE, term, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/admin/personas",
      maxAge: 15 * 60,
    });
  } else {
    store.delete({ name: PEOPLE_SEARCH_COOKIE, path: "/admin/personas" });
  }
  const filters = new URLSearchParams();
  for (const key of ["situacion", "centro", "equipo"]) {
    const value = formData.get(key);
    if (typeof value === "string" && value) filters.set(key, value);
  }
  const qs = filters.toString();
  redirect(qs ? `/admin/personas?${qs}` : "/admin/personas");
}

export async function clearPeopleSearch(): Promise<void> {
  if (!(await adminAreaOrNull("personas"))) return;
  const store = await cookies();
  store.delete({ name: PEOPLE_SEARCH_COOKIE, path: "/admin/personas" });
  redirect("/admin/personas");
}
