import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { formatLog } from "@/lib/log";
import { currentEnvironment } from "@/lib/ops/release";

/**
 * La configuración portable de alertas es coherente: cada alerta tiene dueño
 * definido, señal, acción y un runbook que existe (docs/OBSERVABILIDAD.md).
 */

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

type Alert = {
  id: string;
  severidad: string;
  senal: { fuente: string; condicion: string };
  propietario: string;
  accion: string;
  runbook: string;
};
const config = JSON.parse(read("ops/observabilidad/alertas.json")) as {
  propietarios: Record<string, { rol: string; contacto: string }>;
  fuentes: Record<string, string>;
  alertas: Alert[];
};

/** Ancla de un encabezado como la genera GitHub (conserva letras con tilde). */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

function anchors(path: string): Set<string> {
  return new Set(
    read(path)
      .split("\n")
      .filter((l) => /^#{1,6}\s/.test(l))
      .map((l) => slug(l.replace(/^#+\s*/, ""))),
  );
}

describe("ops/observabilidad/alertas.json", () => {
  it("cada alerta tiene id único, severidad, señal conocida, dueño y acción", () => {
    const ids = config.alertas.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of config.alertas) {
      expect(["critica", "alta", "media"], a.id).toContain(a.severidad);
      expect(Object.keys(config.fuentes), a.id).toContain(a.senal.fuente);
      expect(a.senal.condicion.length, a.id).toBeGreaterThan(10);
      expect(Object.keys(config.propietarios), a.id).toContain(a.propietario);
      expect(a.accion.length, a.id).toBeGreaterThan(10);
    }
  });

  it("cada runbook enlazado existe", () => {
    for (const a of config.alertas) {
      const [path, anchor] = a.runbook.split("#");
      expect(path, a.id).toBe("docs/RUNBOOKS.md");
      expect(anchors(path as string), `${a.id} → #${anchor}`).toContain(anchor);
    }
  });

  it("cubre login, base de datos, RLS, OCR, correo, Storage, colas y cierre mensual", () => {
    const runbooks = new Set(config.alertas.map((a) => a.runbook.split("#")[1]));
    for (const area of [
      "login-y-auth",
      "base-de-datos",
      "rls-y-aislamiento",
      "ocr",
      "correo",
      "storage",
      "colas-y-tareas-programadas",
      "cierre-mensual",
    ])
      expect(runbooks, area).toContain(area);
  });

  it("las métricas que citan existen en ops_metrics", () => {
    const sql = read("supabase/migrations/20261101100000_observabilidad.sql");
    for (const a of config.alertas.filter((x) => x.senal.fuente === "metricas")) {
      // Los nombres de evento (event = ocr.job) no son métricas.
      const condition = a.senal.condicion.replace(/event = [a-z_.]+/g, "");
      for (const [, section, key] of condition.matchAll(/\b([a-z_]+)\.([a-z0-9_]+)\b/g)) {
        expect(sql, `${a.id}: ${section}.${key}`).toContain(`'${section}'`);
        expect(sql, `${a.id}: ${section}.${key}`).toContain(`'${key}'`);
      }
    }
  });
});

describe("métricas en registros", () => {
  it("la instantánea de ops_metrics no se redacta (claves sin contenido sensible)", () => {
    const sample = {
      metrics: {
        jobs: { pending: 1, stuck: 0, oldest_pending_s: 3 },
        envios: { due: 0, failed_24h: 0 },
        settlement: { batches_without_exports: 0 },
      },
    };
    const line = JSON.parse(formatLog("info", "ops.metrics", sample)) as Record<string, unknown>;
    expect(line.metrics).toEqual(sample.metrics);
  });

  it("el entorno desconocido se trata como local", () => {
    expect(currentEnvironment("production")).toBe("production");
    expect(currentEnvironment("prod")).toBe("local");
    expect(currentEnvironment(undefined)).toBe("local");
  });
});
