import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Escáner estático de seguridad del código (docs/SEGURIDAD.md, § 4). Falla si un
 * cambio futuro rompe una regla de CLAUDE.md sin que nadie lo note.
 */

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
const rel = (f: string) => relative(ROOT, f).split("\\").join("/");
const read = (f: string) => readFileSync(f, "utf8");
/** Código sin comentarios (para no contar menciones en la documentación). */
const code = (f: string) =>
  read(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// Identidad desde la sesión (src/lib/auth/dal.ts y envoltorios de administración).
const IDENTITY = [
  "getUserContext",
  "requireUserId",
  "requireSection",
  "adminAction",
  "requireAdminArea",
  "adminAreaOrNull",
  "getAdminContext",
];

/** Funciones del archivo que (directa o indirectamente) obtienen la identidad. */
function identityHelpers(src: string): Set<string> {
  const bodies = new Map<string, string>();
  const re = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\([^)]*\)[^{]*\{/g;
  const starts = [...src.matchAll(re)];
  starts.forEach((m, i) => {
    const end = starts[i + 1]?.index ?? src.length;
    bodies.set(m[1] as string, src.slice(m.index ?? 0, end));
  });
  const ok = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, body] of bodies) {
      if (ok.has(name)) continue;
      const calls = [...IDENTITY, ...ok].some((id) =>
        new RegExp(`\\b${id}\\(`).test(body.replace(new RegExp(`function\\s+${name}\\b`), "")),
      );
      if (calls) {
        ok.add(name);
        changed = true;
      }
    }
  }
  return ok;
}

// Excepciones justificadas (ADR-036 terminal, acceso y recuperación de contraseña).
const PUBLIC_ACTIONS = new Set([
  "src/features/auth/actions.ts#signIn",
  "src/features/auth/actions.ts#signOut",
  "src/features/auth/actions.ts#requestPasswordReset",
  "src/features/time-tracking/actions.ts#activateKiosk",
  "src/features/time-tracking/actions.ts#deactivateKiosk",
  "src/features/time-tracking/actions.ts#kioskPunchAction",
]);
const PUBLIC_ROUTES = new Set([
  "src/app/api/tareas/route.ts", // CRON_SECRET (ADR-048)
  "src/app/api/correo/webhook/route.ts", // firma HMAC (ADR-048)
  "src/app/auth/confirmar/route.ts", // canje del código de Supabase Auth
]);

