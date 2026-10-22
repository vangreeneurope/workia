/**
 * Comprobaciones de PDF subidos por personas (tickets y justificantes): se
 * rechazan los que contienen contenido activo (JavaScript, acciones al abrir,
 * archivos incrustados, formularios XFA, multimedia) o están truncados.
 */

/** Nombres de PDF que indican contenido activo. */
const PDF_ACTIVE =
  /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA|SubmitForm|ImportData|GoToR)\b/;

export type PdfCheck = { ok: true } | { ok: false; reason: "active" | "truncated" };

export function checkPdf(bytes: Uint8Array): PdfCheck {
  // latin1 conserva cada byte: sirve para buscar nombres del formato PDF.
  const text = Buffer.from(bytes).toString("latin1");
  if (PDF_ACTIVE.test(text)) return { ok: false, reason: "active" };
  if (!text.slice(-1024).includes("%%EOF")) return { ok: false, reason: "truncated" };
  return { ok: true };
}
