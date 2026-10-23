import type { ReactNode } from "react";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Se oculta en la vista de tarjetas (móvil). */
  desktopOnly?: boolean;
  className?: string;
};

/**
 * Tabla en escritorio y tarjetas apiladas en móvil (mobile-first, sin scroll
 * horizontal). La primera columna actúa como título de la tarjeta.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  empty,
  caption,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  empty: string;
  caption: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
        {empty}
      </p>
    );
  }
  const [first, ...rest] = columns;
  return (
    <>
      <ul className="grid gap-3 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="bg-card rounded-lg border p-4">
            <div className="font-medium">{first?.cell(row)}</div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {rest
                .filter((c) => !c.desktopOnly)
                .map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-muted-foreground">{c.header}</dt>
                    <dd className="min-w-0 break-words">{c.cell(row)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
      {/* Si la tabla no cabe (768-1024 px), se desplaza dentro de su caja; nunca recorta. */}
      <div
        className="relative hidden overflow-x-auto rounded-lg border md:block"
        role="region"
        aria-label={caption}
        tabIndex={0}
      >
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-4 py-3 font-medium ${c.className ?? ""}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="bg-card">
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 align-top ${c.className ?? ""}`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