describe("Server Actions y Route Handlers", () => {
  const actionFiles = files.filter((f) => /^\s*["']use server["']/.test(read(f)));

  it("hay Server Actions que revisar", () => {
    expect(actionFiles.length).toBeGreaterThan(10);
  });

  it("toda Server Action exportada obtiene la identidad de la sesión", () => {
    const missing: string[] = [];
    for (const f of actionFiles) {
      const src = code(f);
      const ok = identityHelpers(src);
      for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
        const id = `${rel(f)}#${m[1]}`;
        if (!ok.has(m[1] as string) && !PUBLIC_ACTIONS.has(id)) missing.push(id);
      }
    }
    expect(missing).toEqual([]);
  });

  it("todo Route Handler obtiene la identidad (salvo las rutas de máquina)", () => {
    const routes = files.filter((f) => /route\.ts$/.test(f));
    const missing = routes
      .filter((f) => !PUBLIC_ROUTES.has(rel(f)))
      .filter((f) => !IDENTITY.some((id) => new RegExp(`\\b${id}\\(`).test(code(f))))
      .map(rel);
    expect(missing).toEqual([]);
  });

  it("las descargas de archivos privados comprueban el origen y la frecuencia", () => {
    const downloads = files.filter(
      (f) => /route\.ts$/.test(f) && /createSignedUrl|Content-Disposition/.test(read(f)),
    );
    expect(downloads.length).toBeGreaterThanOrEqual(5);
    const missing = downloads
      .filter((f) => !/guardDownload\(|isCrossSiteRequest\(/.test(code(f)))
      .map(rel);
    expect(missing).toEqual([]);
  });

  it("el company_id de una escritura nunca sale del formulario", () => {
    const offenders = files.filter((f) =>
      /formData\.get\(["']company_id["']\)|formToObject\([^)]*\)\.company_id/.test(code(f)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("Sesión, secretos y clientes", () => {
  it("nunca se autoriza con getSession() en el servidor", () => {
    expect(files.filter((f) => /\.getSession\(/.test(code(f))).map(rel)).toEqual([]);
  });

  it("la clave de servicio solo se usa en las rutas y servicios justificados por ADR", () => {
    const allowed = [
      "src/lib/supabase/admin.ts",
      "src/app/api/tareas/route.ts",
      "src/app/api/correo/webhook/route.ts",
      "src/features/notifications/store.ts",
      "src/features/admin/members/actions.ts", // invitaciones (ADR-025)
    ];
    const users = files
      .filter((f) => /createAdminClient|SUPABASE_SECRET_KEY|service_role/.test(code(f)))
      .map(rel);
    expect(users.filter((f) => !allowed.includes(f))).toEqual([]);
  });

  it("ningún componente de cliente importa clientes de servidor ni lee secretos", () => {
    const clients = files.filter((f) => /^\s*["']use client["']/.test(read(f)));
    const offenders = clients.filter((f) =>
      /@\/lib\/supabase\/(server|admin)|process\.env\.(?!NEXT_PUBLIC_|NODE_ENV)/.test(code(f)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no hay cliente de Supabase en el navegador (cookies de sesión httpOnly)", () => {
    expect(files.some((f) => /createBrowserClient/.test(code(f)))).toBe(false);
  });

  it("solo hay tres variables públicas (NEXT_PUBLIC_)", () => {
    const names = new Set<string>();
    for (const f of [...files, join(ROOT, "next.config.ts")])
      for (const m of read(f).matchAll(/NEXT_PUBLIC_[A-Z_]+/g)) names.add(m[0]);
    expect([...names].sort()).toEqual([
      "NEXT_PUBLIC_SITE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
  });

  it("el registro técnico pasa por src/lib/log.ts (redacción de datos personales)", () => {
    const offenders = files.filter(
      (f) => rel(f) !== "src/lib/log.ts" && /console\.(log|info|warn|error|debug)\(/.test(code(f)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("Contenido activo y privacidad", () => {
  it("no se inyecta HTML sin escapar", () => {
    expect(
      files.filter((f) => /dangerouslySetInnerHTML|innerHTML\s*=/.test(code(f))).map(rel),
    ).toEqual([]);
  });

  it("no hay reconocimiento facial ni biometría (ni dependencias que lo hagan)", () => {
    const pkg = read(join(ROOT, "package.json"));
    const lock = read(join(ROOT, "package-lock.json"));
    const banned =
      /(face-api|faceapi|@vladmandic\/(human|face)|@tensorflow-models\/(face|blazeface)|@mediapipe\/(face|tasks-vision)|opencv|tracking\.js|webauthn-biometric|fingerprintjs)/i;
    expect(banned.test(pkg)).toBe(false);
    expect(banned.test(lock)).toBe(false);
    const offenders = files.filter((f) =>
      /FaceDetector|faceLandmark|detectFaces|faceDescriptor|biometric/i.test(code(f)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("la geolocalización solo se pide una vez al fichar (sin seguimiento continuo)", () => {
    expect(files.filter((f) => /watchPosition/.test(code(f))).map(rel)).toEqual([]);
    const users = files.filter((f) => /getCurrentPosition/.test(code(f))).map(rel);
    expect(users).toEqual(["src/features/time-tracking/geolocation.ts"]);
  });

  it("los enlaces de redirección con destino de usuario pasan por safeRedirectPath", () => {
    const offenders = files.filter((f) =>
      /redirect\((parsed\.data\.)?(siguiente|next|returnTo|redirectTo)\b/.test(code(f)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});
