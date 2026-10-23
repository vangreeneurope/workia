import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

// Versión visible, cierre de sesión vencida, autoguardado, novedades y ayuda
// (ADR-066 a ADR-069). Datos sintéticos del entorno E2E.

test("la versión vAA.N aparece bajo el formulario de acceso", async ({ page }) => {
  await page.goto("/acceder");
  await expect(page.getByText(/Workia v\d{2}\.\d+/)).toBeVisible();
});

test("ayuda: landing con apartados y manual paso a paso", async ({ page }) => {
  await login(page, USERS.empleada);
  await page.getByRole("link", { name: "Ayuda y manual de uso" }).click();
  await expect(
    page.getByRole("heading", { name: "Ayuda y manual de uso", level: 1 }),
  ).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("link", { name: /^Fichajes/ })
    .click();
  await expect(page.getByRole("heading", { name: "Fichajes", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fichar la jornada" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Otros apartados de la ayuda" })).toBeVisible();
});

test("novedades: cada cambio de funcionamiento explica el antes y el ahora", async ({ page }) => {
  await login(page, USERS.empleado);
  await page
    .getByRole("banner")
    .getByRole("link", { name: /^Novedades/ })
    .click();
  await expect(page.getByRole("heading", { name: "Novedades", level: 1 })).toBeVisible();
  const cambio = page.locator("li").filter({
    has: page.getByRole("heading", { name: "La sesión se cierra sola al cabo de una hora" }),
  });
  await expect(cambio.getByRole("heading", { name: "Antes" })).toBeVisible();
  await expect(cambio.getByRole("heading", { name: "Ahora, paso a paso" })).toBeVisible();
});

test("aviso de actualización: se ve al entrar y no vuelve tras «Entendido»", async ({ page }) => {
  await login(page, USERS.manager);
  const aviso = page.getByText(/^Workia se ha actualizado a la versión v\d{2}\.\d+$/);
  // Sin versiones calculadas (build sin historia de git) no hay aviso que probar.
  test.skip((await aviso.count()) === 0, "Build sin versiones de novedades");
  await expect(aviso).toBeVisible();
  await page.getByRole("button", { name: "Entendido" }).click();
  await expect(aviso).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(aviso).toBeHidden();
});

test("autoguardado: el texto escrito se recupera al volver a la pantalla", async ({ page }) => {
  await login(page, USERS.empleada);
  await page.goto("/ausencias");
  const nota = page.getByLabel("Comentario para quien aprueba (opcional)");
  await nota.fill("Texto de prueba sintético");
  // Da tiempo al guardado diferido.
  await page.waitForTimeout(800);
  await page.reload();
  await expect(nota).toHaveValue("Texto de prueba sintético");
  await expect(
    page.getByText("Hemos recuperado el texto que escribiste en este formulario."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Descartar" }).click();
  await expect(nota).toHaveValue("");
});

test("una sesión vencida se cierra en el acceso y explica el motivo", async ({ page }) => {
  await login(page, USERS.empleada);
  await page.goto("/acceder?motivo=caducada");
  await expect(
    page.getByText(/Tu sesión se ha cerrado porque ha pasado el tiempo máximo/),
  ).toBeVisible();
  // Ya no hay sesión: la zona privada vuelve a pedir acceso.
  await page.goto("/panel");
  await expect(page).toHaveURL(/\/acceder/);
});

test("Administración › Configuración: cambia la duración de la sesión", async ({ page }) => {
  await login(page, USERS.admin);
  await page.goto("/admin/configuracion");
  await expect(page.getByRole("heading", { name: "Configuración", level: 1 })).toBeVisible();
  const minutos = page.getByLabel("Duración máxima de la sesión (minutos)");
  await minutos.fill("5");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Mínimo 15 minutos")).toBeVisible();
  await minutos.fill("60");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(
    page.getByText("Guardado: las sesiones se cerrarán a los 60 minutos de entrar.").first(),
  ).toBeVisible();
});
