import { ChevronRight, Gift } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APARTADOS_AYUDA } from "@/content/ayuda";

export const metadata: Metadata = { title: "Ayuda" };

export default function AyudaPage() {
  return (
    <>
      <PageHeader
        title="Ayuda y manual de uso"
        description="Guía de uso y formación de Workia, apartado por apartado. Cada apartado explica para qué sirve y cómo hacer las tareas habituales, con los nombres de los botones tal como los verás."
      />
      <div className="grid gap-6">
        <section aria-labelledby="como-usar" className="bg-card grid gap-2 rounded-xl border p-4">
          <h2 id="como-usar" className="font-semibold">
            Cómo usar esta guía
          </h2>
          <p className="text-muted-foreground text-sm">
            Si es tu primera vez, empieza por «Primeros pasos». Después consulta los apartados que
            usas en tu día a día. Solo verás en el menú los apartados que tu rol permite usar, así
            que puede que algunos de esta guía no te apliquen. Para saber qué ha cambiado
            recientemente, consulta las{" "}
            <Link href="/novedades" className="font-medium underline underline-offset-4">
              Novedades
            </Link>
            .
          </p>
        </section>

        <section aria-labelledby="apartados" className="grid gap-3">
          <h2 id="apartados" className="font-semibold">
            Apartados
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {APARTADOS_AYUDA.map((a) => (
              <li key={a.slug}>
                <Link
                  href={`/ayuda/${a.slug}`}
                  className="block h-full rounded-xl focus-visible:outline-2"
                >
                  <Card className="hover:bg-accent/50 h-full transition-colors">
                    <CardHeader className="grid-cols-[1fr_auto]">
                      <CardTitle className="text-base">{a.titulo}</CardTitle>
                      <ChevronRight
                        className="text-muted-foreground row-span-2 size-5 self-center"
                        aria-hidden
                      />
                      <CardDescription>{a.resumen}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              </li>
            ))}
            <li>
              <Link href="/novedades" className="block h-full rounded-xl focus-visible:outline-2">
                <Card className="hover:bg-accent/50 h-full transition-colors">
                  <CardHeader className="grid-cols-[1fr_auto]">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Gift className="size-4" aria-hidden /> Novedades
                    </CardTitle>
                    <ChevronRight
                      className="text-muted-foreground row-span-2 size-5 self-center"
                      aria-hidden
                    />
                    <CardDescription>
                      Cada cambio de la aplicación con su versión y, si cambia la forma de trabajar,
                      cómo era antes y cómo es ahora, paso a paso.
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
