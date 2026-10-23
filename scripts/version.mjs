#!/usr/bin/env node
/**
 * Versión visible de la aplicación (ADR-066): `vAA.N`.
 *
 *  - AA: año (dos cifras, hora de Madrid) del commit publicado.
 *  - N: número de commits de ese año en la historia del commit publicado,
 *    contando el propio. Cada commit suma uno y el 1 de enero vuelve a empezar.
 *
 * También calcula la versión de cada novedad (src/content/novedades.ts): la del
 * primer commit que la añadió. Una novedad aún sin commit sale como pendiente.
 *
 * Sin historia completa (copia superficial o sin .git) no se inventa nada: se usa
 * APP_RELEASE_INFO si viene del entorno (lo genera este mismo script en el CI) y,
 * si no, la versión queda vacía y la interfaz no la muestra.
 *
 * Uso: node scripts/version.mjs   → imprime el JSON (para APP_RELEASE_INFO).
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const NOVEDADES_FILE = "src/content/novedades.ts";

const MADRID_YEAR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  year: "numeric",
});

function git(args, cwd) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString();
}

/** Año en Madrid de una marca de tiempo Unix (segundos). */
export function madridYear(unixSeconds) {
  return Number(MADRID_YEAR.format(new Date(unixSeconds * 1000)));
}

/** `vAA.N` a partir del año y el número de commits de ese año. */
export function formatVersion(year, count) {
  return `v${String(year % 100).padStart(2, "0")}.${count}`;
}

/**
 * Versión de un commit dada la lista de marcas de tiempo (segundos) de todos los
 * commits de su historia, incluido él mismo como primer elemento.
 */
export function versionFromHistory(timestamps) {
  const [own] = timestamps;
  if (own === undefined) return null;
  const year = madridYear(own);
  const count = timestamps.filter((t) => madridYear(t) === year).length;
  return formatVersion(year, count);
}

function versionOf(rev, cwd) {
  const stamps = git(["log", "--format=%ct", rev], cwd).split("\n").filter(Boolean).map(Number);
  return versionFromHistory(stamps);
}

/** Ids declarados en el catálogo de novedades (`id: "…"`). */
export function novedadIds(source) {
  return [...source.matchAll(/^\s*id:\s*"([a-z0-9-]+)"/gm)].map((m) => m[1]);
}

export function computeReleaseInfo(cwd = process.cwd()) {
  try {
    if (git(["rev-parse", "--is-shallow-repository"], cwd).trim() === "true") {
      return { version: "", novedades: {} };
    }
    const version = versionOf("HEAD", cwd) ?? "";
    const novedades = {};
    let source = "";
    try {
      source = git(["show", `HEAD:${NOVEDADES_FILE}`], cwd);
    } catch {
      source = "";
    }
    for (const id of novedadIds(source)) {
      // Primer commit que introdujo el id (búsqueda «pickaxe» de git).
      const first = git(
        ["log", "--reverse", "--format=%H", "-S", `id: "${id}"`, "HEAD", "--", NOVEDADES_FILE],
        cwd,
      )
        .split("\n")
        .find(Boolean);
      if (first) novedades[id] = versionOf(first, cwd) ?? "";
    }
    return { version, novedades };
  } catch {
    return { version: "", novedades: {} };
  }
}

/** Información de versión del build: la del entorno si viene, si no la de git. */
export function releaseInfoForBuild(env = process.env, cwd = process.cwd()) {
  const raw = env.APP_RELEASE_INFO;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.version === "string" && typeof parsed?.novedades === "object") {
        return { version: parsed.version, novedades: parsed.novedades ?? {} };
      }
    } catch {
      // Valor no válido: se calcula desde git.
    }
  }
  return computeReleaseInfo(cwd);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(computeReleaseInfo())}\n`);
}
