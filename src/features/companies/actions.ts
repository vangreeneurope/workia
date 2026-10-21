"use server";

import { cookies } from "next/headers";
import { z } from "zod";

import { ACTIVE_COMPANY_COOKIE, getUserContext } from "@/lib/auth/dal";

const companyIdSchema = z.uuid();

/**
 * Cambia la empresa activa. Solo se aceptan empresas a las que el usuario
 * tiene acceso; la cookie únicamente guarda una preferencia de interfaz, los
 * datos siguen protegidos por RLS.
 */
export async function setActiveCompany(formData: FormData): Promise<void> {
  const parsed = companyIdSchema.safeParse(formData.get("companyId"));
  if (!parsed.success) return;

  const ctx = await getUserContext();
  if (!ctx.companies.some((company) => company.id === parsed.data)) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_COMPANY_COOKIE, parsed.data, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
