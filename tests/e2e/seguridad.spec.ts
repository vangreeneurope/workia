import { expect, test } from "@playwright/test";

test("cabeceras de seguridad en las páginas", async ({ request }) => {
  const res = await request.get("/acceder");
  expect(res.status()).toBe(200);
  const h = res.headers();
  const csp = h["content-security-policy"] ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("script-src-attr 'none'");
  expect(csp).toContain("form-action 'self'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["cross-origin-opener-policy"]).toBe("same-origin");
  expect(h["cross-origin-resource-policy"]).toBe("same-origin");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["permissions-policy"]).toContain("microphone=()");
  expect(h["permissions-policy"]).toContain("geolocation=(self)");
  expect(h["x-powered-by"]).toBeUndefined();
  // Identificador de petición para correlacionar con la auditoría (sin datos personales).
  expect(h["x-request-id"]).toMatch(/^[A-Za-z0-9-]{8,64}$/);
});

test("un x-request-id externo inválido se sustituye", async ({ request }) => {
  const res = await request.get("/acceder", {
    headers: { "x-request-id": "<script>alert(1)</script>" },
  });
  expect(res.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
});

test("seguridad de la cuenta, privacidad y consola de privacidad exigen sesión", async ({
  page,
  request,
}) => {
  for (const path of ["/perfil/seguridad", "/perfil/privacidad", "/admin/privacidad"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/acceder\?siguiente=/);
  }
  const copy = await request.get(
    "/admin/privacidad/solicitudes/00000000-0000-4000-8000-000000000000/copia",
    {
      maxRedirects: 0,
    },
  );
  expect(copy.status()).toBe(307);
  expect(copy.headers()["location"]).toContain("/acceder");
});

test("la página de acceso no se puede incrustar en otro sitio", async ({ request }) => {
  const res = await request.get("/acceder");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});
