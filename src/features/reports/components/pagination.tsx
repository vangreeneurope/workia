import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

/** Paginación por enlaces (sin JavaScript): conserva los filtros de la URL. */
export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const link =
    "hover:bg-accent inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 text-sm";
  return (
    <nav aria-label="Páginas" className="mt-4 flex flex-wrap items-center justify-between gap-2">
      {page > 1 ? (
        <Link className={link} href={hrefFor(page - 1)}>
          <ChevronLeft className="size-4" aria-hidden /> Anterior
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground text-sm">
        Página {page} de {pages}
      </span>
      {page < pages ? (
        <Link className={link} href={hrefFor(page + 1)}>
          Siguiente <ChevronRight className="size-4" aria-hidden />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
