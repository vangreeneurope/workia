// Tipos de scripts/version.mjs (lo importa next.config.ts).
export type ReleaseInfo = { version: string; novedades: Record<string, string> };

export declare const NOVEDADES_FILE: string;
export declare function madridYear(unixSeconds: number): number;
export declare function formatVersion(year: number, count: number): string;
export declare function versionFromHistory(timestamps: number[]): string | null;
export declare function novedadIds(source: string): string[];
export declare function computeReleaseInfo(cwd?: string): ReleaseInfo;
export declare function releaseInfoForBuild(
  env?: Record<string, string | undefined>,
  cwd?: string,
): ReleaseInfo;
