import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StatusToggle } from "@/components/admin/status-toggle";
import { addMemberFlow, type InviteDeps } from "@/features/admin/members/invite";
import { employeeSituation, sanitizeSearch } from "@/features/admin/people/situation";
import {
  assignmentSchema,
  roleGrantSchema,
  substitutionSchema,
  terminationSchema,
  employeeSchema,
} from "@/features/admin/schemas";

const UUID = "aaaaaaaa-0000-4000-8000-000000000001";

describe("alta de personas en la empresa", () => {
  function deps(overrides: Partial<InviteDeps> = {}): InviteDeps {
    return {
      findUserIdByEmail: vi.fn(async () => null),
      inviteUser: vi.fn(async () => ({ userId: UUID })),
      createMembership: vi.fn(async () => ({ error: null })),
      ...overrides,
    };
  }

  it("invita por correo si la persona no tiene cuenta", async () => {
    const d = deps();
    const state = await addMemberFlow(d, { email: "nueva@empresa.example", fullName: "Nueva" });
    expect(d.inviteUser).toHaveBeenCalledWith("nueva@empresa.example", "Nueva");
    expect(d.createMembership).toHaveBeenCalledWith(UUID);
    expect(state.message).toMatch(/Invitación enviada/);
  });

  it("reutiliza la cuenta existente sin enviar invitación", async () => {
    const d = deps({ findUserIdByEmail: vi.fn(async () => UUID) });
    const state = await addMemberFlow(d, { email: "ya@empresa.example", fullName: null });
    expect(d.inviteUser).not.toHaveBeenCalled();
    expect(state.status).toBe("success");
  });

  it("explica el duplicado y nunca muestra el correo en el mensaje", async () => {
    const d = deps({ createMembership: vi.fn(async () => ({ error: { code: "23505" } })) });
    const state = await addMemberFlow(d, { email: "dup@empresa.example", fullName: null });
    expect(state.message).toBe("Esa persona ya tiene una cuenta en esta empresa.");
    expect(state.message).not.toContain("@");
  });

  it("si RLS rechaza el alta, no lo oculta", async () => {
    const d = deps({
      createMembership: vi.fn(async () => ({
        error: { code: "42501", message: "new row violates row-level security policy" },
      })),
    });
    expect((await addMemberFlow(d, { email: "x@empresa.example", fullName: null })).message).toBe(
      "No tienes permiso para esta operación.",
    );
  });
});

describe("situación laboral y búsqueda", () => {
  it("distingue en activo, baja programada y baja efectiva", () => {
    expect(employeeSituation(null, "2026-10-22")).toBe("active");
    expect(employeeSituation("2026-10-22", "2026-10-22")).toBe("leaving");
    expect(employeeSituation("2026-10-21", "2026-10-22")).toBe("terminated");
  });

  it("limpia la sintaxis de filtros y comodines de la búsqueda", () => {
    expect(sanitizeSearch('García,first_name.eq.x)%"')).toBe("García first_name.eq.x");
    expect(sanitizeSearch("a".repeat(100))).toHaveLength(60);
  });
});

describe("validación compartida", () => {
  it("no obliga a datos personales opcionales", () => {
    expect(
      employeeSchema.safeParse({ employee_code: "A-1", first_name: "A", last_name: "B" }).success,
    ).toBe(true);
  });

  it("la baja exige confirmación explícita", () => {
    expect(terminationSchema.safeParse({ last_day: "2026-10-31" }).success).toBe(false);
    expect(terminationSchema.safeParse({ last_day: "2026-10-31", confirm: "on" }).success).toBe(
      true,
    );
  });

  it("el ámbito de un rol debe coincidir con el centro o equipo", () => {
    const base = { membership_id: UUID, role: "hr", valid_from: "2026-10-22" };
    expect(roleGrantSchema.safeParse({ ...base, scope_type: "work_center" }).success).toBe(false);
    expect(
      roleGrantSchema.safeParse({ ...base, scope_type: "work_center", work_center_id: UUID })
        .success,
    ).toBe(true);
  });

  it("una asignación es a una persona o a un equipo, con fechas coherentes", () => {
    const base = {
      request_type: "all",
      manager_email: "m@empresa.example",
      valid_from: "2026-11-01",
    };
    expect(assignmentSchema.safeParse({ ...base, scope_type: "team" }).success).toBe(false);
    expect(
      assignmentSchema.safeParse({
        ...base,
        scope_type: "employee",
        employee_id: UUID,
        valid_to: "2026-10-01",
      }).success,
    ).toBe(false);
    expect(assignmentSchema.safeParse({ ...base, scope_type: "team", team_id: UUID }).success).toBe(
      true,
    );
  });

  it("una suplencia necesita motivo y fecha de fin", () => {
    const base = {
      absent_user_id: UUID,
      substitute_email: "s@empresa.example",
      request_type: "all",
      valid_from: "2026-11-01",
    };
    expect(substitutionSchema.safeParse({ ...base, reason: "Vacaciones" }).success).toBe(false);
    expect(
      substitutionSchema.safeParse({ ...base, reason: "no", valid_to: "2026-11-10" }).success,
    ).toBe(false);
    expect(
      substitutionSchema.safeParse({ ...base, reason: "Vacaciones", valid_to: "2026-11-10" })
        .success,
    ).toBe(true);
  });
});

describe("interfaz optimista solo cuando es recuperable", () => {
  it("muestra el cambio al instante y lo revierte si el servidor lo rechaza", async () => {
    let resolve: (v: { status: "error"; message: string }) => void = () => {};
    const action = vi.fn(
      () => new Promise<{ status: "error"; message: string }>((r) => (resolve = r)),
    );
    render(<StatusToggle id={UUID} status="active" action={action} entityLabel="el centro Sede" />);

    await userEvent.click(screen.getByRole("button", { name: "Desactivar el centro Sede" }));
    expect(screen.getByText("Inactivo")).toBeInTheDocument();

    await act(async () =>
      resolve({ status: "error", message: "No tienes permiso para esta operación." }),
    );
    await waitFor(() => expect(screen.getByText("Activo")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("No tienes permiso");
  });
});
