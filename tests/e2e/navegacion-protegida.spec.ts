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

test("el horario y su administración exigen sesión", async ({ page }) => {
  for (const path of [
    "/horario?vista=mes",
    "/admin/horarios",
    "/admin/plantillas",
    "/admin/calendarios",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/acceder\?siguiente=/);
  }
});

test("el fichaje, el historial y la revisión exigen sesión", async ({ page }) => {
  for (const path of [
    "/fichajes",
    "/fichajes/historial",
    "/fichajes/revision",
    "/admin/fichajes",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/acceder\?siguiente=/);
  }
});

test("el terminal sin activar pide su código y no muestra datos", async ({ page }) => {
  await page.goto("/terminal");
  await expect(page).toHaveURL(/\/terminal$/);
  await expect(page.getByRole("heading", { name: "Activar terminal de fichaje" })).toBeVisible();
  await expect(page.getByLabel("Código del terminal")).toBeVisible();
  await expect(page.getByLabel("PIN")).toHaveCount(0);
  const box = await page.getByRole("button", { name: "Activar" }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("un código de terminal con formato incorrecto se rechaza sin activar nada", async ({
  page,
  context,
}) => {
  await page.goto("/terminal");
  await page.getByLabel("Código del terminal").fill("no-es-un-token");
  await page.getByRole("button", { name: "Activar" }).click();
  // Error junto al campo (además del resumen de errores, que enlaza con él).
  await expect(page.locator("#token-error")).toHaveText(/El código del terminal no es válido/);
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "terminal")).toBeUndefined();
});

test("una cookie de terminal falsa no da acceso al fichaje", async ({ page, context, baseURL }) => {
  await context.addCookies([
    { name: "terminal", value: "a".repeat(64), url: `${baseURL}/terminal` },
  ]);
  await page.goto("/terminal");
  await expect(page.getByRole("heading", { name: "Activar terminal de fichaje" })).toBeVisible();
  await expect(page.getByLabel("PIN")).toHaveCount(0);
});

test("las ausencias, la bandeja y los justificantes exigen sesión", async ({ page, request }) => {
  for (const path of ["/ausencias", "/ausencias/bandeja", "/admin/ausencias"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/acceder\?siguiente=/);
  }
  const response = await request.get(
    "/ausencias/justificante/00000000-0000-4000-8000-000000000000",
    {
      maxRedirects: 0,
    },
  );
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toContain("/acceder");
});

test("los gastos, la revisión y los tickets exigen sesión", async ({ page, request }) => {
  for (const path of [
    "/gastos",
    "/gastos/nuevo",
    "/gastos/00000000-0000-4000-8000-000000000000",
    "/admin/gastos",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/acceder\?siguiente=/);
  }
  // El ticket nunca se sirve sin sesión (ni URL permanente ni pública).
  const response = await request.get("/gastos/ticket/00000000-0000-4000-8000-000000000000", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toContain("/acceder");
});

test("informes, bandeja, contabilidad y descargas contables exigen sesión", async ({
  page,
  request,
}) => {
  for (const path of [
    "/gastos/informes",
    "/gastos/informes/00000000-0000-4000-8000-000000000000",
    "/gastos/bandeja",
    "/gastos/contabilidad",
    "/gastos/contabilidad/lotes/00000000-0000-4000-8000-000000000000",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/acceder\?siguiente=/);
  }
  // El paquete contable nunca se sirve sin sesión.
  const response = await request.get(
    "/gastos/contabilidad/descargas/00000000-0000-4000-8000-000000000000",
    { maxRedirects: 0 },
  );
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toContain("/acceder");
});

test("la bandeja de avisos exige sesión y las rutas de máquina se protegen solas", async ({
  page,
  request,
}) => {
  for (const path of ["/avisos", "/avisos/preferencias", "/admin/avisos"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/acceder\?siguiente=/);
  }
  // El enlace de un correo no da acceso sin sesión.
  const open = await request.get("/avisos/00000000-0000-4000-8000-000000000000", {
    maxRedirects: 0,
  });
  expect(open.status()).toBe(307);
  expect(open.headers()["location"]).toContain("/acceder");
  // Tareas programadas: sin el secreto, 401 (no se ejecuta nada).
  const cron = await request.post("/api/tareas", { maxRedirects: 0 });
  expect(cron.status()).toBe(401);
  const wrong = await request.post("/api/tareas", {
    maxRedirects: 0,
    headers: { authorization: `Bearer ${"x".repeat(40)}` },
  });
  expect(wrong.status()).toBe(401);
  // Webhook sin proveedor configurado: no existe.
  const hook = await request.post("/api/correo/webhook", { maxRedirects: 0, data: { events: [] } });
  expect(hook.status()).toBe(404);
});

test("informes, exportaciones y auditoría exigen sesión; la descarga no es un enlace público", async ({
  page,
  request,
}) => {
  for (const path of [
    "/informes",
    "/informes/registro-horario?desde=2026-10-01&hasta=2026-10-31",
    "/informes/exportaciones",
    "/auditoria",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/acceder\?siguiente=/);
  }
  // Conocer el identificador de una exportación no permite descargarla sin sesión.
  const download = await request.get("/informes/descargas/00000000-0000-4000-8000-000000000000", {
    maxRedirects: 0,
  });
  expect(download.status()).toBe(307);
  expect(download.headers()["location"]).toContain("/acceder");
});
