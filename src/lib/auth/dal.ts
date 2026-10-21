import "server-only";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { LOGIN_PATH } from "@/lib/auth/routes";
import { assembleUserContext, type CompanyRow } from "@/lib/auth/context";
import { canAccessSection, type SectionKey, type UserContext } from "@/lib/auth/permissions";
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

const COMPANY_COLUMNS = "id, name, slug, primary_color, logo_path, status, group_id";
const VALIDITY_COLUMNS = "status, valid_from, valid_to";

/**
 * Contexto completo del usuario autenticado. Memorizado por petición.
 * Los permisos salen de tablas controladas por el servidor (platform_admins,
 * group_admins, role_assignments, manager_assignments) y nunca de los
 * metadatos editables de Auth. RLS limita cada consulta a lo que el usuario
 * puede ver; la vigencia se evalúa en assembleUserContext.
 */
export const getUserContext = cache(async (): Promise<UserContext> => {
  const userId = await requireUserId();
  const supabase = await createClient();
  const cookieStore = await cookies();
  const now = new Date();

  const [profileRes, platformRes, groupAdminsRes, membershipsRes, assignmentsRes] =
    await Promise.all([
      supabase.from("profiles").select("email, full_name").eq("id", userId).maybeSingle(),
      supabase.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
      supabase.from("group_admins").select(`group_id, ${VALIDITY_COLUMNS}`).eq("user_id", userId),
      supabase
        .from("company_memberships")
        .select(
          `id, ${VALIDITY_COLUMNS}, companies (${COMPANY_COLUMNS}), role_assignments (role, ${VALIDITY_COLUMNS})`,
        )
        .eq("user_id", userId),
      supabase.from("manager_assignments").select(VALIDITY_COLUMNS).eq("manager_user_id", userId),
    ]);

  for (const res of [profileRes, platformRes, groupAdminsRes, membershipsRes, assignmentsRes]) {
    if (res.error) {
      console.error("Error cargando el contexto del usuario", res.error.code);
      throw new Error("No se pudo cargar tu información. Inténtalo de nuevo.");
    }
  }

  const isPlatformAdmin = Boolean(platformRes.data);
  const groupIds = (groupAdminsRes.data ?? []).map((g) => g.group_id);

  let administeredCompanies: CompanyRow[] = [];
  if (groupIds.length > 0) {
    const { data, error } = await supabase
      .from("companies")
      .select(COMPANY_COLUMNS)
      .in("group_id", groupIds)
      .order("name");
    if (error) throw new Error("No se pudo cargar la lista de empresas.");
    administeredCompanies = data ?? [];
  }

  return assembleUserContext({
    userId,
    profile: profileRes.data,
    isPlatformAdmin,
    groupAdmins: groupAdminsRes.data ?? [],
    memberships: membershipsRes.data ?? [],
    managerAssignments: assignmentsRes.data ?? [],
    administeredCompanies,
    requestedCompanyId: cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value,
    now,
  });
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
