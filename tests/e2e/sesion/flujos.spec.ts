import { expect, test, type Page, type Route } from "@playwright/test";

import { login, USERS } from "./helpers";

/**
 * Flujos críticos con una mano (móvil táctil) y con teclado: fichaje,
 * solicitud de ausencia, gasto sin ticket y aprobación. Incluye la
 * recuperación de un reintento cuando la respuesta del servidor se pierde: la
 * operación llega, el navegador no recibe confirmación, se muestra el error y
 * el reintento NO duplica (clave de idempotencia).
 */

test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ page }, info) => {
  void page;
  test.skip(info.project.name !== "movil", "Modifica datos: se ejecuta con un solo perfil");
});

/** La primera Server Action que coincida llega al servidor, pero su respuesta se pierde. */
async function loseFirstResponse(page: Page, path: string) {
  let lost = false;
  await page.route(`**${path}`, async (route: Route) => {
    const request = route.request();
    if (!lost && request.method() === "POST" && request.headers()["next-action"]) {
      lost = true;
      await route.fetch(); // el servidor la procesa
      await route.abort("connectionreset"); // y el navegador no recibe respuesta
      return;
    }
    await route.continue();
  });
}

/** Activa con el teclado (Enter) el control indicado, que debe recibir el foco. */
async function pressWithKeyboard(page: Page, name: string | RegExp) {
  const control = page.getByRole("button", { name });
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press("Enter");
}

/** Fichajes de un tipo en el historial (lista de fichajes de cada jornada). */
async function punchCount(page: Page, kind: string): Promise<number> {
  await page.goto("/fichajes/historial");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return page
    .locator("ol > li")
    .filter({ hasText: new RegExp(`^${kind} · `) })
    .count();
}

/** Un martes a ~6 semanas vista (día laborable y fuera de periodos ya usados). */
function futureTuesday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 42);
  d.setUTCDate(d.getUTCDate() + ((2 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

test("fichaje con teclado y reintento sin duplicar", async ({ page }) => {
  await login(page, USERS.empleada);
  await page.goto("/fichajes");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const first = page.getByRole("button", { name: /^(Entrada|Salida|Pausa|Reanudar)$/ }).first();
  const kind = (await first.textContent())?.trim() ?? "";
  const before = await punchCount(page, kind);
  await page.goto("/fichajes");

  // Salto al contenido: primer elemento enfocable de la página.
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();

  await loseFirstResponse(page, "/fichajes");
  await first.focus();
  await page.keyboard.press("Enter");

  // Ubicación opcional en las semillas: aviso previo con el foco en él.
  const share = page.getByRole("button", { name: "Compartir ubicación y fichar" });
  await expect(share).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Fichar sin ubicación" })).toBeFocused();
  await page.keyboard.press("Enter");

  // Respuesta perdida: nunca se muestra como éxito; queda pendiente de envío.
  await expect(page.getByText(/Sin conexión\. El fichaje se enviará/)).toBeVisible();
  await expect(page.getByText(/1 fichaje\(s\) pendiente\(s\)/)).toBeVisible();

  // Al recuperar la conexión (recarga), se reenvía con la misma clave.
  await page.unrouteAll();
  await page.reload();
  await expect(page.getByText(/Fichajes pendientes enviados/)).toBeVisible();
  await expect(page.getByText(/pendiente\(s\) de enviar/)).toHaveCount(0);

  // El historial tiene exactamente un fichaje más de ese tipo (no dos).
  expect(await punchCount(page, kind), "el reintento no duplica").toBe(before + 1);
});

test("solicitud de ausencia con teclado y reintento sin duplicar", async ({ page }) => {
  await login(page, USERS.empleada);
  await page.goto("/ausencias");
  const day = futureTuesday();
  await page.getByLabel("Tipo de ausencia").selectOption({ label: "Vacaciones" });
  await page.getByLabel("Desde").fill(day);
  await page.getByLabel("Hasta (incluido)").fill(day);

  await loseFirstResponse(page, "/ausencias");
  await pressWithKeyboard(page, "Enviar solicitud");
  await expect(page.getByText(/No se ha podido confirmar el envío/)).toBeVisible();
  // Lo escrito se conserva tras el error.
  await expect(page.getByLabel("Desde")).toHaveValue(day);

  await page.unrouteAll();
  await pressWithKeyboard(page, "Enviar solicitud");
  await expect(page.getByText(/Solicitud enviada/)).toBeVisible();

  const [y, m, d] = day.split("-");
  await page.reload();
  await expect(page.getByText(new RegExp(`${d}/${m}/${y}`))).toHaveCount(1);
});

test("aprobación de la solicitud por el manager con teclado", async ({ page }) => {
  await login(page, USERS.manager);
  await page.goto("/ausencias/bandeja");
  const [y, m, d] = futureTuesday().split("-");
  const card = page
    .locator("li, article, section")
    .filter({ hasText: `${d}/${m}/${y}` })
    .last();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Aprobar" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Solicitud aprobada: la reserva pasa a uso.")).toBeVisible();
});

test("gasto de kilometraje sin ticket con teclado", async ({ page }) => {
  await login(page, USERS.empleada);
  await page.goto("/gastos/nuevo");
  await pressWithKeyboard(page, "Kilometraje");
  await expect(page).toHaveURL(/\/gastos\/[0-9a-f-]{36}$/);

  // Confirmar sin datos: el error recibe el foco y el formulario conserva lo escrito.
  await pressWithKeyboard(page, "Confirmar gasto");
  await expect(page.locator(":focus")).toContainText(/categoría/i);

  await page.getByLabel("Categoría *").selectOption({ index: 1 });
  await page.getByLabel("Fecha *").fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel("Kilómetros *").fill("12,5");
  await expect(page.getByText(/Importe: /)).toBeVisible();
  const payment = page.getByLabel("Forma de pago *");
  if (await payment.isVisible()) await payment.selectOption({ index: 1 });
  await page.getByLabel(/^Notas/).fill("Visita a cliente (dato sintético)");
  await pressWithKeyboard(page, "Confirmar gasto");
  await expect(page.getByRole("status").filter({ hasText: /Gasto listo/ })).toBeVisible();
});
