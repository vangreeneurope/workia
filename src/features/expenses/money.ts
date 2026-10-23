/**
 * Importes como enteros en céntimos (nunca decimales en coma flotante).
 * Admite "1.234,56", "1,234.56", "12,5", "12" y símbolos de moneda alrededor.
 */
export function parseMoneyToCents(raw: string): number | null {
  const s = raw.replace(/[€$£\s]|EUR|USD|GBP/gi, "");
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const negative = s.startsWith("-");
  const digits = negative ? s.slice(1) : s;
  const lastSep = Math.max(digits.lastIndexOf(","), digits.lastIndexOf("."));
  let intPart = digits;
  let decPart = "";
  // El último separador es decimal si le siguen 1 o 2 cifras; si no, es de miles.
  if (lastSep >= 0 && digits.length - lastSep - 1 <= 2) {
    intPart = digits.slice(0, lastSep);
    decPart = digits.slice(lastSep + 1);
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d*$/.test(intPart) || !/^\d{0,2}$/.test(decPart) || (intPart + decPart).length === 0)
    return null;
  const cents = Number(intPart || "0") * 100 + Number(decPart.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents) || cents > 99_999_999_99) return null;
  return negative ? -cents : cents;
}

export function formatCents(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);
}

/** Céntimos -> "1234,56" para un campo de formulario. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}
