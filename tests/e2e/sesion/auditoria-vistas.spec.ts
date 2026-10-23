import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { login, USERS } from "./helpers";

/**
 * Auditoría de todas las rutas en los tamaños objetivo (docs/UX.md):
 *  - sin desplazamiento horizontal de la página;
 *  - un único <h1> y landmarks principales;
 *  - objetivos táctiles de 44 × 44 px en pantallas táctiles (salvo enlaces
 *    dentro de un texto, exentos según WCAG 2.5.8);
 *  - sin infracciones graves ni críticas de axe-core (WCAG 2.2 A y AA).
 * Usa las semillas sintéticas (supabase/seeds) a través del entorno E2E.
 */

type Viewport = { width: number; height: number; touch: boolean };
const VIEWPORTS: Viewport[] = [
  { width: 360, height: 780, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 768, height: 1024, touch: true },
  { width: 1024, height: 768, touch: false },
  { width: 1440, height: 900, touch: false },
];

const ID = {
  empresaA: "5eed2000-0000-4000-8000-00000000000a",
  centro: "5eed3000-0000-4000-8000-0000000000a1",
  equipo: "5eed4000-0000-4000-8000-0000000000a1",
  membresia: "5eed5000-0000-4000-8000-000000000005",
  persona: "5eed6000-0000-4000-8000-000000000005",
  plantilla: "5eed7000-0000-4000-8000-000000000001",
  calendario: "5eed7200-0000-4000-8000-000000000001",
  asignacion: "5eed7300-0000-4000-8000-000000000001",
  politica: "5eed8100-0000-4000-8000-000000000001",
};

const ROUTES: Record<string, { user: string | null; paths: string[] }> = {
  publico: { user: null, paths: ["/acceder", "/acceder/recuperar", "/terminal"] },
  empleada: {
    user: USERS.empleada,
    paths: [
      "/panel",
      "/horario",
      "/fichajes",
      "/fichajes/historial",
      "/ausencias",
      "/gastos",
      "/gastos/nuevo",
      "/gastos/informes",
      "/informes",
      "/informes/jornada-diaria",
      "/informes/exportaciones",
      "/avisos",
      "/avisos/preferencias",
      "/perfil",
      "/perfil/contrasena",
      "/perfil/privacidad",
      "/perfil/seguridad",
      "/ayuda",
      "/ayuda/primeros-pasos",
      "/ayuda/gastos",
      "/novedades",
    ],
  },
  manager: {
    user: USERS.manager,
    paths: [
      "/equipo",
      "/ausencias/bandeja",
      "/gastos/bandeja",
      "/fichajes/revision",
      "/informes/registro-horario",
    ],
  },
  rrhh: {
    user: USERS.rrhh,
    paths: [
      "/admin",
      "/admin/personas",
      `/admin/personas/${ID.persona}`,
      "/admin/membresias",
      `/admin/membresias/${ID.membresia}`,
      "/admin/aprobadores",
      "/admin/ausencias",
      `/admin/ausencias/politicas/${ID.politica}`,
      "/admin/fichajes",
      "/admin/horarios",
      `/admin/horarios/${ID.asignacion}`,
      "/admin/plantillas",
      `/admin/plantillas/${ID.plantilla}`,
      "/admin/calendarios",
      `/admin/calendarios/${ID.calendario}`,
      "/admin/importar",
      "/admin/privacidad",
      "/informes/saldos",
      "/informes/solicitudes",
    ],
  },
  admin: {
    user: USERS.admin,
    paths: [
      "/admin/centros",
      `/admin/centros/${ID.centro}`,
      "/admin/centros/nuevo",
      "/admin/equipos",
      `/admin/equipos/${ID.equipo}`,
      "/admin/equipos/nuevo",
      "/admin/personas/nueva",
      "/admin/gastos",
      "/admin/avisos",
      "/admin/configuracion",
      "/auditoria",
      "/informes/gastos",
      "/informes/horas-y-descansos",
    ],
  },
  contabilidad: {
    user: USERS.contabilidad,
    paths: ["/gastos/contabilidad", "/informes/cierres", "/informes/aprobaciones"],
  },
  grupo: {
    user: "admin.grupo@grupo-demo.example",
    paths: ["/admin/empresas", `/admin/empresas/${ID.empresaA}`, "/admin/empresas/nueva"],
  },
};

type Finding = { path: string; width: number; kind: string; detail: string };

