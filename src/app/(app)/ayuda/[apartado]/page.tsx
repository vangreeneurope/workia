import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APARTADOS_AYUDA, apartadoAyuda } from "@/content/ayuda";

export function generateStaticParams() {
  return APARTADOS_AYUDA.map((a) => ({ apartado: a.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/ayuda/[apartado]">): Promise<Metadata> {
  const { apartado } = await params;
  return { title: apartadoAyuda(apartado)?.titulo ?? "Ayuda" };
}

export default async function AyudaApartadoPage({ params }: PageProps<"/ayuda/[apartado]">) {
  const { apartado } = await params;
  const index = APARTADOS_AYUDA.findIndex((a) => a.slug === apartado);
  const data = APARTADOS_AYUDA[index];
  if (!data) notFound();
  const prev = APARTADOS_AYUDA[index - 1];
  const next = APARTADOS_AYUDA[index + 1];

  return (
    <>
      <BackLink href="/ayuda" label="Ayuda" />
      <PageHeader title={data.titulo} description={data.resumen} />
      <div className="grid gap-4">
        <dl className="bg-card grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-2">
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Para quién</dt>
            <dd>{data.paraQuien}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-muted-foreground">Dónde está</dt>
            <dd>{data.donde}</dd>
          </div>
        </dl>

        {data.tareas.map((tarea) => (
          <Card key={tarea.titulo}>
            <CardHeader>
              <CardTitle className="text-base">
                <h2>{tarea.titulo}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                {tarea.pasos.map((paso) => (
                  <li key={paso}>{paso}</li>
                ))}
              </ol>
            </CardContent>
          </Card>
        ))}

        {data.consejos && data.consejos.length > 0 ? (
          <section aria-labelledby="consejos" className="bg-card grid gap-2 rounded-xl border p-4">
            <h2 id="consejos" className="font-semibold">
              Consejos
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {data.consejos.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <nav
          aria-label="Otros apartados de la ayuda"
          className="flex flex-wrap justify-between gap-2"
        >
          {prev ? (
            <Link
              href={`/ayuda/${prev.slug}`}
              className="hover:bg-accent inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium"
            >
              <ChevronLeft className="size-4" aria-hidden /> {prev.titulo}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={`/ayuda/${next.slug}`}
              className="hover:bg-accent inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium"
            >
              {next.titulo} <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : null}
        </nav>
      </div>
    </>
  );
}
