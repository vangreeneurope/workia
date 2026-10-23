import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { novedadesPublicadas, novedadesSinVer } from "@/features/novedades/catalog";
import { NovedadCard } from "@/features/novedades/components/novedad-card";
import { getUserContext } from "@/lib/auth/dal";
import { appVersion } from "@/lib/ops/release";

export const metadata: Metadata = { title: "Novedades" };

export default async function NovedadesPage() {
  const ctx = await getUserContext();
  const novedades = novedadesPublicadas();
  const nuevas = new Set(novedadesSinVer(ctx.lastSeenRelease).map((n) => n.id));
  const version = appVersion();

  return (
    <>
      <PageHeader
        title="Novedades"
        description={`Qué ha cambiado en Workia y cómo te afecta.${version ? ` Versión actual: ${version}.` : ""}`}
      />
      {novedades.length === 0 ? (
        <p className="text-muted-foreground">Aquí aparecerán los cambios de la aplicación.</p>
      ) : (
        <ul className="grid gap-4">
          {novedades.map((n) => (
            <li key={n.id}>
              <NovedadCard novedad={n} nueva={nuevas.has(n.id)} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
