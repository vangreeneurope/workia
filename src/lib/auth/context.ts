import {
  resolveActiveCompanyId,
  type CompanyRole,
  type CompanySummary,
  type Membership,
  type UserContext,
} from "@/lib/auth/permissions";
import { isCurrent, type Validity } from "@/lib/auth/validity";
import type { Enums } from "@/types/database";

/**
 * Ensambla el contexto del usuario a partir de las filas que devuelve Supabase
 * (ya filtradas por RLS a lo que el usuario puede ver). Función pura: aplica
 * vigencias y estados para decidir qué mostrar. Ver src/lib/auth/dal.ts.
 */

export type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  primary_color: string;
  logo_path: string | null;
  status: Enums<"entity_status">;
  group_id: string;
};

export type MembershipRow = Validity & {
  id: string;
  companies: CompanyRow | null;
  role_assignments: (Validity & { role: CompanyRole })[];
};

export type ContextInput = {
  userId: string;
  profile: { email: string; full_name: string; last_seen_release?: string | null } | null;
  isPlatformAdmin: boolean;
  groupAdmins: (Validity & { group_id: string })[];
  memberships: MembershipRow[];
  managerAssignments: Validity[];
  /** Empresas de los grupos que administra (filas de companies). */
  administeredCompanies: CompanyRow[];
  requestedCompanyId: string | null | undefined;
  now: Date;
  /** Estado de MFA según la base de datos (my_mfa_status). */
  mfa?: { required: boolean; satisfied: boolean };
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

export function assembleUserContext(input: ContextInput): UserContext {
  const { now } = input;

  const administeredGroupIds = [
    ...new Set(input.groupAdmins.filter((g) => isCurrent(g, now)).map((g) => g.group_id)),
  ];

  // La administración de plataforma no administra empresas (ADR-024).
  const administeredCompanies = input.administeredCompanies.filter((c) =>
    administeredGroupIds.includes(c.group_id),
  );

  const memberships: Membership[] = input.memberships.flatMap((row) => {
    const company = row.companies;
    if (!company || company.status !== "active" || !isCurrent(row, now)) return [];
    const roles = [
      ...new Set(row.role_assignments.filter((r) => isCurrent(r, now)).map((r) => r.role)),
    ];
    return [{ membershipId: row.id, roles, company: toCompanySummary(company) }];
  });

  const byId = new Map<string, CompanySummary>();
  for (const m of memberships) byId.set(m.company.id, m.company);
  for (const c of administeredCompanies) {
    if (c.status === "active" && !byId.has(c.id)) byId.set(c.id, toCompanySummary(c));
  }
  const companies = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));

  return {
    userId: input.userId,
    email: input.profile?.email ?? "",
    fullName: input.profile?.full_name ?? "",
    lastSeenRelease: input.profile?.last_seen_release ?? null,
    isGlobalAdmin: input.isPlatformAdmin,
    administeredGroupIds,
    administeredCompanyIds: administeredCompanies.map((c) => c.id),
    memberships,
    companies,
    activeCompanyId: resolveActiveCompanyId(companies, input.requestedCompanyId),
    supervisedCount: input.managerAssignments.filter((a) => isCurrent(a, now)).length,
    mfa: input.mfa ?? { required: false, satisfied: false },
  };
}
