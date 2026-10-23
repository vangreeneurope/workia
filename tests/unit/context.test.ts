import { describe, expect, it } from "vitest";

import { assembleUserContext, type CompanyRow, type ContextInput } from "@/lib/auth/context";
import { isCurrent } from "@/lib/auth/validity";

const NOW = new Date("2026-10-22T10:00:00Z");
const PAST = "2026-01-01T00:00:00Z";
const YESTERDAY = "2026-10-21T10:00:00Z";
const TOMORROW = "2026-10-23T10:00:00Z";

const alfa: CompanyRow = {
  id: "c-alfa",
  name: "Alfa",
  slug: "alfa",
  primary_color: "#112233",
  logo_path: null,
  status: "active",
  group_id: "g-1",
};
const beta: CompanyRow = { ...alfa, id: "c-beta", name: "Beta", slug: "beta" };
const inactiva: CompanyRow = {
  ...alfa,
  id: "c-off",
  name: "Cerrada",
  slug: "off",
  status: "inactive",
};
const otroGrupo: CompanyRow = {
  ...alfa,
  id: "c-otro",
  name: "Otra",
  slug: "otra",
  group_id: "g-2",
};

const active = { status: "active", valid_from: PAST, valid_to: null };

function input(overrides: Partial<ContextInput>): ContextInput {
  return {
    userId: "u-1",
    profile: { email: "persona@example.test", full_name: "Persona" },
    isPlatformAdmin: false,
    groupAdmins: [],
    memberships: [],
    managerAssignments: [],
    administeredCompanies: [],
    requestedCompanyId: null,
    now: NOW,
    ...overrides,
  };
}

describe("isCurrent", () => {
  it("respeta estado y vigencia [desde, hasta)", () => {
    expect(isCurrent(active, NOW)).toBe(true);
    expect(isCurrent({ ...active, status: "revoked" }, NOW)).toBe(false);
    expect(isCurrent({ ...active, valid_from: TOMORROW }, NOW)).toBe(false);
    expect(isCurrent({ ...active, valid_to: YESTERDAY }, NOW)).toBe(false);
    expect(isCurrent({ ...active, valid_to: NOW.toISOString() }, NOW)).toBe(false);
  });
});

describe("assembleUserContext", () => {
  it("toma los roles vigentes de role_assignments e ignora futuros y revocados", () => {
    const ctx = assembleUserContext(
      input({
        memberships: [
          {
            id: "m-1",
            ...active,
            companies: alfa,
            role_assignments: [
              { role: "employee", ...active },
              { role: "manager", ...active },
              { role: "manager", ...active }, // otro ámbito, mismo rol
              { role: "hr", ...active, valid_from: TOMORROW },
              { role: "company_admin", ...active, status: "revoked" },
            ],
          },
        ],
      }),
    );
    expect(ctx.memberships[0]?.roles).toEqual(["employee", "manager"]);
    expect(ctx.activeCompanyId).toBe("c-alfa");
  });

  it("descarta membresías caducadas y empresas inactivas", () => {
    const ctx = assembleUserContext(
      input({
        memberships: [
          { id: "m-1", ...active, valid_to: YESTERDAY, companies: alfa, role_assignments: [] },
          { id: "m-2", ...active, companies: inactiva, role_assignments: [] },
        ],
      }),
    );
    expect(ctx.memberships).toEqual([]);
    expect(ctx.companies).toEqual([]);
    expect(ctx.activeCompanyId).toBeNull();
  });

  it("el administrador de grupo administra solo las empresas de sus grupos vigentes", () => {
    const ctx = assembleUserContext(
      input({
        groupAdmins: [
          { group_id: "g-1", ...active },
          { group_id: "g-2", ...active, valid_to: YESTERDAY },
        ],
        administeredCompanies: [alfa, beta, inactiva, otroGrupo],
      }),
    );
    expect(ctx.administeredGroupIds).toEqual(["g-1"]);
    expect(ctx.administeredCompanyIds).toEqual(["c-alfa", "c-beta", "c-off"]);
    // En el selector solo aparecen empresas activas.
    expect(ctx.companies.map((c) => c.id)).toEqual(["c-alfa", "c-beta"]);
  });

  it("solo cuenta las asignaciones de manager vigentes", () => {
    const ctx = assembleUserContext(
      input({
        managerAssignments: [
          active,
          { ...active, valid_to: YESTERDAY },
          { ...active, status: "revoked" },
        ],
      }),
    );
    expect(ctx.supervisedCount).toBe(1);
  });

  it("ignora una empresa activa pedida por cookie si no es accesible", () => {
    const ctx = assembleUserContext(
      input({
        memberships: [{ id: "m-1", ...active, companies: alfa, role_assignments: [] }],
        requestedCompanyId: "c-beta",
      }),
    );
    expect(ctx.activeCompanyId).toBe("c-alfa");
  });
});
