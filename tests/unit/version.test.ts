import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  computeReleaseInfo,
  formatVersion,
  madridYear,
  novedadIds,
  releaseInfoForBuild,
  versionFromHistory,
} from "../../scripts/version.mjs";
import { appVersion, compareVersions, novedadVersions } from "@/lib/ops/release";

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("versión vAA.N (scripts/version.mjs)", () => {
  it("formatea año en dos cifras y número de cambios", () => {
    expect(formatVersion(2026, 11)).toBe("v26.11");
    expect(formatVersion(2030, 1)).toBe("v30.1");
  });

  it("el año es el de Madrid: la Nochevieja a las 23:30 UTC ya es año nuevo", () => {
    expect(madridYear(at("2026-12-31T22:59:00Z"))).toBe(2026);
    expect(madridYear(at("2026-12-31T23:30:00Z"))).toBe(2027);
  });

  it("cuenta los commits del año del commit publicado y empieza de nuevo el 1 de enero", () => {
    const history2026 = [
      at("2026-10-23T10:00:00Z"),
      at("2026-03-01T10:00:00Z"),
      at("2025-12-30T10:00:00Z"),
    ];
    expect(versionFromHistory(history2026)).toBe("v26.2");
    const firstOf2027 = [at("2027-01-01T08:00:00Z"), ...history2026];
    expect(versionFromHistory(firstOf2027)).toBe("v27.1");
    expect(versionFromHistory([])).toBeNull();
  });

  it("lee los ids del catálogo de novedades", () => {
    expect(novedadIds('  {\n    id: "uno",\n  },\n  {\n    id: "dos-tres",\n')).toEqual([
      "uno",
      "dos-tres",
    ]);
  });

  it("usa APP_RELEASE_INFO si viene del entorno (imagen sin .git)", () => {
    const info = releaseInfoForBuild({
      APP_RELEASE_INFO: JSON.stringify({ version: "v26.40", novedades: { a: "v26.39" } }),
    });
    expect(info).toEqual({ version: "v26.40", novedades: { a: "v26.39" } });
  });

  describe("con un repositorio git real", () => {
    let dir = "";
    const git = (args: string[], date: string) =>
      execFileSync("git", args, {
        cwd: dir,
        env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
        stdio: "ignore",
      });
    const commit = (date: string, novedades?: string) => {
      if (novedades !== undefined) {
        writeFileSync(join(dir, "src/content/novedades.ts"), novedades);
      } else {
        writeFileSync(join(dir, "cambio.txt"), date);
      }
      git(["add", "-A"], date);
      git(["commit", "-q", "-m", `cambio ${date}`], date);
    };

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "workia-version-"));
      mkdirSync(join(dir, "src/content"), { recursive: true });
      execFileSync("git", ["init", "-q"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "ci@example.test"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "CI"], { cwd: dir });
      commit("2026-12-30T10:00:00Z");
      commit(
        "2026-12-31T10:00:00Z",
        'export const NOVEDADES = [\n  {\n    id: "antigua",\n  },\n];\n',
      );
      commit("2027-01-02T10:00:00Z");
      commit(
        "2027-01-03T10:00:00Z",
        'export const NOVEDADES = [\n  {\n    id: "nueva",\n  },\n  {\n    id: "antigua",\n  },\n];\n',
      );
      commit("2027-01-04T10:00:00Z");
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("versión del HEAD y de cada novedad (la del commit que la añadió)", () => {
      expect(computeReleaseInfo(dir)).toEqual({
        version: "v27.3",
        novedades: { nueva: "v27.2", antigua: "v26.2" },
      });
    });
  });
});

describe("versión en la aplicación (src/lib/ops/release.ts)", () => {
  it("solo acepta el formato vAA.N", () => {
    expect(appVersion("v26.11")).toBe("v26.11");
    expect(appVersion("")).toBeNull();
    expect(appVersion("26.11")).toBeNull();
    expect(appVersion("v26.11<script>")).toBeNull();
  });

  it("descarta versiones de novedades no válidas", () => {
    expect(novedadVersions(JSON.stringify({ a: "v26.3", b: "x", c: 4 }))).toEqual({ a: "v26.3" });
    expect(novedadVersions("no es json")).toEqual({});
  });

  it("ordena por año y luego por número", () => {
    expect(compareVersions("v26.9", "v26.10")).toBeLessThan(0);
    expect(compareVersions("v27.1", "v26.300")).toBeGreaterThan(0);
    expect(compareVersions("v26.5", "v26.5")).toBe(0);
  });
});
