import { readdirSync } from "node:fs";

import { expect, test } from "@playwright/test";

/**
 * Comprobaciones de salud (ADR-064): identidad del despliegue sin secretos ni
 * datos, disponibilidad con estados y métricas protegidas.
 */

test.beforeEach(async ({ page }, info) => {
  void page;
  test.skip(info.project.name !== "escritorio", "Sin interfaz: basta un perfil");
});

const latestMigration = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .at(-1)
  ?.replace(/\.sql$/, "");

test("/api/salud identifica versión, commit, migración y entorno sin secretos", async ({
  request,
}) => {
  const res = await request.get("/api/salud");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  const body = (await res.json()) as Record<string, string>;
  expect(Object.keys(body).sort()).toEqual([
    "commit",
    "environment",
    "migration",
    "release",
    "status",
    "version",
  ]);
  expect(body.status).toBe("ok");
  expect(body.migration).toBe(latestMigration);
  expect(body.release).toMatch(/^(v\d{2}\.\d+|desconocida)$/);
  expect(body.commit).toMatch(/^([0-9a-f]{7,40}|desconocido)$/);
  expect(JSON.stringify(body)).not.toMatch(/sb_|eyJ|secret|key/i);
});

test("/api/salud/listo devuelve solo estados de las dependencias", async ({ request }) => {
  const res = await request.get("/api/salud/listo");
  expect([200, 503]).toContain(res.status());
  const body = (await res.json()) as { status: string; checks: Record<string, string> };
  expect(Object.keys(body.checks).sort()).toEqual(["database", "login"]);
  for (const state of Object.values(body.checks))
    expect(["ok", "error", "no_configurado"]).toContain(state);
  // En el entorno E2E, Auth responde (pasarela) y la app no tiene clave de servicio.
  expect(body.checks.login).toBe("ok");
});

test("/api/salud/metricas exige token y no redirige al acceso", async ({ request }) => {
  const sin = await request.get("/api/salud/metricas", { maxRedirects: 0 });
  expect(sin.status()).toBe(401);
  const mal = await request.get("/api/salud/metricas", {
    headers: { authorization: "Bearer token-incorrecto-de-al-menos-32-caracteres" },
    maxRedirects: 0,
  });
  expect(mal.status()).toBe(401);
});
