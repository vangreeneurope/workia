import { act, fireEvent, render, screen } from "@testing-library/react";

import { DraftKeeper } from "@/components/layout/draft-keeper";
import { FORM_SUCCESS_EVENT, loadDrafts, saveDrafts } from "@/lib/drafts";

let pathname = "/ausencias";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const USER = "u1";
const KEY = "/ausencias|#0|note";

function Page() {
  return (
    <main id="contenido">
      <form>
        <label htmlFor="note">Comentario</label>
        <input id="note" name="note" defaultValue="" />
        <button type="submit">Enviar</button>
      </form>
    </main>
  );
}

function renderPage() {
  return render(
    <>
      <Page />
      <DraftKeeper userId={USER} />
    </>,
  );
}

describe("DraftKeeper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pathname = "/ausencias";
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("recupera el borrador al volver a la pantalla y permite descartarlo", () => {
    saveDrafts(USER, { [KEY]: { savedAt: Date.now(), fields: { note: "Texto guardado" } } });
    renderPage();
    act(() => vi.advanceTimersByTime(10));
    expect(screen.getByLabelText("Comentario")).toHaveValue("Texto guardado");
    expect(screen.getByText(/Hemos recuperado el texto/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(screen.getByLabelText("Comentario")).toHaveValue("");
    expect(loadDrafts(USER)).toEqual({});
  });

  it("no sobrescribe lo que la persona ya ha empezado a escribir", () => {
    renderPage();
    act(() => vi.advanceTimersByTime(10));
    const input = screen.getByLabelText("Comentario");
    fireEvent.input(input, { target: { value: "Nuevo" } });
    // Un borrador antiguo aparece después (por ejemplo, de otra pestaña).
    saveDrafts(USER, { [KEY]: { savedAt: Date.now(), fields: { note: "Viejo" } } });
    act(() => vi.advanceTimersByTime(3000));
    expect(input).toHaveValue("Nuevo");
    expect(screen.queryByText(/Hemos recuperado el texto/)).not.toBeInTheDocument();
  });

  it("guarda mientras se escribe y borra el borrador tras un envío correcto", () => {
    renderPage();
    const input = screen.getByLabelText("Comentario");
    fireEvent.input(input, { target: { value: "Motivo" } });
    act(() => vi.advanceTimersByTime(500));
    expect(loadDrafts(USER)[KEY]?.fields).toEqual({ note: "Motivo" });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    act(() => {
      window.dispatchEvent(new Event(FORM_SUCCESS_EVENT));
    });
    expect(loadDrafts(USER)).toEqual({});
  });

  it("un envío sin confirmar (sesión cerrada) se conserva para recuperarlo", () => {
    const { unmount } = renderPage();
    const input = screen.getByLabelText("Comentario");
    fireEvent.input(input, { target: { value: "Pendiente" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    unmount();
    // Vuelve a entrar y llega a la misma pantalla.
    renderPage();
    act(() => vi.advanceTimersByTime(10));
    expect(screen.getByLabelText("Comentario")).toHaveValue("Pendiente");
  });
});
