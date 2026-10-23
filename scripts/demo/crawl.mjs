#!/usr/bin/env node
/**
 * Genera la demostración estática de Workia (ADR-070) recorriendo la app real
 * construida en modo demo contra el entorno E2E (datos SINTÉTICOS de
 * supabase/seeds; ninguna persona real). Solo hace peticiones GET: no crea ni
 * modifica nada. Guarda cada pantalla como <ruta>/index.html, copia los
 * estáticos y añade la portada, la página 404 y scripts/demo/demo.js.
 *
 * Variables: DEMO_APP_URL (http://localhost:3200), DEMO_BASE_PATH (/workia),
 * DEMO_OUT (demo-out). Uso: node scripts/demo/crawl.mjs (lo llama build.sh).
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const APP = process.env.DEMO_APP_URL ?? "http://localhost:3200";
const BASE = process.env.DEMO_BASE_PATH ?? "/workia";
const OUT = process.env.DEMO_OUT ?? "demo-out";
const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_PAGES = 400;

// Cuenta y códigos SOLO del entorno E2E (tests/e2e/sesion/helpers.ts).
const DEMO_USER = "admin@alfa-demo.example";
const TEST_PASSWORD = "Prueba-E2E-2026";
const TEST_TOTP = "123456";

/** Rutas de partida además de los enlaces que se descubran. */
const SEEDS = [
  "/panel",
  "/horario",
  "/fichajes",
  "/fichajes/historial",
  "/fichajes/revision",
  "/ausencias",
  "/ausencias/bandeja",
  "/gastos",
  "/gastos/nuevo",
  "/gastos/informes",
  "/gastos/bandeja",
  "/equipo",
  "/informes",
  "/informes/exportaciones",
  "/auditoria",
  "/avisos",
  "/avisos/preferencias",
  "/admin",
  "/perfil",
  "/perfil/contrasena",
  "/perfil/privacidad",
  "/perfil/seguridad",
  "/ayuda",
  "/novedades",
];

/**
 * Rutas que no se rastrean: acceso y retorno de Auth, rutas de máquina,
 * descargas de archivos (Route Handlers) y la apertura de un aviso, que lo
 * marca como leído.
 */
const SKIP = [
  /^\/acceder/,
  /^\/auth\//,
  /^\/api\//,
  /^\/terminal/,
  /\/descargas\//,
  /\/exportar$/,
  /\/copia$/,
  /^\/gastos\/ticket\//,
  /^\/ausencias\/justificante\//,
  /^\/avisos\/[0-9a-f-]{36}$/,
];

const toFile = (path) => join(OUT, path === "/" ? "" : path, "index.html");

/** Prefija con la ruta base los enlaces absolutos que no la llevan e inyecta demo.js. */
export function postProcess(html, base = BASE) {
  const prefixed = html.replace(
    /\b(src|href|content|action|poster)="\/(?!\/)([^"]*)"/g,
    (match, attr, rest) =>
      `/${rest}`.startsWith(`${base}/`) || `/${rest}` === base
        ? match
        : `${attr}="${base}/${rest}"`,
  );
  const script = `<script src="${base}/demo.js" data-base="${base}" defer></script>`;
  return prefixed.includes("</head>")
    ? prefixed.replace("</head>", `${script}</head>`)
    : `${script}${prefixed}`;
}

/** Rutas internas (sin la base) enlazadas desde una página. */
export function internalLinks(html, base = BASE) {
  const out = new Set();
  for (const m of html.matchAll(/href="([^"#?]+)(?:[?#][^"]*)?"/g)) {
    const href = m[1];
    if (!href.startsWith(`${base}/`)) continue;
    const path = href.slice(base.length).replace(/\/$/, "") || "/";
    if (path.startsWith("/_next/") || /\.[a-z0-9]+$/i.test(path)) continue;
    out.add(path);
  }
  return [...out];
}

function save(path, html) {
  const file = toFile(path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, postProcess(html));
}

async function login(page) {
  await page.goto(`${APP}${BASE}/acceder`);
  await page.getByLabel("Correo electrónico").fill(DEMO_USER);
  await page.getByLabel("Contraseña").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Acceder" }).click();
  await page.waitForURL(/\/perfil\/seguridad/);
  await page.getByLabel(/Código de 6 dígitos/).fill(TEST_TOTP);
  await page.getByRole("button", { name: "Verificar" }).click();
  await page.getByText("Sesión verificada con segundo factor.").waitFor();
}

async function fetchHtml(request, path) {
  const res = await request.get(`${APP}${BASE}${path}`, { maxRedirects: 0 });
  const type = res.headers()["content-type"] ?? "";
  if (res.status() !== 200 || !type.includes("text/html")) return null;
  return res.text();
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // Pantallas públicas (sin sesión).
  const anon = await browser.newContext();
  for (const path of ["/acceder", "/acceder/recuperar"]) {
    const html = await fetchHtml(anon.request, path);
    if (!html) throw new Error(`No se pudo obtener ${path}`);
    save(path, html);
  }
  await anon.close();

  // Zona privada con la cuenta de administración sintética.
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);
  const seen = new Set();
  const queue = [...SEEDS];
  const saved = [];
  while (queue.length > 0 && saved.length < MAX_PAGES) {
    const path = queue.shift();
    if (seen.has(path) || SKIP.some((re) => re.test(path))) continue;
    seen.add(path);
    const html = await fetchHtml(context.request, path);
    if (!html) continue;
    save(path, html);
    saved.push(path);
    for (const link of internalLinks(html)) if (!seen.has(link)) queue.push(link);
  }
  // Recursos generados por la app (manifiesto) que no están en public/.
  const manifest = await context.request.get(`${APP}${BASE}/manifest.webmanifest`);
  if (manifest.ok()) {
    writeFileSync(
      join(OUT, "manifest.webmanifest"),
      (await manifest.text()).replaceAll('"/', `"${BASE}/`),
    );
  }
  await browser.close();

  // Estáticos: build de Next y carpeta public (sin el service worker).
  cpSync(".next/static", join(OUT, "_next/static"), { recursive: true });
  cpSync("public", OUT, {
    recursive: true,
    filter: (src) => !src.endsWith("sw.js") && !src.endsWith("offline.html"),
  });
  cpSync(join(HERE, "demo.js"), join(OUT, "demo.js"));
  const page404 = readFileSync(join(HERE, "404.html"), "utf8").replaceAll("__BASE__", BASE);
  writeFileSync(join(OUT, "404.html"), page404);
  const index = readFileSync(join(HERE, "index.html"), "utf8")
    .replaceAll("__BASE__", BASE)
    .replace("__PAGES__", String(saved.length + 2));
  writeFileSync(join(OUT, "index.html"), index);
  writeFileSync(join(OUT, ".nojekyll"), "");

  process.stdout.write(`Demostración generada: ${saved.length + 2} pantallas en ${OUT}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
