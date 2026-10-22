import { devices, expect, test, type Page, type Response } from "@playwright/test";

import { login, USERS } from "./helpers";

/**
 * Presupuestos de rendimiento de las pantallas de uso diario en móvil
 * (docs/UX.md, § Rendimiento). Se mide la carga completa de cada ruta con
 * sesión: JavaScript y imágenes transferidos (comprimidos) y consultas a la
 * API de datos que hace el servidor para pintarla (contador de la pasarela E2E).
 */

// Persona dedicada a esta prueba: ninguna otra prueba usa su sesión.
const USER = USERS.empleado;
const GATEWAY = `http://127.0.0.1:54321/__e2e/consultas?email=${encodeURIComponent(USER)}`;

/** Presupuestos. Cambiarlos exige justificarlo en docs/UX.md. */
const BUDGET = {
  /** JavaScript total transferido por ruta (gzip), en KB. */
  scriptKb: 260,
  /** Imágenes transferidas por ruta, en KB. */
  imageKb: 150,
  /** Consultas PostgREST para pintar una ruta (incluye contexto de sesión y avisos). */
  queries: 20,
};

const ROUTES = ["/panel", "/fichajes", "/ausencias", "/gastos", "/gastos/nuevo", "/horario"];

type Metric = { path: string; scriptKb: number; imageKb: number; queries: number; loadMs: number };

async function measure(page: Page, path: string): Promise<Metric> {
  const sizes: Promise<{ type: string; bytes: number }>[] = [];
  const onResponse = (response: Response) => {
    const type = response.request().resourceType();
    if (type !== "script" && type !== "image") return;
    sizes.push(
      response
        .request()
        .sizes()
        .then((s) => ({ type, bytes: s.responseBodySize + s.responseHeadersSize }))
        .catch(() => ({ type, bytes: 0 })),
    );
  };
  page.on("response", onResponse);
  await page.request.delete(GATEWAY);
  const started = Date.now();
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const loadMs = Date.now() - started;
  const queries = ((await (await page.request.get(GATEWAY)).json()) as { count: number }).count;
  page.off("response", onResponse);
  const all = await Promise.all(sizes);
  const kb = (type: string) =>
    Math.round(all.filter((s) => s.type === type).reduce((n, s) => n + s.bytes, 0) / 1024);
  return { path, scriptKb: kb("script"), imageKb: kb("image"), queries, loadMs };
}

test("presupuestos de rendimiento en móvil", async ({ browser }, info) => {
  test.skip(info.project.name !== "movil", "Se mide una vez, con el perfil móvil");
  test.setTimeout(180_000);
  const options = { ...devices["Pixel 7"], locale: "es-ES", timezoneId: "Europe/Madrid" };
  const state = info.outputPath("estado.json");
  const loginContext = await browser.newContext(options);
  await login(await loginContext.newPage(), USER);
  await loginContext.storageState({ path: state });
  await loginContext.close();

  const metrics: Metric[] = [];
  for (const path of ROUTES) {
    // Contexto nuevo por ruta: sin caché del navegador, el caso más caro.
    const context = await browser.newContext({ ...options, storageState: state });
    metrics.push(await measure(await context.newPage(), path));
    await context.close();
  }
  await info.attach("rendimiento.json", {
    body: JSON.stringify({ budget: BUDGET, metrics }, null, 2),
    contentType: "application/json",
  });
  for (const m of metrics) {
    expect.soft(m.scriptKb, `${m.path}: JavaScript`).toBeLessThanOrEqual(BUDGET.scriptKb);
    expect.soft(m.imageKb, `${m.path}: imágenes`).toBeLessThanOrEqual(BUDGET.imageKb);
    expect.soft(m.queries, `${m.path}: consultas`).toBeLessThanOrEqual(BUDGET.queries);
  }
});
