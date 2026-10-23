#!/usr/bin/env node
/**
 * Validación de migraciones para CI (docs/CI_CD.md, § Migraciones).
 *
 *  - Nombres `AAAAMMDDHHMMSS_nombre.sql` con marcas de tiempo únicas.
 *  - Toda migración desde 2026-10-22 tiene su reversión en supabase/rollbacks/
 *    y cada reversión declara su pérdida de datos; no hay reversiones huérfanas.
 *  - Con --base <ref> (pull requests): las migraciones ya existentes en la rama
 *    base son inmutables (se aplican una sola vez por entorno) y las nuevas
 *    deben ser posteriores a la última de la base (`supabase db push` aplica en
 *    orden y no inserta migraciones antiguas).
 *
 * Uso: node scripts/ci/check-migrations.mjs [--base origin/main]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = "supabase/migrations";
const ROLLBACKS = "supabase/rollbacks";
const ROLLBACK_REQUIRED_FROM = "20261022000000";
const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

const errors = [];
const migrations = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const stamps = new Set();

for (const file of migrations) {
  const m = NAME.exec(file);
  if (!m) {
    errors.push(`${file}: el nombre debe ser AAAAMMDDHHMMSS_nombre.sql (minúsculas y _)`);
    continue;
  }
  if (stamps.has(m[1])) errors.push(`${file}: marca de tiempo repetida`);
  stamps.add(m[1]);
  if (m[1] >= ROLLBACK_REQUIRED_FROM) {
    const rollback = join(ROLLBACKS, file.replace(/\.sql$/, ".down.sql"));
    if (!existsSync(rollback)) errors.push(`${file}: falta ${rollback}`);
    else if (!/p[ée]rdida de datos/i.test(readFileSync(rollback, "utf8")))
      errors.push(`${rollback}: la cabecera debe declarar la «Pérdida de datos»`);
  }
}

for (const file of readdirSync(ROLLBACKS).filter((f) => f.endsWith(".down.sql"))) {
  if (!migrations.includes(file.replace(/\.down\.sql$/, ".sql")))
    errors.push(`${ROLLBACKS}/${file}: reversión sin migración`);
}

const baseIndex = process.argv.indexOf("--base");
if (baseIndex !== -1) {
  const base = process.argv[baseIndex + 1];
  if (!base) throw new Error("--base necesita una referencia de git");
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const changed = git("diff", "--name-status", `${base}...HEAD`, "--", MIGRATIONS)
    .split("\n")
    .filter(Boolean);
  for (const line of changed) {
    const [status, path] = line.split(/\s+/);
    if (!status?.startsWith("A"))
      errors.push(
        `${path}: una migración ya fusionada no se modifica ni se borra (crea una nueva)`,
      );
  }
  const baseFiles = git("ls-tree", "--name-only", `${base}`, `${MIGRATIONS}/`)
    .split("\n")
    .map((p) => p.split("/").pop())
    .filter((f) => f?.endsWith(".sql"))
    .sort();
  const latestBase = baseFiles.at(-1);
  for (const line of changed.filter((l) => l.startsWith("A"))) {
    const file = line.split(/\s+/)[1]?.split("/").pop();
    if (latestBase && file && file < latestBase)
      errors.push(
        `${file}: es anterior a la última migración de ${base} (${latestBase}); renómbrala`,
      );
  }
}

if (errors.length > 0) {
  process.stderr.write(`Migraciones no válidas:\n- ${errors.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write(`Migraciones válidas (${migrations.length}).\n`);
