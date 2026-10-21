import { describe, expect, it } from "vitest";

import { HOME_PATH, isPublicPath, safeRedirectPath } from "@/lib/auth/routes";

describe("safeRedirectPath (protección frente a redirecciones abiertas)", () => {
  it.each([
    ["/fichajes", "/fichajes"],
    ["/ausencias?mes=2026-10", "/ausencias?mes=2026-10"],
  ])("acepta rutas internas: %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    "https://malicioso.example",
    "//malicioso.example",
    "/\\malicioso.example",
    "javascript:alert(1)",
    "/javascript:alert(1)",
    "fichajes",
    "/acceder",
    "/auth/confirmar?x=1",
    "/panel\n",
    "",
  ])("rechaza %j", (input) => {
    expect(safeRedirectPath(input)).toBe(HOME_PATH);
  });

  it("usa el valor por defecto con null", () => {
    expect(safeRedirectPath(null)).toBe(HOME_PATH);
  });
});

describe("isPublicPath", () => {
  it("solo acceso y callbacks de auth son públicos", () => {
    expect(isPublicPath("/acceder")).toBe(true);
    expect(isPublicPath("/acceder/recuperar")).toBe(true);
    expect(isPublicPath("/auth/confirmar")).toBe(true);
    expect(isPublicPath("/terminal")).toBe(true);
    expect(isPublicPath("/terminal/activar")).toBe(true);
    expect(isPublicPath("/terminales")).toBe(false);
    expect(isPublicPath("/panel")).toBe(false);
    expect(isPublicPath("/accederx")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
  });
});
