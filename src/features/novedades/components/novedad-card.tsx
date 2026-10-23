import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TIPO_LABELS } from "@/content/novedades";
import { formatDate } from "@/lib/dates";

import type { NovedadPublicada } from "../catalog";

/** Una novedad: versión, tipo, explicación y, si cambia el funcionamiento, antes y ahora. */
export function NovedadCard({ novedad, nueva }: { novedad: NovedadPublicada; nueva?: boolean }) {
  const titleId = `novedad-${novedad.id}`;
  return (
    <Card aria-labelledby={titleId}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="tabular-nums">{novedad.version ?? "Próxima versión"}</Badge>
          <Badge variant={novedad.tipo === "funcionamiento" ? "secondary" : "outline"}>
            {TIPO_LABELS[novedad.tipo]}
          </Badge>
          {nueva ? <Badge variant="outline">Nuevo para ti</Badge> : null}
        </div>
        <CardTitle className="text-base">
          <h2 id={titleId}>{novedad.titulo}</h2>
        </CardTitle>
        <CardDescription>
          {novedad.apartado} · {formatDate(novedad.fecha)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <p>{novedad.resumen}</p>
        {novedad.antes ? (
          <div className="grid gap-1">
            <h3 className="font-semibold">Antes</h3>
            <p className="text-muted-foreground">{novedad.antes}</p>
          </div>
        ) : null}
        {novedad.ahora && novedad.ahora.length > 0 ? (
          <div className="grid gap-1">
            <h3 className="font-semibold">Ahora, paso a paso</h3>
            <ol className="list-decimal space-y-1 pl-5">
              {novedad.ahora.map((paso) => (
                <li key={paso}>{paso}</li>
              ))}
            </ol>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
