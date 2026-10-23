import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  punchAction: vi.fn(),
  kioskPunchAction: vi.fn(),
  activateKiosk: vi.fn(),
}));
vi.mock("@/features/time-tracking/actions", () => actions);

import { KioskScreen } from "@/features/time-tracking/components/kiosk";
import { PunchPanel } from "@/features/time-tracking/components/punch-panel";
import { QUEUE_STORAGE_KEY } from "@/features/time-tracking/offline-queue";

const ok = (kind: string) => ({
  status: "success",
  message: "Registrada.",
  punch: { kind, serverAt: "2026-10-21T06:02:00.000Z", status: "open", duplicate: false },
});

function panel(props: Partial<React.ComponentProps<typeof PunchPanel>> = {}) {
  return render(
    <PunchPanel
      state={null}
      startedAt={null}
      timeZone="Europe/Madrid"
      locationMode="off"
      locationNotice={null}
      selfieEnabled={false}
      {...props}
    />,
  );
}

function sent(call: number): Record<string, string> {
  const fd = actions.punchAction.mock.calls[call]?.[0] as FormData;
  return Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<
    string,
    string
  >;
}

beforeEach(() => {
  window.localStorage.clear();
  actions.punchAction.mockReset();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pantalla de fichaje", () => {
  it("muestra solo las acciones posibles", () => {
    panel({ state: "open", startedAt: "2026-10-21T06:00:00.000Z" });
    expect(screen.getByRole("button", { name: "Pausa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salida" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Entrada" })).toBeNull();
    expect(screen.getByText(/Desde las 08:00/)).toBeInTheDocument();
  });

  it("un doble toque envía un solo fichaje", async () => {
    let resolve: (v: unknown) => void = () => {};
    actions.punchAction.mockImplementation(() => new Promise((r) => (resolve = r)));
    panel();
    const button = screen.getByRole("button", { name: "Entrada" });
    await userEvent.dblClick(button);
    expect(actions.punchAction).toHaveBeenCalledTimes(1);
    expect(sent(0)).toMatchObject({
      kind: "start",
      source: "mobile",
      location_status: "not_requested",
    });
    await act(async () => resolve(ok("start")));
    expect(await screen.findByText(/Hora oficial: 08:02/)).toBeInTheDocument();
  });

  it("sin conexión guarda el fichaje con su clave y lo reintenta con la misma", async () => {
    actions.punchAction.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    panel();
    await userEvent.click(screen.getByRole("button", { name: "Entrada" }));
    expect(await screen.findByText(/Sin conexión/)).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem(QUEUE_STORAGE_KEY) ?? "[]") as {
      key: string;
    }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.key).toBe(sent(0).idempotency_key);
    expect(window.localStorage.getItem(QUEUE_STORAGE_KEY)).not.toMatch(/latitude/);
    // La pantalla ya ofrece lo que vendría después de la entrada pendiente.
    expect(screen.getByRole("button", { name: "Pausa" })).toBeInTheDocument();

    actions.punchAction.mockResolvedValue(ok("start"));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(actions.punchAction).toHaveBeenCalledTimes(2));
    expect(sent(1).idempotency_key).toBe(sent(0).idempotency_key);
    await waitFor(() => expect(window.localStorage.getItem(QUEUE_STORAGE_KEY)).toBe("[]"));
  });

  it("explica el uso de la ubicación antes de pedirla y permite fichar sin ella", async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
    actions.punchAction.mockResolvedValue(ok("start"));
    panel({
      locationMode: "optional",
      locationNotice: "Usamos una lectura para comprobar el centro de trabajo.",
    });
    await userEvent.click(screen.getByRole("button", { name: "Entrada" }));
    expect(screen.getByText(/comprobar el centro de trabajo/)).toBeInTheDocument();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Fichar sin ubicación" }));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(sent(0)).toMatchObject({ location_status: "denied" });
    expect(sent(0).latitude).toBeUndefined();
  });

  it("si el navegador deniega la ubicación exigida, ficha igualmente", async () => {
    const getCurrentPosition = vi.fn((_ok: unknown, fail: (e: { code: number }) => void) =>
      fail({ code: 1 }),
    );
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition },
    });
    actions.punchAction.mockResolvedValue(ok("start"));
    panel({
      locationMode: "required",
      locationNotice: "Exigimos una lectura al fichar para verificar el centro.",
    });
    await userEvent.click(screen.getByRole("button", { name: "Entrada" }));
    expect(screen.getByText(/queda una incidencia/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Compartir ubicación y fichar" }));
    await waitFor(() => expect(actions.punchAction).toHaveBeenCalledTimes(1));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(sent(0)).toMatchObject({ location_status: "denied" });
  });

  it("la selfie solo aparece con la política activada y es opcional", async () => {
    const { unmount } = panel();
    expect(screen.queryByLabelText(/Selfie opcional/)).toBeNull();
    unmount();
    actions.punchAction.mockResolvedValue(ok("start"));
    panel({ selfieEnabled: true });
    expect(screen.getByLabelText(/Selfie opcional/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Entrada" }));
    const fd = actions.punchAction.mock.calls[0]?.[0] as FormData;
    expect(fd.get("selfie")).toBeNull();
  });
});

describe("terminal compartido", () => {
  it("pide acción, código y PIN, y no muestra datos de la persona", async () => {
    actions.kioskPunchAction.mockResolvedValue({
      status: "success",
      message: "Entrada registrada.",
      kind: "start",
      serverAt: "2026-10-21T06:02:00.000Z",
      timeZone: "Europe/Madrid",
    });
    render(<KioskScreen deviceName="Entrada principal" centerName="Centro A1" />);
    await userEvent.click(screen.getByRole("button", { name: "Entrada" }));
    await userEvent.type(screen.getByLabelText("Código de empleado"), "A-007");
    const pin = screen.getByLabelText("PIN");
    expect(pin).toHaveAttribute("type", "password");
    await userEvent.type(pin, "482913");
    await userEvent.click(screen.getByRole("button", { name: "Fichar" }));
    expect(await screen.findByText("Fichaje registrado")).toBeInTheDocument();
    expect(screen.getByText(/Hora: 08:02/)).toBeInTheDocument();
    expect(screen.queryByText(/A-007/)).toBeNull();
  });

  it("vuelve al inicio con los campos vacíos al terminar", async () => {
    actions.kioskPunchAction.mockResolvedValue({
      status: "error",
      message: "Código o PIN incorrectos.",
    });
    render(<KioskScreen deviceName="Entrada principal" centerName="Centro A1" />);
    await userEvent.click(screen.getByRole("button", { name: "Salida" }));
    await userEvent.type(screen.getByLabelText("Código de empleado"), "A-007");
    await userEvent.type(screen.getByLabelText("PIN"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Fichar" }));
    expect(await screen.findByText("Código o PIN incorrectos.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Volver" }));
    await userEvent.click(screen.getByRole("button", { name: "Entrada" }));
    expect(screen.getByLabelText("Código de empleado")).toHaveValue("");
    expect(screen.getByLabelText("PIN")).toHaveValue("");
  });
});
