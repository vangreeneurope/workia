import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { businessDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

import type { ReportDef } from "../catalog";
import { filtersToSearch, parseFilters } from "../filters";
import { loadFilterOptions } from "../options";
import { fetchReport, SCREEN_PAGE_SIZE } from "../query";

import { ExportForm } from "./export-form";
import { Pagination } from "./pagination";
import { ReportFiltersForm } from "./report-filters";
import { ReportTable } from "./report-table";

/**
 * Vista de un informe: filtros (URL), una página de resultados calculada en la
 * base de datos con la sesión del usuario y la exportación de la vista. El
 * navegador nunca recibe el conjunto completo.
 */
export async function ReportView({
  def,
  companyId,
  basePath,
  search,
}: {
  def: ReportDef;
  companyId: string;
  basePath: string;
  search: Record<string, string | string[] | undefined>;
}) {
  const { filters, errors } = parseFilters(def, search, businessDate());
  const supabase = await createClient();
  const pageSize = def.paginated ? SCREEN_PAGE_SIZE : 500;
  const [page, options] = await Promise.all([
    fetchReport(supabase, companyId, def.key, filters, pageSize, (filters.page - 1) * pageSize),
    loadFilterOptions(supabase, companyId, def),
  ]);
  // Auditoría: el actor se muestra con su nombre si la persona puede verlo (RLS de perfiles).
  if (def.key === "audit") {
    const names = new Map(options.actors.map((a) => [a.value, a.label]));
    for (const row of page.rows) {
      const actor = row.actor;
      row.actor = typeof actor === "string" ? (names.get(actor) ?? actor.slice(0, 8)) : "Sistema";
    }
  }
  const query = filtersToSearch(def, filters, { page: 1 });
  const hrefFor = (p: number) => {
    const q = filtersToSearch(def, filters, { page: p });
    return q ? `${basePath}?${q}` : basePath;
  };

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
          <CardDescription>{def.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {errors.length > 0 ? (
            <ul className="grid gap-1 text-sm" aria-live="polite">
              {errors.map((e) => (
                <li key={e} className="flex items-center gap-2">
                  <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden /> {e}
                </li>
              ))}
            </ul>
          ) : null}
          <ReportFiltersForm def={def} filters={filters} options={options} action={basePath} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-1">
            <CardTitle className="text-base">Resultados</CardTitle>
            <CardDescription>
              {page.failed
                ? "No se pudo calcular el informe. Revisa los filtros e inténtalo de nuevo."
                : `${page.total} ${page.total === 1 ? "fila" : "filas"}${def.paginated && page.total > pageSize ? ` · ${pageSize} por página` : ""}`}
            </CardDescription>
          </div>
          <ExportForm report={def.key} query={query} />
        </CardHeader>
        <CardContent>
          {page.rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {page.failed ? "" : "No hay datos para estos filtros en tu ámbito."}
            </p>
          ) : (
            <ReportTable caption={def.title} columns={def.columns} rows={page.rows} />
          )}
          {def.paginated ? (
            <Pagination
              page={filters.page}
              pageSize={pageSize}
              total={page.total}
              hrefFor={hrefFor}
            />
          ) : null}
          <p className="text-muted-foreground mt-4 text-xs">
            Las exportaciones quedan en{" "}
            <Link className="underline" href="/informes/exportaciones">
              Mis exportaciones
            </Link>{" "}
            durante 7 días. Horas en formato h:mm.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
