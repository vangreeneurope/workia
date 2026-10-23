import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

import type { NextConfig } from "next";

import { releaseInfoForBuild } from "./scripts/version.mjs";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Identidad del build (docs/CI_CD.md): versión, commit y última migración que
 * espera este código. Se fijan al construir; el entorno (APP_ENV) se lee en
 * ejecución porque el mismo build se promueve de staging a producción.
 */
function buildInfo() {
  const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
  let commit = process.env.APP_COMMIT ?? process.env.GITHUB_SHA ?? "";
  if (!commit) {
    try {
      commit = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      commit = "desconocido";
    }
  }
  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
  const migration =
    migrations
      .sort()
      .at(-1)
      ?.replace(/\.sql$/, "") ?? "ninguna";
  // Versión visible vAA.N y versión de cada novedad (scripts/version.mjs, ADR-066).
  const release = releaseInfoForBuild();
  return {
    BUILD_VERSION: version,
    BUILD_RELEASE: release.version,
    BUILD_NOVEDADES: JSON.stringify(release.novedades),
    BUILD_COMMIT: /^[0-9a-f]{7,40}$/.test(commit) ? commit : "desconocido",
    BUILD_MIGRATION: migration,
  };
}

/**
 * Origen de Supabase permitido en la CSP. Se lee en build; si falta, la CSP
 * solo permite 'self' y la app no podrá hablar con Supabase (fallo visible).
 */
function supabaseOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

function contentSecurityPolicy(): string {
  const supabase = supabaseOrigin();
  const supabaseWs = supabase.replace(/^http/, "ws");
  // Next.js inyecta scripts inline para la hidratación. Una CSP con nonce exige
  // renderizar todo dinámicamente y es incompatible con el prerenderizado
  // parcial que usa la app (Cache Components), así que se permite
  // 'unsafe-inline' en scripts (ADR-009, revisado en ADR-055) y se compensa:
  // sin atributos de evento inline, sin eval en producción, sin objetos ni
  // marcos, formularios y base solo al propio origen, y React escapa todo el
  // contenido (tests/unit/security-static.test.ts prohíbe dangerouslySetInnerHTML).
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "script-src-attr": ["'none'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", supabase].filter(Boolean),
    "media-src": ["'self'", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", supabase, supabaseWs].filter(Boolean),
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };
  const policy = Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");
  return isDev ? policy : `${policy}; upgrade-insecure-requests`;
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Cámara en el propio origen (tickets y selfie opcional). Geolocalización en
    // el propio origen solo para la lectura puntual al fichar cuando la empresa la
    // activa (nunca seguimiento, docs/CONTROL_HORARIO.md). Todo lo demás, cerrado.
    value:
      "camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), midi=(), display-capture=(), browsing-topics=(), accelerometer=(), gyroscope=(), magnetometer=()",
  },
  // Aislamiento del contexto de navegación y de los recursos propios.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Origin-Agent-Cluster", value: "?1" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isDev
    ? []
    : [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      ]),
];

/**
 * Demostración estática en GitHub Pages (ADR-070): se sirve bajo la ruta del
 * repositorio (/workia). Solo con DEMO_BUILD=1 (scripts/demo/build.sh).
 */
const demoBasePath =
  process.env.DEMO_BUILD === "1" ? (process.env.DEMO_BASE_PATH ?? "/workia") : "";

const nextConfig: NextConfig = {
  cacheComponents: true,
  ...(demoBasePath ? { basePath: demoBasePath } : {}),
  env: { ...buildInfo(), APP_BASE_PATH: demoBasePath, APP_DEMO: demoBasePath ? "1" : "" },
  // Imagen de contenedor portable (Dockerfile): servidor autónomo solo si se pide.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  experimental: {
    // Tickets de gasto (hasta 10 MB) y justificantes: el límite por defecto es 1 MB.
    serverActions: { bodySizeLimit: "11mb" },
  },
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    return [{ source: "/", destination: "/panel", permanent: false }];
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
