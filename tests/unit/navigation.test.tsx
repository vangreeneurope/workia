import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobileNav } from "@/components/layout/mobile-nav";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { isActivePath, visibleNavKeys } from "@/lib/navigation";

import { companyA, makeContext } from "./fixtures";

vi.mock("next/navigation", () => ({ usePathname: () => "/fichajes" }));

describe("visibleNavKeys", () => {
  it("un empleado no ve Equipo, Auditoría ni Empresas", () => {
    const keys = visibleNavKeys(makeContext([[companyA, ["employee"]]]));
    expect(keys).not.toContain("equipo");
    expect(keys).not.toContain("auditoria");
    expect(keys).not.toContain("empresas");
  });
});

describe("isActivePath", () => {
  it("marca subrutas pero no prefijos parciales", () => {
    expect(isActivePath("/perfil/contrasena", "/perfil")).toBe(true);
    expect(isActivePath("/perfilx", "/perfil")).toBe(false);
  });
});

describe("SidebarNav", () => {
  it("muestra solo las secciones permitidas y marca la actual", () => {
    render(<SidebarNav visibleKeys={["panel", "fichajes", "perfil"]} />);
    expect(screen.getByRole("link", { name: "Fichajes" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Inicio" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("link", { name: "Empresas" })).not.toBeInTheDocument();
  });
});

describe("MobileNav", () => {
  it("muestra hasta 4 accesos directos y agrupa el resto en Más", () => {
    render(
      <MobileNav visibleKeys={["panel", "fichajes", "ausencias", "gastos", "equipo", "perfil"]} />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Más" })).toBeInTheDocument();
  });

  it("sin secciones secundarias no muestra Más", () => {
    render(<MobileNav visibleKeys={["panel", "fichajes"]} />);
    expect(screen.queryByRole("button", { name: "Más" })).not.toBeInTheDocument();
  });
});
