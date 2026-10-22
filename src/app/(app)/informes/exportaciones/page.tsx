import { Download, RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { BackLink } from "@/components/admin/back-link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { isReportKey } from "@/features/reports/exports";
import { REPORTS } from "@/features/reports/catalog";
import { formatDateTimeIn } from "@/features/reports/rows";
import { requireSection } from "@/lib/auth/dal";
import { BUSINESS_TIME_ZONE } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Mis exportaciones" };

const STATUS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  pending: { label: "En cola", variant: "outline" },
  processing: { label: "Generando", variant: "outline" },
  ready: { label: "Lista", variant: "secondary" },
  failed: { label: "Fallida", variant: "destructive" },
  expired: { label: "Caducada", variant: "outline" },
};

const ERRORS: Record<string, string> = {
  too_many_rows: "Demasiadas filas: acota el periodo o filtra por equipo o centro.",
  timeout: "Tardó demasiado: vuelve a pedirla.",
};

function size(bytes: number | null): string {
  if (!bytes) return "";
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Lista y sin caducar (la base de datos lo vuelve a comprobar al descargar). */
function isDownloadable(x: { status: string; expires_at: string | null }): boolean {
  return x.status === "ready" && x.expires_at !== null && Date.parse(x.expires_at) > Date.now();
}

export default async function ExportacionesPage() {
  const ctx = await requireSection("informes");
  const supabase = await createClient();
  const { data } = await supabase
    .from("report_exports")
    .select(
      "id, report_key, format, status, row_count, size_bytes, sha256, error_code, created_at, expires_at",
    )
    .eq("company_id", ctx.activeCompanyId as string)
    .eq("requested_by", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(50);
  const exports = data ?? [];

  return (
    <>
      <BackLink href="/informes" label="Informes" />
      <PageHeader
        title="Mis exportaciones"
        description="Archivos privados: solo tú puedes descargarlos, durante 7 días. Cada descarga queda registrada."
        actions={
          <Link
            href="/informes/exportaciones"
            className="hover:bg-accent inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm"
          >
            <RefreshCw className="size-4" aria-hidden /> Actualizar
          </Link>
        }
      />
      {exports.length === 0 ? (
        <p className="text-muted-foreground text-sm">Aún no has pedido ninguna exportación.</p>
      ) : (
        <ul className="grid gap-3">
          {exports.map((x) => {
            const status = STATUS[x.status] ?? { label: x.status, variant: "outline" as const };
            const live = isDownloadable(x);
            return (
              <li key={x.id}>
                <Card>
                  <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="grid flex-1 gap-1 text-sm">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {isReportKey(x.report_key) ? REPORTS[x.report_key].title : x.report_key} ·{" "}
                        {x.format.toUpperCase()}{" "}
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </p>
                      <p className="text-muted-foreground">
                        Pedida el {formatDateTimeIn(x.created_at, BUSINESS_TIME_ZONE)}
                        {x.row_count !== null ? ` · ${x.row_count} filas` : ""}
                        {x.size_bytes ? ` · ${size(x.size_bytes)}` : ""}
                        {live && x.expires_at
                          ? ` · caduca el ${formatDateTimeIn(x.expires_at, BUSINESS_TIME_ZONE)}`
                          : ""}
                      </p>
                      {x.sha256 ? (
                        <p className="text-muted-foreground font-mono text-xs break-all">
                          SHA-256 {x.sha256}
                        </p>
                      ) : null}
                      {x.status === "failed" ? (
                        <p className="text-destructive">
                          {ERRORS[x.error_code ?? ""] ?? "No se pudo generar. Vuelve a pedirla."}
                        </p>
                      ) : null}
                    </div>
                    {live ? (
                      <a
                        href={`/informes/descargas/${x.id}`}
                        className="bg-primary text-primary-foreground inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium"
                      >
                        <Download className="size-4" aria-hidden /> Descargar
                      </a>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
