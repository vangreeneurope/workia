/**
 * Validación de justificantes: se comprueba el contenido real (no solo la
 * extensión). PDF, JPEG o PNG hasta 5 MB. A los JPEG se les quitan los
 * metadatos (EXIF puede incluir ubicación). El nombre original no se guarda:
 * puede contener datos sensibles.
 */

import { sanitizeJpeg } from "@/features/time-tracking/selfie";

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

export type AttachmentCheck =
  | {
      ok: true;
      bytes: Uint8Array;
      mime: "application/pdf" | "image/jpeg" | "image/png";
      extension: "pdf" | "jpg" | "png";
    }
  | { ok: false; error: string };

export function checkAttachment(input: Uint8Array): AttachmentCheck {
  if (input.length === 0) return { ok: false, error: "El archivo está vacío." };
  if (input.length > ATTACHMENT_MAX_BYTES) return { ok: false, error: "El archivo supera 5 MB." };
  const head = Array.from(input.slice(0, 8));
  if (
    head[0] === 0x25 &&
    head[1] === 0x50 &&
    head[2] === 0x44 &&
    head[3] === 0x46 &&
    head[4] === 0x2d
  ) {
    return { ok: true, bytes: input, mime: "application/pdf", extension: "pdf" };
  }
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return { ok: true, bytes: input, mime: "image/png", extension: "png" };
  }
  if (head[0] === 0xff && head[1] === 0xd8) {
    // sanitizeJpeg limita a 2 MB para selfies; aquí se aplica el límite de 5 MB.
    const result = input.length <= 2 * 1024 * 1024 ? sanitizeJpeg(input) : stripLargeJpeg(input);
    return result.ok
      ? { ok: true, bytes: result.bytes, mime: "image/jpeg", extension: "jpg" }
      : { ok: false, error: result.error };
  }
  return { ok: false, error: "Solo se admiten PDF, JPEG o PNG." };
}

/** Mismo saneado que sanitizeJpeg, troceado para archivos de más de 2 MB. */
function stripLargeJpeg(
  input: Uint8Array,
): { ok: true; bytes: Uint8Array } | { ok: false; error: string } {
  let i = 2;
  const parts: Uint8Array[] = [input.slice(0, 2)];
  while (i < input.length) {
    if (input[i] !== 0xff) return { ok: false, error: "La imagen está dañada." };
    const marker = input[i + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) {
      parts.push(input.slice(i));
      break;
    }
    const length = ((input[i + 2] ?? 0) << 8) + (input[i + 3] ?? 0);
    if (length < 2 || i + 2 + length > input.length)
      return { ok: false, error: "La imagen está dañada." };
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) parts.push(input.slice(i, i + 2 + length));
    i += 2 + length;
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return { ok: true, bytes: out };
}
