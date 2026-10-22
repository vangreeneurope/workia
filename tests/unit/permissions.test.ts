import { describe, expect, it } from "vitest";

import {
  brandForeground,
  canAccessSection,
  resolveActiveCompanyId,
  rolesInCompany,
  safeBrandColor,
  type SectionKey,
} from "@/lib/auth/permissions";

import { companyA, companyB, makeContext } from "./fixtures";

const ALL: SectionKey[] = [
  "panel",
  "horario",
  "fichajes",
  "ausencias",
  "gastos",
  "equipo",
  "auditoria",
  "admin",
  "perfil",
];

function allowed(ctx: Parameters<typeof canAccessSection>[0]) {
  return ALL.filter((section) => canAccessSection(ctx, section));
}

describe("canAccessSection", () => {
  it("empleado: solo sus secciones personales", () => {
    const ctx = makeContext([[companyA, ["employee"]]]);
    expect(allowed(ctx)).toEqual(["panel", "horario", "fichajes", "ausencias", "gastos", "perfil"]);
  });

  it("contabilidad: gastos pero no fichajes ni equipo", () => {
    const ctx = makeContext([[companyA, ["accounting"]]]);
    expect(allowed(ctx)).toEqual(["panel", "gastos", "perfil"]);
  });

  it("manager: ve Equipo", () => {
    const ctx = makeContext([[companyA, ["manager", "employee"]]]);
    expect(canAccessSection(ctx, "equipo")).toBe(true);
    expect(canAccessSection(ctx, "auditoria")).toBe(false);
  });

  it("supervisar a alguien de otra empresa da acceso a Equipo aunque no sea manager en la activa", () => {
    const ctx = makeContext([[companyA, ["employee"]]], { supervisedCount: 2 });
    expect(canAccessSection(ctx, "equipo")).toBe(true);
  });

  it("RR. HH.: Equipo y Auditoría, pero no Empresas", () => {
    const ctx = makeContext([[companyA, ["company_admin"]]]);
    expect(canAccessSection(ctx, "auditoria")).toBe(true);
    expect(canAccessSection(ctx, "equipo")).toBe(true);
    expect(canAccessSection(ctx, "admin")).toBe(true);
  });

  it("administración de plataforma: no administra empresas (solo inicio y perfil)", () => {
    const ctx = makeContext([], {
      isGlobalAdmin: true,
      companies: [companyA],
      activeCompanyId: companyA.id,
    });
    expect(allowed(ctx)).toEqual(["panel", "perfil"]);
  });

  it("RR. HH. (hr): Equipo, fichajes y gastos, pero no Auditoría", () => {
    const ctx = makeContext([[companyA, ["hr"]]]);
    expect(allowed(ctx)).toEqual([
      "panel",
      "horario",
      "fichajes",
      "ausencias",
      "gastos",
      "equipo",
      "admin",
      "perfil",
    ]);
  });

  it("auditor: Auditoría y consulta de horarios además de lo común", () => {
    const ctx = makeContext([[companyA, ["auditor"]]]);
    expect(allowed(ctx)).toEqual(["panel", "horario", "auditoria", "perfil"]);
  });

  it("horario: quien supervisa a alguien lo ve aunque no tenga rol en la empresa activa", () => {
    expect(canAccessSection(makeContext([[companyA, ["accounting"]]]), "horario")).toBe(false);
    expect(
      canAccessSection(
        makeContext([[companyA, ["accounting"]]], { supervisedCount: 1 }),
        "horario",
      ),
    ).toBe(true);
  });

  it("administrador de grupo: Administración, Equipo y Auditoría solo en empresas de su grupo", () => {
    const base = makeContext([], {
      administeredGroupIds: ["g-1"],
      administeredCompanyIds: [companyA.id],
      companies: [companyA, companyB],
    });
    expect(canAccessSection({ ...base, activeCompanyId: companyA.id }, "auditoria")).toBe(true);
    expect(canAccessSection({ ...base, activeCompanyId: companyA.id }, "admin")).toBe(true);
    expect(canAccessSection({ ...base, activeCompanyId: companyB.id }, "admin")).toBe(false);
    expect(canAccessSection({ ...base, activeCompanyId: companyB.id }, "auditoria")).toBe(false);
  });

  it("los roles dependen de la empresa activa", () => {
    const ctx = makeContext([
      [companyA, ["company_admin"]],
      [companyB, ["employee"]],
    ]);
    expect(canAccessSection({ ...ctx, activeCompanyId: companyA.id }, "auditoria")).toBe(true);
    expect(canAccessSection({ ...ctx, activeCompanyId: companyB.id }, "auditoria")).toBe(false);
  });

  it("sin empresa: solo inicio y perfil", () => {
    const ctx = makeContext([]);
    expect(allowed(ctx)).toEqual(["panel", "perfil"]);
  });
});

describe("rolesInCompany", () => {
  it("devuelve vacío para empresas sin membresía", () => {
    const ctx = makeContext([[companyA, ["employee"]]]);
    expect(rolesInCompany(ctx, companyB.id)).toEqual([]);
    expect(rolesInCompany(ctx, null)).toEqual([]);
  });
});

describe("resolveActiveCompanyId", () => {
  it("respeta la cookie si la empresa es accesible", () => {
    expect(resolveActiveCompanyId([companyA, companyB], companyB.id)).toBe(companyB.id);
  });

  it("ignora una cookie manipulada con una empresa ajena", () => {
    expect(resolveActiveCompanyId([companyA], companyB.id)).toBe(companyA.id);
  });

  it("sin cookie elige la primera por orden alfabético", () => {
    expect(resolveActiveCompanyId([companyA, companyB], undefined)).toBe(companyB.id);
  });

  it("sin empresas devuelve null", () => {
    expect(resolveActiveCompanyId([], companyA.id)).toBeNull();
  });
});

describe("color corporativo", () => {
  it("rechaza valores que podrían inyectar CSS", () => {
    expect(safeBrandColor("red;} body{display:none")).toBe("#4a7a5f");
    expect(safeBrandColor("#12345")).toBe("#4a7a5f");
    expect(safeBrandColor(null)).toBe("#4a7a5f");
    expect(safeBrandColor("#A1b2C3")).toBe("#A1b2C3");
  });

  it("elige texto legible sobre el color", () => {
    expect(brandForeground("#ffffff")).toBe("#111827");
    expect(brandForeground("#1f2937")).toBe("#ffffff");
  });
});
