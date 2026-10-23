import type { Column } from "../catalog";
import { displayCell, type ReportRow } from "../rows";

/**
 * Tabla de informe adaptable: en móvil cada fila es una tarjeta con sus campos;
 * desde md, una tabla con desplazamiento horizontal propio (la página no se
 * desplaza en horizontal).
 */
export function ReportTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: Column[];
  rows: ReportRow[];
}) {
  const numeric = (c: Column) => c.kind === "int" || c.kind === "duration" || c.kind === "money";
  const [first, ...rest] = columns;
  return (
    <>
      <ul className="grid gap-3 md:hidden" aria-label={caption}>
        {rows.map((row, i) => (
          <li key={i} className="bg-card rounded-xl border p-3 text-sm shadow-xs">
            {first ? <p className="mb-2 font-medium">{displayCell(first, row)}</p> : null}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {rest.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="text-muted-foreground">{c.label}</dt>
                  <dd className={numeric(c) ? "text-right tabular-nums" : "break-words"}>
                    {displayCell(c, row)}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      {/* Región desplazable enfocable: con teclado se recorre con las flechas. */}
      <div
        className="relative hidden overflow-x-auto rounded-xl border md:block"
        role="region"
        aria-label={caption}
        tabIndex={0}
      >
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted/50 text-muted-foreground text-left">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-3 py-2 font-medium whitespace-nowrap ${numeric(c) ? "text-right" : ""}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row, i) => (
              <tr key={i} className="align-top">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2 ${numeric(c) ? "text-right whitespace-nowrap tabular-nums" : c.kind === "text" && (c.key === "punches" || c.key === "adjustments" || c.key === "changes") ? "min-w-64" : "whitespace-nowrap"}`}
                  >
                    {displayCell(c, row)}
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
