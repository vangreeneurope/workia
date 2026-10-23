import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * Pruebas E2E en Chromium con emulación de móvil y escritorio.
 *
 * - Sin sesión: redirecciones, cabeceras, acceso y PWA.
 * - Con sesión (tests/e2e/sesion/): la app real contra PostgreSQL con las
 *   migraciones y las semillas sintéticas, PostgREST real (RLS real) y una
 *   pasarela de pruebas que simula Auth y Storage (scripts/e2e/). La app debe
 *   construirse con NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321.
 *
 * WebKit (Safari) no está disponible en este entorno: los proyectos "iphone"
 * emulan tamaño, densidad y agente de Safari iOS sobre Chromium (docs/UX.md).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "movil", use: { ...devices["Pixel 7"] } },
    { name: "iphone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
    { name: "escritorio", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "bash scripts/e2e/stack.sh",
      url: "http://127.0.0.1:54321/health",
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
    {
      command: `npm run start -- -p ${PORT}`,
      url: `http://localhost:${PORT}/acceder`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
