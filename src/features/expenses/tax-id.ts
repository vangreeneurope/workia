/**
 * NIF, NIE y CIF españoles: normalización y dígito o letra de control. Un
 * identificador extranjero no se valida (se propone para revisar).
 */

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

export function normalizeTaxId(raw: string): string | null {
  const s = raw
    .toUpperCase()
    .replace(/^ES/, "")
    .replace(/[\s.\-/]/g, "");
  return /^[A-Z0-9]{5,20}$/.test(s) ? s : null;
}

export function isValidSpanishTaxId(id: string): boolean {
  if (/^\d{8}[A-Z]$/.test(id)) return DNI_LETTERS[Number(id.slice(0, 8)) % 23] === id[8];
  if (/^[XYZ]\d{7}[A-Z]$/.test(id)) {
    const n = Number(String("XYZ".indexOf(id[0] ?? "")) + id.slice(1, 8));
    return DNI_LETTERS[n % 23] === id[8];
  }
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(id))
    return cifControl(id.slice(1, 8)) === id[8] || cifLetter(id.slice(1, 8)) === id[8];
  return false;
}

function cifSum(digits: string): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i]);
    if (i % 2 === 0) {
      const doubled = d * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += d;
    }
  }
  return (10 - (sum % 10)) % 10;
}

function cifControl(digits: string): string {
  return String(cifSum(digits));
}

function cifLetter(digits: string): string {
  return "JABCDEFGHI"[cifSum(digits)] ?? "";
}

/** Construye un CIF válido a partir de 7 cifras (solo para datos sintéticos). */
export function syntheticCif(letter: string, digits: string): string {
  return `${letter}${digits}${cifControl(digits)}`;
}
