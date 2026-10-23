import { APARTADOS_AYUDA } from "@/content/ayuda";
import { NOVEDADES } from "@/content/novedades";
import {
  novedadesPublicadas,
  novedadesSinVer,
  ultimaVersionConNovedades,
} from "@/features/novedades/catalog";

describe("catálogo de novedades", () => {
  it("ids únicos, estables y en minúsculas con guiones", () => {
    const ids = NOVEDADES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("la más reciente primero y con fecha válida", () => {
    const fechas = NOVEDADES.map((n) => n.fecha);
    for (const f of fechas) expect(f).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([...fechas].sort().reverse()).toEqual(fechas);
  });

  it("un cambio de funcionamiento explica el antes y el ahora paso a paso", () => {
    for (const n of NOVEDADES) {
      expect(n.titulo.length).toBeGreaterThan(5);
      expect(n.resumen.length).toBeGreaterThan(20);
      if (n.tipo === "funcionamiento") {
        expect(n.antes?.length ?? 0).toBeGreaterThan(20);
        expect(n.ahora?.length ?? 0).toBeGreaterThanOrEqual(2);
      } else {
        expect(n.antes).toBeUndefined();
        expect(n.ahora).toBeUndefined();
      }
    }
  });

  it("calcula qué es nuevo para cada persona según la última versión vista", () => {
    const [primera, segunda] = NOVEDADES;
    if (!primera || !segunda) throw new Error("Se esperan al menos dos novedades");
    const versions = { [primera.id]: "v26.30", [segunda.id]: "v26.25" };
    expect(ultimaVersionConNovedades(versions)).toBe("v26.30");
    expect(ultimaVersionConNovedades({})).toBeNull();
    expect(novedadesSinVer(null, versions).map((n) => n.id)).toEqual([primera.id, segunda.id]);
    expect(novedadesSinVer("v26.25", versions).map((n) => n.id)).toEqual([primera.id]);
    expect(novedadesSinVer("v26.30", versions)).toEqual([]);
    // Las aún no publicadas (sin versión) no avisan, pero se listan.
    expect(novedadesPublicadas({}).every((n) => n.version === null)).toBe(true);
    expect(novedadesSinVer(null, {})).toEqual([]);
  });
});

describe("manual de ayuda", () => {
  it("apartados únicos, cada uno con tareas paso a paso", () => {
    const slugs = APARTADOS_AYUDA.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs[0]).toBe("primeros-pasos");
    for (const a of APARTADOS_AYUDA) {
      expect(a.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(a.tareas.length).toBeGreaterThan(0);
      for (const t of a.tareas) expect(t.pasos.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("cubre todos los apartados del menú principal", () => {
    const slugs = new Set(APARTADOS_AYUDA.map((a) => a.slug));
    for (const s of [
      "fichajes",
      "horario",
      "ausencias",
      "gastos",
      "equipo",
      "informes",
      "auditoria",
      "administracion",
      "perfil",
      "avisos",
    ]) {
      expect(slugs.has(s)).toBe(true);
    }
  });
});
