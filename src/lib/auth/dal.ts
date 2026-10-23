import "server-only";

import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { LOGIN_PATH } from "@/lib/auth/routes";
import { assembleUserContext, type CompanyRow } from "@/lib/auth/context";
import {
  canAccessSection,
  needsMfaStepUp,
  type SectionKey,
  type UserContext,
} from "@/lib/auth/permissions";
import {
  isExpired,
  mayHaveExpired,
  SESSION_EXPIRED_PATH,
  sessionDeadline,
  sessionMinutes,
  sessionStartedAt,
} from "@/lib/auth/session-limit";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

/**
 * Capa de acceso a datos de autenticación (Data Access Layer).
 * Es el ÚNICO sitio desde el que páginas y Server Actions obtienen la identidad
 * del usuario. Cada llamada verifica el JWT con getClaims (no se confía en el
 * contenido de la cookie sin validar).
 */

export const ACTIVE_COMPANY_COOKIE = "empresa_activa";

/** Página de seguridad de la cuenta (alta y verificación del segundo factor). */
export const MFA_PATH = "/perfil/seguridad";

type SessionState = {
  userId: string | null;
  /** La sesión existía pero ha superado su duración máxima (ADR-067). */
  expired: boolean;
  /** Momento de entrada (ms) según el JWT validado; null si no se conoce. */
  startedAt: number | null;
};

/** Minutos de sesión que se aplican a la persona (el más corto de sus empresas). */
const getSessionMinutes = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_session_limit");
  if (error) log.warn("auth.session_limit_failed", { code: error.code });
  return sessionMinutes(error ? null : data);
});

/**
 * Sesión validada (getClaims) y su vencimiento. Una sesión que ha superado la
 * duración máxima cuenta como sin sesión en toda la capa de acceso a datos, y
 * quien la pide va a SESSION_EXPIRED_PATH, donde el proxy la cierra.
 */
const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return { userId: null, expired: false, startedAt: null };
  const startedAt = sessionStartedAt(data.claims);
  const now = Date.now();
  if (startedAt !== null && mayHaveExpired(startedAt, now)) {
    if (isExpired(startedAt, await getSessionMinutes(), now)) {
      log.info("auth.session_expired", {});
      return { userId: null, expired: true, startedAt };
    }
  }
  return { userId: data.claims.sub, expired: false, startedAt };
});

export const getCurrentUserId = cache(
  async (): Promise<string | null> => (await getSessionState()).userId,
);

export async function requireUserId(): Promise<string> {
  const { userId, expired } = await getSessionState();
  if (!userId) redirect(expired ? SESSION_EXPIRED_PATH : LOGIN_PATH);
  return userId;
}

/**
 * Hora límite de la sesión (ms desde epoch) y hora del servidor, para el aviso
 * y el cierre en el navegador; null si el token no trae la hora de entrada.
 */
export async function getSessionDeadline(): Promise<{ deadline: number; now: number } | null> {
  const { userId, startedAt } = await getSessionState();
  if (!userId || startedAt === null) return null;
  return { deadline: sessionDeadline(startedAt, await getSessionMinutes()), now: Date.now() };
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

  const [profileRes, platformRes, groupAdminsRes, membershipsRes, assignmentsRes, mfaRes] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("email, full_name, last_seen_release")
        .eq("id", userId)
        .maybeSingle(),
      supabase.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
      supabase.from("group_admins").select(`group_id, ${VALIDITY_COLUMNS}`).eq("user_id", userId),
      supabase
        .from("company_memberships")
        .select(
          `id, ${VALIDITY_COLUMNS}, companies (${COMPANY_COLUMNS}), role_assignments (role, ${VALIDITY_COLUMNS})`,
        )
        .eq("user_id", userId),
      supabase.from("manager_assignments").select(VALIDITY_COLUMNS).eq("manager_user_id", userId),
      supabase.rpc("my_mfa_status").maybeSingle(),
    ]);

  for (const res of [
    profileRes,
    platformRes,
    groupAdminsRes,
    membershipsRes,
    assignmentsRes,
    mfaRes,
  ]) {
    if (res.error) {
      log.error("auth.context_failed", { code: res.error.code });
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
    mfa: { required: mfaRes.data?.required ?? false, satisfied: mfaRes.data?.satisfied ?? false },
  });
});

/**
 * Exige acceso a una sección. Responde 404 si no hay permiso para no revelar
 * la existencia de la ruta. Si la sección necesita permisos que exigen MFA y la
 * sesión aún no lo ha verificado, lleva a verificarlo (step-up).
 * Usar al inicio de cada página protegida.
 */
export async function requireSection(section: SectionKey): Promise<UserContext> {
  const ctx = await getUserContext();
  if (!canAccessSection(ctx, section)) notFound();
  if (needsMfaStepUp(ctx, section)) redirect(`${MFA_PATH}?motivo=verificar`);
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
