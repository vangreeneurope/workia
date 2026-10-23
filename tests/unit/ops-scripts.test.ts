import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Salvaguardas de los scripts de operación (docs/CI_CD.md) con un CLI de
 * Supabase simulado: ninguna llamada real, ninguna credencial real.
 */

const ROOT = resolve(__dirname, "../..");

function fakeSupabase(plan: string) {
  const dir = mkdtempSync(join(tmpdir(), "sb-"));
  const log = join(dir, "llamadas.log");
  writeFileSync(
    join(dir, "supabase"),
    `#!/usr/bin/env bash\necho "$*" >> "${log}"\nif [[ "$*" == *"--dry-run"* ]]; then echo "${plan}"; fi\n`,
  );
  chmodSync(join(dir, "supabase"), 0o755);
  return { dir, calls: () => readFileSync(log, "utf8").trim().split("\n") };
}

function migrar(
  entorno: string,
  env: Record<string, string>,
  plan = "Would push these migrations",
) {
  const sb = fakeSupabase(plan);
  const res = spawnSync("bash", ["scripts/db/migrar.sh", entorno], {
    cwd: ROOT,
    encoding: "utf8",
    env: { NODE_ENV: "test", PATH: `${sb.dir}:${process.env.PATH ?? ""}`, HOME: sb.dir, ...env },
  });
  let calls: string[] = [];
  try {
    calls = sb.calls();
  } catch {
    calls = [];
  }
  return { status: res.status, stderr: res.stderr, calls };
}

const BASE = {
  SUPABASE_ACCESS_TOKEN: "token-de-prueba",
  SUPABASE_DB_PASSWORD: "clave-de-prueba",
  SUPABASE_PRODUCTION_REF: "prodref",
};

describe("scripts/db/migrar.sh", () => {
  it("sin credenciales del entorno no hace nada", () => {
    const r = migrar("staging", { SUPABASE_PROJECT_REF: "stagingref" });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
  });

  it("staging nunca apunta al proyecto de producción", () => {
    const r = migrar("staging", { ...BASE, SUPABASE_PROJECT_REF: "prodref" });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
  });

  it("producción exige que el proyecto sea el de producción", () => {
    const r = migrar("production", {
      ...BASE,
      SUPABASE_PROJECT_REF: "otro",
      COPIA_CONFIRMADA: "true",
    });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([]);
  });

  it("producción con migraciones pendientes exige confirmar la copia y no aplica nada", () => {
    const r = migrar("production", { ...BASE, SUPABASE_PROJECT_REF: "prodref" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/copia/);
    expect(r.calls.some((c) => c.startsWith("db push") && !c.includes("--dry-run"))).toBe(false);
  });

  it("producción sin pendientes termina sin aplicar ni pedir confirmación", () => {
    const r = migrar(
      "production",
      { ...BASE, SUPABASE_PROJECT_REF: "prodref" },
      "Remote database is up to date.",
    );
    expect(r.status).toBe(0);
    expect(r.calls.filter((c) => c.startsWith("db push"))).toHaveLength(1);
  });

  it("staging aplica tras el plan y nunca carga semillas", () => {
    const r = migrar("staging", { ...BASE, SUPABASE_PROJECT_REF: "stagingref" });
    expect(r.status).toBe(0);
    const pushes = r.calls.filter((c) => c.startsWith("db push"));
    expect(pushes).toHaveLength(2);
    expect(pushes[0]).toContain("--dry-run");
    expect(r.calls.join(" ")).not.toContain("--include-seed");
  });

  it("no imprime secretos", () => {
    const r = migrar("staging", { ...BASE, SUPABASE_PROJECT_REF: "stagingref" });
    expect(r.stderr).not.toContain("clave-de-prueba");
  });
});

describe("scripts/deploy/deploy.sh", () => {
  function deploy(entorno: string, env: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "deploy-"));
    mkdirSync(join(dir, "proveedores"));
    copyFileSync(join(ROOT, "scripts/deploy/deploy.sh"), join(dir, "deploy.sh"));
    writeFileSync(
      join(dir, "proveedores", "prueba.sh"),
      'desplegar() { echo "construyendo $1" >&2; echo "https://$1.ejemplo.invalid"; }\n',
    );
    const out = join(dir, "salida");
    const res = spawnSync("bash", [join(dir, "deploy.sh"), entorno], {
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", GITHUB_OUTPUT: out, ...env },
    });
    let output = "";
    try {
      output = readFileSync(out, "utf8");
    } catch {
      output = "";
    }
    return { status: res.status, output };
  }
  const ENV = {
    DEPLOY_PROVIDER: "prueba",
    APP_COMMIT: "abc1234",
    NEXT_PUBLIC_SUPABASE_URL: "https://x.invalid",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_relleno",
    NEXT_PUBLIC_SITE_URL: "https://x.invalid",
  };

  it("publica la URL que devuelve el adaptador", () => {
    const r = deploy("staging", { ...ENV, APP_ENV: "staging" });
    expect(r.status).toBe(0);
    expect(r.output).toBe("url=https://staging.ejemplo.invalid\n");
  });

  it("rechaza un entorno que no coincide con APP_ENV o un proveedor inexistente", () => {
    expect(deploy("production", { ...ENV, APP_ENV: "staging" }).status).toBe(1);
    expect(
      deploy("staging", { ...ENV, APP_ENV: "staging", DEPLOY_PROVIDER: "no-existe" }).status,
    ).toBe(1);
    expect(deploy("staging", { ...ENV, APP_ENV: "staging", DEPLOY_PROVIDER: "../x" }).status).toBe(
      1,
    );
  });
});

describe("scripts/ci/check-migrations.mjs", () => {
  it("las migraciones del repositorio son válidas", () => {
    expect(
      execFileSync("node", ["scripts/ci/check-migrations.mjs"], { cwd: ROOT, encoding: "utf8" }),
    ).toMatch(/Migraciones válidas/);
  });
});
