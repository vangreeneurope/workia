import {
  applyFields,
  clearAllDrafts,
  DRAFT_TTL_MS,
  formKey,
  isDraftable,
  loadDrafts,
  readFields,
  saveDrafts,
} from "@/lib/drafts";

function form(html: string): HTMLFormElement {
  document.body.innerHTML = `<form>${html}</form>`;
  return document.querySelector("form") as HTMLFormElement;
}

describe("borradores de formularios", () => {
  afterEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = "";
  });

  it("guarda texto, fechas, listas y áreas de texto, nunca contraseñas, PIN ni códigos", () => {
    const f = form(`
      <input name="title" value="Viaje" />
      <input name="day" type="date" value="2026-10-23" />
      <textarea name="comment">Motivo</textarea>
      <select name="kind"><option value="a">A</option><option value="b" selected>B</option></select>
      <input name="password" type="password" value="secreto" />
      <input name="pin" value="123456" />
      <input name="otp" autocomplete="one-time-code" value="000000" />
      <input name="token" type="hidden" value="x" />
      <input name="file" type="file" />
      <input name="accepted" type="checkbox" checked />
      <div data-sin-borrador><input name="private_note" value="no" /></div>
      <input name="$ACTION_ID_1" value="x" />
    `);
    expect(readFields(f)).toEqual({
      title: "Viaje",
      day: "2026-10-23",
      comment: "Motivo",
      kind: "b",
    });
    const pin = f.elements.namedItem("pin") as Element;
    expect(isDraftable(pin)).toBe(false);
  });

  it("recupera un borrador en el formulario y avisa a React con eventos", () => {
    const f = form(`<input name="title" /><textarea name="comment"></textarea>
      <select name="kind"><option value="a">A</option><option value="b">B</option></select>`);
    const seen: string[] = [];
    f.addEventListener("input", (e) => seen.push((e.target as HTMLInputElement).name));
    const changed = applyFields(f, { title: "Hola", comment: "Texto", kind: "b", unknown: "x" });
    expect(changed).toBe(3);
    expect(readFields(f)).toEqual({ title: "Hola", comment: "Texto", kind: "b" });
    expect(seen).toEqual(["title", "comment", "kind"]);
    // Una opción que ya no existe en la lista no se fuerza.
    expect(applyFields(f, { kind: "z" })).toBe(0);
  });

  it("la clave identifica pantalla y formulario", () => {
    const f = form(`<input name="title" /><textarea name="comment"></textarea>`);
    expect(formKey("/gastos/1", f, 0)).toBe("/gastos/1|#0|title,comment");
    f.id = "gasto";
    expect(formKey("/gastos/1", f, 0)).toBe("/gastos/1|gasto|title,comment");
  });

  it("separa por persona, caduca a las 24 horas y se borra entero al cerrar sesión", () => {
    const now = Date.now();
    saveDrafts("u1", {
      a: { savedAt: now, fields: { title: "uno" } },
      viejo: { savedAt: now - DRAFT_TTL_MS - 1, fields: { title: "viejo" } },
    });
    saveDrafts("u2", { b: { savedAt: now, fields: { title: "dos" } } });
    expect(Object.keys(loadDrafts("u1", now))).toEqual(["a"]);
    expect(Object.keys(loadDrafts("u2", now))).toEqual(["b"]);
    window.localStorage.setItem("otra-cosa", "1");
    clearAllDrafts();
    expect(loadDrafts("u1", now)).toEqual({});
    expect(loadDrafts("u2", now)).toEqual({});
    expect(window.localStorage.getItem("otra-cosa")).toBe("1");
  });

  it("tolera datos corruptos en el almacenamiento", () => {
    window.localStorage.setItem("workia:borradores:u1", "{no es json");
    expect(loadDrafts("u1")).toEqual({});
  });
});
