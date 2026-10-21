import type { Enums } from "@/types/database";

/**
 * Lógica de permisos de la interfaz. Funciones puras, sin acceso a datos,
 * para poder probarlas de forma aislada (tests/unit/permissions.test.ts).
 *
 * IMPORTANTE: esto decide qué se MUESTRA y qué rutas se sirven. La protección
 * de los datos la garantiza RLS en la base de datos (supabase/migrations).
 * Ver docs/PERMISOS.md.
 */

export type CompanyRole = Enums<"company_role">;

export const COMPANY_ROLES: readonly CompanyRole[] = [
  "company_admin",
  "manager",
  "employee",
  "accounting",
] as const;

export const ROLE_LABELS: Record<CompanyRole, string> = {
  company_admin: "Administración / RR. HH.",
  manager: "Responsable",
  employee: "Empleado",
  accounting: "Contabilidad",
};

export const GLOBAL_ADMIN_LABEL = "Administrador global";

export type CompanySummary = {
  id: string;
  name: string;
  slug: string;
  primaryColor: string;
  logoPath: string | null;
};

export type Membership = {
  membershipId: string;
  company: CompanySummary;
  roles: CompanyRole[];
};

export type UserContext = {
  userId: string;
  email: string;
  fullName: string;
  isGlobalAdmin: boolean;
  memberships: Membership[];
  /** Empresas que el usuario puede seleccionar como activas. */
  companies: CompanySummary[];
  activeCompanyId: string | null;
  /** Número de membresías que supervisa como manager (puede cruzar empresas). */
  supervisedCount: number;
};

export type SectionKey =
  "panel" | "fichajes" | "ausencias" | "gastos" | "equipo" | "auditoria" | "empresas" | "perfil";

export function rolesInCompany(ctx: UserContext, companyId: string | null): CompanyRole[] {
  if (!companyId) return [];
  return ctx.memberships.find((m) => m.company.id === companyId)?.roles ?? [];
}

function hasAnyRole(roles: CompanyRole[], allowed: CompanyRole[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

/** ¿Puede el usuario acceder a la sección con su empresa activa? */
export function canAccessSection(ctx: UserContext, section: SectionKey): boolean {
  const roles = rolesInCompany(ctx, ctx.activeCompanyId);
  switch (section) {
    case "panel":
    case "perfil":
      return true;
    case "fichajes":
    case "ausencias":
      // Toda persona contratada ficha y solicita ausencias, incluidos managers y RR. HH.
      return hasAnyRole(roles, ["employee", "manager", "company_admin"]);
    case "gastos":
      return hasAnyRole(roles, ["employee", "manager", "company_admin", "accounting"]);
    case "equipo":
      return (
        ctx.isGlobalAdmin ||
        ctx.supervisedCount > 0 ||
        hasAnyRole(roles, ["manager", "company_admin"])
      );
    case "auditoria":
      return ctx.isGlobalAdmin || hasAnyRole(roles, ["company_admin"]);
    case "empresas":
      return ctx.isGlobalAdmin;
  }
}

/**
 * Empresa activa: la guardada en cookie si sigue siendo válida para el usuario;
 * si no, la primera disponible por orden alfabético; null si no tiene ninguna.
 */
export function resolveActiveCompanyId(
  companies: CompanySummary[],
  requested: string | null | undefined,
): string | null {
  if (requested && companies.some((c) => c.id === requested)) return requested;
  const sorted = [...companies].sort((a, b) => a.name.localeCompare(b.name, "es"));
  return sorted[0]?.id ?? null;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Color corporativo seguro para inyectar en CSS; vuelve al neutro si no es válido. */
export function safeBrandColor(color: string | null | undefined): string {
  return color && HEX_COLOR.test(color) ? color : "#1f2937";
}

/** Color de texto legible (blanco o casi negro) sobre el color corporativo. */
export function brandForeground(color: string): string {
  const hex = safeBrandColor(color).slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.4 ? "#111827" : "#ffffff";
}
