/**
 * Identidad del despliegue (versión, commit, migración esperada y entorno).
 * No contiene secretos ni datos: es lo que muestra /api/salud y lo que llevan
 * los registros de arranque para saber qué código corre en cada entorno.
 */

export type Environment = "local" | "preview" | "staging" | "production";

const ENVIRONMENTS: readonly Environment[] = ["local", "preview", "staging", "production"];

export type ReleaseInfo = {
  version: string;
  /** Versión visible `vAA.N` (o «desconocida» si el build no la conoce). */
  release: string;
  commit: string;
  migration: string;
  environment: Environment;
};

export function currentEnvironment(raw = process.env.APP_ENV): Environment {
  return ENVIRONMENTS.find((e) => e === raw) ?? "local";
}

export function releaseInfo(): ReleaseInfo {
  return {
    version: process.env.BUILD_VERSION ?? "0.0.0",
    release: appVersion() ?? "desconocida",
    commit: process.env.BUILD_COMMIT ?? "desconocido",
    migration: process.env.BUILD_MIGRATION ?? "desconocida",
    environment: currentEnvironment(),
  };
}

const APP_VERSION = /^v\d{2}\.\d+$/;

/**
 * Versión visible `vAA.N` (scripts/version.mjs, ADR-066) o null si el build no
 * la conoce (sin historia de git): en ese caso la interfaz no muestra ninguna.
 */
export function appVersion(raw = process.env.BUILD_RELEASE): string | null {
  return raw && APP_VERSION.test(raw) ? raw : null;
}

/** Versión en la que se publicó cada novedad (id → `vAA.N`). */
export function novedadVersions(raw = process.env.BUILD_NOVEDADES): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && APP_VERSION.test(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

/** Compara dos versiones `vAA.N` (negativo si a es anterior a b). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.slice(1).split(".").map(Number) as [number, number];
  const [ya, na] = parse(a);
  const [yb, nb] = parse(b);
  return ya === yb ? na - nb : ya - yb;
}
