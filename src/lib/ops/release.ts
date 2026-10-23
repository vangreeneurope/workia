/**
 * Identidad del despliegue (versión, commit, migración esperada y entorno).
 * No contiene secretos ni datos: es lo que muestra /api/salud y lo que llevan
 * los registros de arranque para saber qué código corre en cada entorno.
 */

export type Environment = "local" | "preview" | "staging" | "production";

const ENVIRONMENTS: readonly Environment[] = ["local", "preview", "staging", "production"];

export type ReleaseInfo = {
  version: string;
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
    commit: process.env.BUILD_COMMIT ?? "desconocido",
    migration: process.env.BUILD_MIGRATION ?? "desconocida",
    environment: currentEnvironment(),
  };
}
