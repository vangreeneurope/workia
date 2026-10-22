import { expect, type Page } from "@playwright/test";

/**
 * Inicio de sesión en el entorno E2E (scripts/e2e/gateway.mjs). Cuentas de las
 * semillas sintéticas; contraseña y código TOTP SOLO de pruebas (no existen en
 * ningún entorno real).
 */
export const TEST_PASSWORD = "Prueba-E2E-2026";
export const TEST_TOTP = "123456";

export const USERS = {
  empleada: "empleado1@alfa-demo.example",
  empleado: "empleado2@alfa-demo.example",
  manager: "manager@alfa-demo.example",
  rrhh: "rrhh@alfa-demo.example",
  admin: "admin@alfa-demo.example",
  contabilidad: "contabilidad@alfa-demo.example",
  auditoria: "auditoria@alfa-demo.example",
} as const;

const MFA = new Set<string>([
  USERS.rrhh,
  USERS.admin,
  USERS.contabilidad,
  USERS.auditoria,
  "admin.grupo@grupo-demo.example",
]);

export async function login(page: Page, email: string) {
  await page.goto("/acceder");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /entrar|acceder|iniciar/i }).click();
  if (MFA.has(email)) {
    await expect(page).toHaveURL(/\/perfil\/seguridad/);
    await page.getByLabel(/Código de 6 dígitos/).fill(TEST_TOTP);
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page.getByText("Sesión verificada con segundo factor.")).toBeVisible();
  } else {
    await expect(page).toHaveURL(/\/panel/);
  }
}
