import type { BatchLine, TotalRow } from "./types";

type Dimension = TotalRow["dimension"];

const KEYS: Record<Exclude<Dimension, "total">, (l: BatchLine) => [string, string]> = {
  employee: (l) => [l.employee_code, l.employee_name],
  category: (l) => [l.category_code, l.category_name],
  account: (l) => [l.account_code, l.account_code],
  cost_center: (l) => [l.cost_center ?? "", l.cost_center ?? "Sin centro de coste"],
  project: (l) => [l.project_code ?? "", l.project_code ?? "Sin proyecto"],
};

/** Mismos totales que accounting_batch_totals, calculados a partir de las líneas. */
export function computeTotals(lines: BatchLine[]): TotalRow[] {
  const map = new Map<string, TotalRow>();
  const add = (dimension: Dimension, key: string, label: string, l: BatchLine) => {
    const id = `${dimension}|${key}|${l.currency}`;
    const row = map.get(id) ?? {
      dimension,
      key,
      label,
      currency: l.currency,
      base_cents: 0,
      tax_cents: 0,
      total_cents: 0,
      lines: 0,
    };
    row.base_cents += l.base_cents ?? 0;
    row.tax_cents += l.tax_cents ?? 0;
    row.total_cents += l.total_cents;
    row.lines += 1;
    map.set(id, row);
  };
  for (const l of lines) {
    add("total", "", "", l);
    for (const [dimension, fn] of Object.entries(KEYS) as [
      Exclude<Dimension, "total">,
      (l: BatchLine) => [string, string],
    ][]) {
      const [key, label] = fn(l);
      add(dimension, key, label, l);
    }
  }
  return sortTotals([...map.values()]);
}

export function sortTotals(rows: TotalRow[]): TotalRow[] {
  return [...rows].sort(
    (a, b) =>
      a.dimension.localeCompare(b.dimension) ||
      a.key.localeCompare(b.key) ||
      a.currency.localeCompare(b.currency),
  );
}

/**
 * Garantiza que los totales de la base de datos coinciden con las líneas antes
 * de generar cualquier archivo. Si no, no se genera nada.
 */
export function assertTotalsMatch(lines: BatchLine[], dbTotals: TotalRow[]): void {
  const fmt = (rows: TotalRow[]) =>
    sortTotals(rows)
      .map(
        (r) =>
          `${r.dimension}|${r.key}|${r.currency}|${r.base_cents}|${r.tax_cents}|${r.total_cents}|${r.lines}`,
      )
      .join("\n");
  if (fmt(computeTotals(lines)) !== fmt(dbTotals)) {
    throw new Error("Los totales del lote no cuadran con sus líneas");
  }
}

export function grandTotals(totals: TotalRow[]): TotalRow[] {
  return totals.filter((t) => t.dimension === "total");
}
