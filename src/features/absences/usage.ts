import { addMonths, monthLabel } from "@/features/schedules/calendar";

import { formatAmount, type BalanceUnit } from "./units";

type UsageMovement = { kind: string; amount: number; effective_date: string };

/**
 * Uso neto por mes del periodo (usos menos reversiones), imputado al mes de la
 * fecha de efecto del movimiento. Devuelve 12 meses desde el inicio del periodo.
 */
export function monthlyUsage(
  movements: UsageMovement[],
  periodStart: string,
  unit: BalanceUnit,
): { label: string; value: number; display: string }[] {
  const totals = new Map<string, number>();
  for (const m of movements) {
    if (m.kind !== "usage" && m.kind !== "usage_reversal") continue;
    const key = m.effective_date.slice(0, 7);
    totals.set(key, (totals.get(key) ?? 0) - m.amount);
  }
  return Array.from({ length: 12 }, (_, i) => {
    const month = addMonths(`${periodStart.slice(0, 7)}-01`, i);
    const value = Math.max(0, totals.get(month.slice(0, 7)) ?? 0);
    return { label: monthLabel(month), value, display: formatAmount(value, unit) };
  });
}

/** Fracción disponible sobre lo concedido en el periodo (derecho, arrastre y ajustes). */
export function availableFraction(b: {
  available: number;
  entitled: number;
  carried: number;
  adjusted: number;
}): number {
  const granted = b.entitled + b.carried + b.adjusted;
  return granted > 0 ? b.available / granted : 0;
}
