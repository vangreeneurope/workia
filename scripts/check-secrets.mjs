#!/usr/bin/env node
// Escáner de secretos del repositorio (docs/SEGURIDAD.md, § 9). Revisa los
// archivos versionados (git ls-files) y falla si encuentra claves, tokens,
// claves privadas, archivos .env reales o cadenas de conexión con contraseña.
// No sustituye a un escáner del proveedor (GitHub secret scanning), lo complementa.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((f) => !/^(node_modules|\.next)\//.test(f))
  .filter((f) => !/\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|zip)$/i.test(f))
  // El propio escáner y sus pruebas contienen los patrones a propósito.
  .filter((f) => f !== "scripts/check-secrets.mjs");

const RULES = [
  ["Archivo .env versionado", (f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example")],
  ["Clave secreta de Supabase", (_f, t) => /\bsb_secret_[A-Za-z0-9_-]{16,}/.test(t)],
  [
    "JWT (posible service_role)",
    (_f, t) => /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}/.test(t),
  ],
  ["Clave privada", (_f, t) => /-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/.test(t)],
  ["Clave de AWS", (_f, t) => /\bAKIA[0-9A-Z]{16}\b/.test(t)],
  ["Token de GitHub", (_f, t) => /\bgh[pousr]_[A-Za-z0-9]{30,}\b/.test(t)],
  ["Token de Slack", (_f, t) => /\bxox[abpr]-[A-Za-z0-9-]{10,}/.test(t)],
  [
    "Clave de API genérica (sk_live, sk-…)",
    (_f, t) => /\b(sk_live_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{32,})\b/.test(t),
  ],
  [
    "Cadena de conexión con contraseña fuera de localhost",
    (_f, t) =>
      [...t.matchAll(/postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]+@([^:/\s]+)/g)].some(
        (m) => !/^(localhost|127\.0\.0\.1|postgres)$/.test(m[1]),
      ),
  ],
  [
    "Variable secreta con valor en archivo de ejemplo",
    (f, t) =>
      f.endsWith(".env.example") &&
      /^(SUPABASE_SECRET_KEY|CRON_SECRET|EMAIL_WEBHOOK_SECRET|.*_API_KEY)=\S+/m.test(t),
  ],
];

const findings = [];
for (const f of files) {
  let text = "";
  try {
    if (statSync(f).size > 2_000_000) continue;
    text = readFileSync(f, "utf8");
  } catch {
    continue; // borrado en el árbol de trabajo
  }
  for (const [name, test] of RULES) if (test(f, text)) findings.push(`${f}: ${name}`);
}

if (findings.length > 0) {
  console.error(
    "Posibles secretos en el repositorio:\n" + findings.map((x) => `  - ${x}`).join("\n"),
  );
  process.exit(1);
}
console.warn(`Sin secretos detectados en ${files.length} archivos versionados.`);
