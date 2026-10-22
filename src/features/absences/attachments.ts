/**
 * Validación de justificantes: se comprueba el contenido real (no solo la
 * extensión). PDF, JPEG o PNG hasta 5 MB. A los JPEG se les quitan los
 * metadatos (EXIF puede incluir ubicación). El nombre original no se guarda:
 * puede contener datos sensibles.
 */

import { sanitizeJpeg } from "@/features/time-tracking/selfie";
import { stripJpegMetadata } from "@/lib/files/images";

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
    const result = input.length <= 2 * 1024 * 1024 ? sanitizeJpeg(input) : stripJpegMetadata(input);
    return result.ok
      ? { ok: true, bytes: result.bytes, mime: "image/jpeg", extension: "jpg" }
      : { ok: false, error: result.error };
  }
  return { ok: false, error: "Solo se admiten PDF, JPEG o PNG." };
}
