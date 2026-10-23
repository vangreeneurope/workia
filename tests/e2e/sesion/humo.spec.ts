import { expect, test } from "@playwright/test";

import { login, USERS } from "./helpers";

test("una empleada entra y ve su panel con la empresa activa", async ({ page }) => {
  await login(page, USERS.empleada);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // La empresa activa está siempre visible (cabecera en móvil, barra lateral en escritorio).
  await expect(
    page.getByText("Alfa Servicios Demo").filter({ visible: true }).first(),
  ).toBeVisible();
});

test("RR. HH. verifica el segundo factor y entra en administración", async ({ page }) => {
  await login(page, USERS.rrhh);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Administración", level: 1 })).toBeVisible();
});
