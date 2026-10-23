import type { Enums } from "@/types/database";

/**
 * Lógica de permisos de la interfaz. Funciones puras, sin acceso a datos,
 * para poder probarlas de forma aislada (tests/unit/permissions.test.ts).
 *
 * IMPORTANTE: esto decide qué se MUESTRA y qué rutas se sirven. La protección
 * de los datos la garantiza RLS en la base de datos (supabase/migrations).
 * Ver docs/PERMISOS.md.
 */

export type CompanyRole = Enums<"app_role">;

export const COMPANY_ROLES: readonly CompanyRole[] = [
  "company_admin",
  "hr",
  "manager",
  "accounting",
  "employee",
  "auditor",
] as const;

export const ROLE_LABELS: Record<CompanyRole, string> = {
  company_admin: "Administración de empresa",
  hr: "RR. HH.",
  manager: "Responsable",
  accounting: "Contabilidad",
  employee: "Empleado",
  auditor: "Auditoría",
};

export const GLOBAL_ADMIN_LABEL = "Administración de plataforma";
export const GROUP_ADMIN_LABEL = "Administración de grupo";

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
  /** Roles vigentes (de cualquier ámbito: empresa, centro o equipo). */
  roles: CompanyRole[];
};

export type UserContext = {
  userId: string;
  email: string;
  fullName: string;
  /** Última versión cuyas novedades ha visto (ADR-068); null si ninguna. */
  lastSeenRelease?: string | null;
  /** Administración de plataforma (platform_admins). */
  isGlobalAdmin: boolean;
  /** Grupos que administra con una asignación vigente (group_admins). */
  administeredGroupIds: string[];
  /** Empresas que administra por ser administrador de su grupo. */
  administeredCompanyIds: string[];
  memberships: Membership[];
  /** Empresas que el usuario puede seleccionar como activas. */
  companies: CompanySummary[];
  activeCompanyId: string | null;
  /** Número de asignaciones vigentes como manager (pueden cruzar empresas). */
  supervisedCount: number;
  /**
   * Verificación en dos pasos (ADR-053): `required` si tiene roles de
   * administración, RR. HH., contabilidad o auditoría (o administra grupo o
   * plataforma); `satisfied` si la sesión actual es aal2. La base de datos no
   * concede esos permisos sin aal2; esto solo decide qué mostrar.
   */
  mfa: { required: boolean; satisfied: boolean };
};

export type SectionKey =
  | "panel"
  | "horario"
  | "fichajes"
  | "ausencias"
  | "gastos"
  | "equipo"
  | "informes"
  | "auditoria"
  | "admin"
  | "perfil";

export function rolesInCompany(ctx: UserContext, companyId: string | null): CompanyRole[] {
  if (!companyId) return [];
  return ctx.memberships.find((m) => m.company.id === companyId)?.roles ?? [];
}

/**
 * ¿Administra la empresa por ser administrador de su grupo? La administración
 * de plataforma no administra empresas (ADR-024).
 */
export function administersCompany(ctx: UserContext, companyId: string | null): boolean {
  if (!companyId) return false;
  return ctx.administeredCompanyIds.includes(companyId);
}

function hasAnyRole(roles: CompanyRole[], allowed: CompanyRole[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

/** ¿Puede el usuario acceder a la sección con su empresa activa? */
export function canAccessSection(ctx: UserContext, section: SectionKey): boolean {
  const roles = rolesInCompany(ctx, ctx.activeCompanyId);
  const admin = administersCompany(ctx, ctx.activeCompanyId);
  switch (section) {
    case "panel":
    case "perfil":
      return true;
    case "horario":
      // Su propio horario y, según permisos, el de quien supervisa o gestiona (RLS decide qué ve).
      return (
        admin ||
        ctx.supervisedCount > 0 ||
        hasAnyRole(roles, ["employee", "manager", "company_admin", "hr", "auditor"])
      );
    case "fichajes":
    case "ausencias":
      // Toda persona contratada ficha y solicita ausencias, incluidos managers y RR. HH.
      return hasAnyRole(roles, ["employee", "manager", "company_admin", "hr"]);
    case "gastos":
      return hasAnyRole(roles, ["employee", "manager", "company_admin", "hr", "accounting"]);
    case "equipo":
      return (
        admin || ctx.supervisedCount > 0 || hasAnyRole(roles, ["manager", "company_admin", "hr"])
      );
    case "informes":
      // Cada informe muestra solo el ámbito de la persona (RLS y funciones de informe).
      return admin || ctx.supervisedCount > 0 || roles.length > 0;
    case "auditoria":
      return admin || hasAnyRole(roles, ["company_admin", "auditor"]);
    case "admin":
      return admin || hasAnyRole(roles, ["company_admin", "hr"]);
  }
}

/** Secciones que solo tienen sentido con los permisos que exigen MFA. */
export const MFA_PROTECTED_SECTIONS: readonly SectionKey[] = [
  "equipo",
  "informes",
  "auditoria",
  "admin",
];

/** ¿Debe verificar el segundo factor antes de usar sus permisos? */
export function mfaPending(ctx: UserContext): boolean {
  return ctx.mfa.required && !ctx.mfa.satisfied;
}

/** ¿Hay que pedir el segundo factor para entrar en esta sección? */
export function needsMfaStepUp(ctx: UserContext, section: SectionKey): boolean {
  return mfaPending(ctx) && MFA_PROTECTED_SECTIONS.includes(section);
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
  return color && HEX_COLOR.test(color) ? color : "#4a7a5f";
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
