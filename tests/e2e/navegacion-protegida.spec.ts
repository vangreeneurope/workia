import { expect, test } from "@playwright/test";

/**
 * Pruebas sin sesión: no requieren un proyecto Supabase real porque el proxy
 * redirige antes de consultar datos. Los flujos con sesión se añadirán cuando
 * exista un proyecto de pruebas (ver docs/PLAN_DESARROLLO.md).
 */

test("la raíz lleva a la pantalla de acceso sin sesión", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/acceder$/);
  await expect(page.getByRole("heading", { name: "Portal del empleado" })).toBeVisible();
});

test("una ruta protegida redirige conservando el destino", async ({ page }) => {
  await page.goto("/fichajes");
  await expect(page).toHaveURL(/\/acceder\?siguiente=%2Ffichajes$/);
});

test("el formulario de acceso está en español y es accesible", async ({ page }) => {
  await page.goto("/acceder");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
  await expect(page.getByRole("button", { name: "Acceder" })).toBeVisible();
});

test("valida los campos sin llamar a Supabase", async ({ page }) => {
  await page.goto("/acceder");
  await page.getByRole("button", { name: "Acceder" }).click();
  await expect(page.getByText("Introduce un correo electrónico válido")).toBeVisible();
});

test("la recuperación de contraseña es pública", async ({ page }) => {
  await page.goto("/acceder/recuperar");
  await expect(page.getByRole("heading", { name: "Recuperar contraseña" })).toBeVisible();
});

test("el manifiesto PWA está disponible", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.lang).toBe("es-ES");
  expect(manifest.display).toBe("standalone");
});

test("envía cabeceras de seguridad", async ({ request }) => {
  const response = await request.get("/acceder");
  const headers = response.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("la página sin conexión es accesible sin sesión", async ({ request }) => {
  const response = await request.get("/offline.html");
  expect(response.ok()).toBeTruthy();
});

test("el enlace de confirmación inválido vuelve a acceder con aviso", async ({ page }) => {
  await page.goto("/auth/confirmar?token_hash=x&type=desconocido");
  await expect(page).toHaveURL(/\/acceder\?error=enlace$/);
  await expect(page.getByText("El enlace no es válido o ha caducado")).toBeVisible();
});

test("la administración y la exportación exigen sesión", async ({ page, request }) => {
  await page.goto("/admin/personas");
  await expect(page).toHaveURL(/\/acceder\?siguiente=%2Fadmin%2Fpersonas$/);
  const response = await request.get("/admin/personas/exportar", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toContain("/acceder");
});
