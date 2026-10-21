import type { CompanyRole, CompanySummary, UserContext } from "@/lib/auth/permissions";

export const companyA: CompanySummary = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  name: "Empresa A",
  slug: "empresa-a",
  primaryColor: "#0055aa",
  logoPath: null,
};

export const companyB: CompanySummary = {
  id: "bbbbbbbb-0000-0000-0000-000000000002",
  name: "Beta Servicios",
  slug: "beta",
  primaryColor: "#aa5500",
  logoPath: null,
};

/** Construye un contexto de usuario para pruebas de permisos. */
export function makeContext(
  rolesByCompany: Array<[CompanySummary, CompanyRole[]]>,
  overrides: Partial<UserContext> = {},
): UserContext {
  const memberships = rolesByCompany.map(([company, roles], i) => ({
    membershipId: `m-${i}`,
    company,
    roles,
  }));
  return {
    userId: "u-1",
    email: "persona@grupo.test",
    fullName: "Persona de Prueba",
    isGlobalAdmin: false,
    memberships,
    companies: memberships.map((m) => m.company),
    activeCompanyId: memberships[0]?.company.id ?? null,
    supervisedCount: 0,
    ...overrides,
  };
}
