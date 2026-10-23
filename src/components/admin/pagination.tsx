import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { pageHref, totalPages } from "@/lib/admin/pagination";

export function Pagination({
  base,
  params,
  page,
  count,
}: {
  base: string;
  params: Record<string, string | undefined>;
  page: number;
  count: number;
}) {
  const pages = totalPages(count);
  return (
    <nav aria-label="Paginación" className="flex items-center justify-between gap-2 pt-4 text-sm">
      <span className="text-muted-foreground">
        {count} {count === 1 ? "resultado" : "resultados"} · página {page} de {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={pageHref(base, params, page - 1)} aria-label="Página anterior">
              <ChevronLeft aria-hidden /> Anterior
            </Link>
          </Button>
        ) : null}
        {page < pages ? (
          <Button asChild variant="outline" size="sm">
            <Link href={pageHref(base, params, page + 1)} aria-label="Página siguiente">
              Siguiente <ChevronRight aria-hidden />
            </Link>
          </Button>
        ) : null}
      </div>
    </nav>
  );
}
