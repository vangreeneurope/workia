import { describe, expect, it } from "vitest";

import { canUseArea, visibleAdminAreas, type CompanyPermission } from "@/lib/admin/access";
import { dbErrorMessage } from "@/lib/db-errors";

const perm = (permission: string, scope_type = "company"): CompanyPermission => ({
  permission,
  scope_type,
  work_center_id: null,
  team_id: null,
});

const companyAdmin = [
  "company.manage",
  "org.manage",
  "members.read",
  "members.manage",
  "roles.manage",
  "employees.read",
  "employees.manage",
  "terms.read",
  "terms.manage",
  "assignments.manage",
  "audit.read",
].map((p) => perm(p));

describe("áreas de administración", () => {
  it("la administración de empresa no ve el área de empresas del grupo", () => {
    const areas = visibleAdminAreas(companyAdmin, { groupAdmin: false }).map((a) => a.key);
    expect(areas).toEqual([
      "centros",
      "equipos",
      "personas",
      "membresias",
      "aprobadores",
      "importar",
    ]);
  });

  it("la administración de grupo sí", () => {
    expect(canUseArea("empresas", [], { groupAdmin: true })).toBe(true);
  });

  it("RR. HH. de un centro gestiona personas de su ámbito, pero no cuentas ni centros", () => {
    const scoped = ["employees.read", "employees.manage", "assignments.manage"].map((p) =>
      perm(p, "work_center"),
    );
    expect(canUseArea("personas", scoped, { groupAdmin: false })).toBe(true);
    expect(canUseArea("membresias", scoped, { groupAdmin: false })).toBe(false);
    expect(canUseArea("centros", scoped, { groupAdmin: false })).toBe(false);
  });

  it("contabilidad solo consulta personas", () => {
    const areas = visibleAdminAreas([perm("employees.read")], { groupAdmin: false }).map(
      (a) => a.key,
    );
    expect(areas).toEqual(["personas"]);
  });
});

describe("mensajes de error accionables", () => {
  it("traduce los códigos de aprobador", () => {
    expect(dbErrorMessage({ code: "P0001", message: "APROBADOR_NO_ASIGNADO: x" })).toMatch(
      /Asigna uno/,
    );
  });

  it("explica solapes y duplicados", () => {
    expect(dbErrorMessage({ code: "23P01", message: "conflicting key" })).toMatch(/Se solapa/);
    expect(dbErrorMessage({ code: "23505", message: "duplicate key" })).toMatch(/Ya existe/);
  });

  it("muestra nuestros mensajes en español con su pista", () => {
    expect(
      dbErrorMessage({
        code: "23514",
        message: "La persona causa baja el 2026-10-31",
        hint: "Ajusta las fechas.",
      }),
    ).toBe("La persona causa baja el 2026-10-31. Ajusta las fechas.");
  });

  it("oculta detalles internos de PostgreSQL", () => {
    expect(
      dbErrorMessage({ code: "23514", message: 'new row violates check constraint "x"' }),
    ).toBe("Algún dato no es válido. Revisa fechas y valores.");
    expect(
      dbErrorMessage({ code: "42501", message: "new row violates row-level security policy" }),
    ).toBe("No tienes permiso para esta operación.");
  });
});
