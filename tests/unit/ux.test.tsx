import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormMessage } from "@/components/admin/form-message";
import { FormField } from "@/components/form-field";
import { Announcer } from "@/components/layout/announcer";
import { NETWORK_ERROR_MESSAGE, networkSafe, safeCall } from "@/lib/network";
import type { FormState } from "@/lib/forms";

describe("FormMessage", () => {
  it("con errores de campo muestra un resumen enfocado que lleva a cada campo", () => {
    const state: FormState = {
      status: "error",
      message: "Revisa los datos.",
      fieldErrors: { name: ["Escribe un nombre"], email: undefined, code: ["Código no válido"] },
    };
    render(
      <form>
        <FormMessage state={state} />
        <input name="name" aria-label="Nombre" />
        <input name="code" aria-label="Código" />
      </form>,
    );
    expect(screen.getByText("Revisa 2 campos")).toBeInTheDocument();
    expect(document.activeElement).toContainElement(screen.getByText("Revisa 2 campos"));
    fireEvent.click(screen.getByRole("link", { name: "Código no válido" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Código"));
  });

  it("sin errores de campo muestra solo el mensaje y no mueve el foco", () => {
    render(<FormMessage state={{ status: "success", message: "Guardado." }} />);
    expect(screen.getByText("Guardado.")).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("Announcer", () => {
  it("el éxito se anuncia antes de pintar y sigue visible aunque el formulario desaparezca", async () => {
    const { rerender } = render(<Announcer />);
    const approve = networkSafe(async (): Promise<FormState> => ({
      status: "success",
      message: "Solicitud aprobada.",
    }));
    let state: FormState = { status: "idle" };
    await act(async () => {
      state = await approve(state, new FormData());
    });
    rerender(
      <>
        <Announcer />
        <FormMessage state={state} />
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Solicitud aprobada.");
    expect(screen.getAllByText("Solicitud aprobada.")).toHaveLength(1);
    rerender(<Announcer />);
    expect(screen.getByRole("status")).toHaveTextContent("Solicitud aprobada.");
  });
});

describe("FormField", () => {
  it("enlaza ayuda y error con aria-describedby", () => {
    render(
      <FormField name="iban" label="IBAN" description="24 caracteres" errors={["Inválido"]} />,
    );
    const input = screen.getByLabelText("IBAN");
    expect(input).toHaveAttribute("aria-describedby", "iban-description iban-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
});

describe("networkSafe y safeCall", () => {
  it("un fallo de red se convierte en error visible, nunca en éxito", async () => {
    const failing = networkSafe(async (): Promise<FormState> => {
      throw new TypeError("Failed to fetch");
    });
    await expect(failing({ status: "idle" }, new FormData())).resolves.toEqual({
      status: "error",
      message: NETWORK_ERROR_MESSAGE,
    });
    await expect(
      safeCall(async (): Promise<FormState> => Promise.reject(new Error("500"))),
    ).resolves.toMatchObject({ status: "error" });
  });

  it("deja pasar el resultado del servidor y las redirecciones de Next.js", async () => {
    const ok = networkSafe(async (): Promise<FormState> => ({ status: "success" }));
    await expect(ok({ status: "idle" }, new FormData())).resolves.toEqual({ status: "success" });
    const redirecting = networkSafe(async (): Promise<FormState> => {
      throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/panel;307;" });
    });
    await expect(redirecting({ status: "idle" }, new FormData())).rejects.toThrow("NEXT_REDIRECT");
  });
});