async function audit(page: Page, path: string, vp: Viewport): Promise<Finding[]> {
  const findings: Finding[] = [];
  const add = (kind: string, detail: string) =>
    findings.push({ path, width: vp.width, kind, detail });
  const res = await page.goto(path);
  if (!res || res.status() >= 400) {
    add("http", `estado ${res?.status() ?? "sin respuesta"}`);
    return findings;
  }
  await page.waitForLoadState("networkidle");
  await expect(page.locator("h1").first()).toBeVisible();

  const layout = await page.evaluate(() => {
    const doc = document.documentElement;
    const h1 = document.querySelectorAll("h1").length;
    const main = document.querySelectorAll("main").length;
    // Elementos que sobresalen del ancho de la ventana (fuera de contenedores con scroll propio).
    const wide: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= window.innerWidth + 1) continue;
      let p: HTMLElement | null = el.parentElement;
      let clipped = false;
      while (p) {
        const s = getComputedStyle(p);
        if (["auto", "scroll", "hidden", "clip"].includes(s.overflowX)) {
          clipped = true;
          break;
        }
        p = p.parentElement;
      }
      if (!clipped) wide.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
      if (wide.length > 3) break;
    }
    // Controles recortados por un contenedor con overflow hidden/clip (inalcanzables).
    const cut: string[] = [];
    const controls = "a[href], button, input:not([type=hidden]), select, textarea";
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(controls))) {
      if (el.closest(".sr-only, [aria-hidden=true]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (["auto", "scroll"].includes(s.overflowX)) break; // se alcanza desplazando
        if (!["hidden", "clip"].includes(s.overflowX)) continue;
        const pr = p.getBoundingClientRect();
        if (r.right > pr.right + 1 || r.left < pr.left - 1)
          cut.push(`${el.tagName.toLowerCase()}「${(el.textContent ?? "").trim().slice(0, 20)}」`);
        break;
      }
      if (cut.length > 3) break;
    }
    return { overflow: doc.scrollWidth - window.innerWidth, h1, main, wide, cut };
  });
  if (layout.overflow > 1) add("desbordamiento", `${layout.overflow}px: ${layout.wide.join(", ")}`);
  if (layout.cut.length > 0) add("recortado", layout.cut.join(", "));
  if (layout.h1 !== 1) add("h1", `${layout.h1} encabezados h1`);
  if (layout.main !== 1) add("landmark", `${layout.main} elementos main`);

  if (vp.touch) {
    const small = await page.evaluate(() => {
      const out: string[] = [];
      const sel =
        "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem]";
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || s.visibility === "hidden") continue;
        if (el.closest("[aria-hidden=true], .sr-only")) continue;
        // Enlaces dentro de un texto: exentos (WCAG 2.5.8).
        if (el.tagName === "A" && s.display === "inline") continue;
        // Casillas y radios: se mide su etiqueta, que es el objetivo real.
        if (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type)) {
          const label =
            el.closest("label") ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
          const lr = label?.getBoundingClientRect();
          if (lr && lr.height >= 44) continue;
        }
        if (r.height < 43.5 || r.width < 43.5) {
          const name = (
            el.getAttribute("aria-label") ??
            el.textContent ??
            (el as HTMLInputElement).name ??
            ""
          )
            .trim()
            .slice(0, 30);
          out.push(
            `${el.tagName.toLowerCase()}「${name}」${Math.round(r.width)}×${Math.round(r.height)}`,
          );
        }
      }
      return out;
    });
    for (const s of small.slice(0, 8)) add("objetivo-tactil", s);
  }

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  for (const v of axe.violations) {
    if (v.impact === "critical" || v.impact === "serious")
      add(
        `axe:${v.impact}`,
        `${v.id}: ${v.nodes
          .slice(0, 2)
          .map((n) => n.target.join(" "))
          .join(" | ")}`,
      );
  }
  return findings;
}

async function contextFor(browser: Browser, vp: Viewport, storageState?: string) {
  return browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.touch && vp.width < 768,
    hasTouch: vp.touch,
    deviceScaleFactor: vp.touch ? 3 : 1,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    storageState,
  });
}

test.describe("auditoría de vistas", () => {
  test.describe.configure({ mode: "parallel" });

  for (const [role, { user, paths }] of Object.entries(ROUTES)) {
    for (const vp of VIEWPORTS) {
      test(`${role} a ${vp.width}px`, async ({ browser }, info) => {
        // Crea sus propios contextos por tamaño: basta con un proyecto.
        test.skip(info.project.name !== "escritorio", "Crea sus propios contextos");
        test.setTimeout(240_000);
        let state: string | undefined;
        if (user) {
          const ctx = await contextFor(browser, VIEWPORTS[4] as Viewport);
          const p = await ctx.newPage();
          await login(p, user);
          state = info.outputPath("estado.json");
          await ctx.storageState({ path: state });
          await ctx.close();
        }
        const ctx = await contextFor(browser, vp, state);
        const page = await ctx.newPage();
        const findings: Finding[] = [];
        for (const path of paths) findings.push(...(await audit(page, path, vp)));
        await ctx.close();
        await info.attach("hallazgos.json", {
          body: JSON.stringify(findings, null, 2),
          contentType: "application/json",
        });
        expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
      });
    }
  }
});
