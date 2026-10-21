import "server-only";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { LOGIN_PATH } from "@/lib/auth/routes";
import {
  canAccessSection,
  resolveActiveCompanyId,
  type CompanySummary,
  type Membership,
  type SectionKey,
  type UserContext,
} from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

/**
 * Capa de acceso a datos de autenticación (Data Access Layer).
 * Es el ÚNICO sitio desde el que páginas y Server Actions obtienen la identidad
 * del usuario. Cada llamada verifica el JWT con getClaims (no se confía en el
 * contenido de la cookie sin validar).
 */

export const ACTIVE_COMPANY_COOKIE = "empresa_activa";

export const getCurrentUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
});

export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) redirect(LOGIN_PATH);
  return userId;
}

type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  primary_color: string;
  logo_path: string | null;
  active: boolean;
};

function toCompanySummary(row: CompanyRow): CompanySummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    primaryColor: row.primary_color,
    logoPath: row.logo_path,
  };
}

/** Contexto completo del usuario autenticado. Memorizado por petición. */
export const getUserContext = cache(async (): Promise<UserContext> => {
  const userId = await requireUserId();
  const supabase = await createClient();
  const cookieStore = await cookies();

  const [profileRes, adminRes, membershipsRes, supervisedRes] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name").eq("id", userId).maybeSingle(),
    supabase.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    supabase
      .from("company_memberships")
      .select("id, roles, companies (id, name, slug, primary_color, logo_path, active)")
      .eq("user_id", userId)
      .eq("active", true),
    supabase
      .from("manager_assignments")
      .select("id", { count: "exact", head: true })
      .eq("manager_user_id", userId),
  ]);

  for (const res of [profileRes, adminRes, membershipsRes, supervisedRes]) {
    if (res.error) {
      console.error("Error cargando el contexto del usuario", res.error.code);
      throw new Error("No se pudo cargar tu información. Inténtalo de nuevo.");
    }
  }

  const isGlobalAdmin = Boolean(adminRes.data);

  const memberships: Membership[] = (membershipsRes.data ?? []).flatMap((row) => {
    const company = row.companies;
    if (!company || !company.active) return [];
    return [{ membershipId: row.id, roles: row.roles, company: toCompanySummary(company) }];
  });

  let companies = memberships.map((m) => m.company);
  if (isGlobalAdmin) {
    const { data, error } = await supabase
      .from("companies")
      .select("id, name, slug, primary_color, logo_path, active")
      .eq("active", true)
      .order("name");
    if (error) throw new Error("No se pudo cargar la lista de empresas.");
    companies = (data ?? []).map(toCompanySummary);
  }

  return {
    userId,
    email: profileRes.data?.email ?? "",
    fullName: profileRes.data?.full_name ?? "",
    isGlobalAdmin,
    memberships,
    companies,
    activeCompanyId: resolveActiveCompanyId(
      companies,
      cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value,
    ),
    supervisedCount: supervisedRes.count ?? 0,
  };
});

/**
 * Exige acceso a una sección. Responde 404 si no hay permiso para no revelar
 * la existencia de la ruta. Usar al inicio de cada página protegida.
 */
export async function requireSection(section: SectionKey): Promise<UserContext> {
  const ctx = await getUserContext();
  if (!canAccessSection(ctx, section)) notFound();
  return ctx;
}

/** URL firmada temporal (1 h) del logotipo de una empresa (bucket privado). */
export async function getCompanyLogoUrl(logoPath: string | null): Promise<string | null> {
  if (!logoPath) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("company-logos")
    .createSignedUrl(logoPath, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}
