/** Céntimos enteros -> texto, sin pasar nunca por números con decimales. */
export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Importe no entero");
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 123456 -> "1.234,56" (formato español, para el PDF). */
export function centsToEs(cents: number): string {
  const [int = "0", dec = "00"] = centsToDecimal(cents).replace("-", "").split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${cents < 0 ? "-" : ""}${grouped},${dec}`;
}
