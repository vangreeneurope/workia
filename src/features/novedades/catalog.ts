import { NOVEDADES, type Novedad } from "@/content/novedades";
import { compareVersions, novedadVersions } from "@/lib/ops/release";

export type NovedadPublicada = Novedad & {
  /** Versión en la que se publicó (`vAA.N`); null si aún no está publicada. */
  version: string | null;
};

/** Novedades con su versión, en el orden del catálogo (la más reciente primero). */
export function novedadesPublicadas(
  versions: Record<string, string> = novedadVersions(),
): NovedadPublicada[] {
  return NOVEDADES.map((n) => ({ ...n, version: versions[n.id] ?? null }));
}

/** Versión más reciente con novedades publicadas, o null si no hay ninguna. */
export function ultimaVersionConNovedades(
  versions: Record<string, string> = novedadVersions(),
): string | null {
  const all = Object.values(versions);
  if (all.length === 0) return null;
  return all.reduce((max, v) => (compareVersions(v, max) > 0 ? v : max));
}

/**
 * Novedades que la persona aún no ha visto (posteriores a su última versión
 * vista). Vacío si no hay nada nuevo.
 */
export function novedadesSinVer(
  lastSeen: string | null | undefined,
  versions: Record<string, string> = novedadVersions(),
): NovedadPublicada[] {
  return novedadesPublicadas(versions).filter(
    (n) => n.version !== null && (!lastSeen || compareVersions(n.version, lastSeen) > 0),
  );
}
