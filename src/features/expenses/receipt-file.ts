/**
 * Validación de tickets en el servidor. No se confía en nada de lo que dice el
 * navegador: se comprueban extensión, firma real del contenido, tipo MIME
 * declarado, tamaño y dimensiones. PDF con contenido activo (JavaScript,
 * acciones automáticas o ficheros incrustados) se rechaza. A las imágenes se
 * les quitan los metadatos. El nombre original no se guarda.
 */

import { createHash } from "node:crypto";

import { imageDimensions, stripJpegMetadata, stripPngMetadata } from "@/lib/files/images";
import { checkPdf } from "@/lib/files/pdf";

export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_MIN_SIDE = 200;
export const RECEIPT_MAX_SIDE = 12000;
export const RECEIPT_MAX_PIXELS = 50_000_000;

export type ReceiptMime = "application/pdf" | "image/jpeg" | "image/png";
export type ReceiptExtension = "pdf" | "jpg" | "png";

export type ReceiptCheck =
  | {
      ok: true;
      bytes: Uint8Array;
      mime: ReceiptMime;
      extension: ReceiptExtension;
      width: number | null;
      height: number | null;
      sha256: string;
    }
  | { ok: false; error: string };

const EXTENSIONS: Record<string, ReceiptMime> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

const ERRORS = {
  empty: "El archivo está vacío.",
  size: "El archivo supera 10 MB. Haz la foto de nuevo o reduce el PDF.",
  extension: "Solo se admiten fotos JPEG o PNG y documentos PDF.",
  content: "El contenido del archivo no es un PDF, JPEG o PNG válido.",
  mismatch: "El tipo del archivo no coincide con su contenido.",
  small: "La imagen es demasiado pequeña para leer el ticket. Acércate más al hacer la foto.",
  large: "La imagen es demasiado grande. Vuelve a hacer la foto.",
  pdfActive: "El PDF contiene contenido activo (scripts o adjuntos) y no se admite.",
} as const;

function detect(bytes: Uint8Array): ReceiptMime | null {
  const h = Array.from(bytes.slice(0, 8));
  if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46 && h[4] === 0x2d)
    return "application/pdf";
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => h[i] === b))
    return "image/png";
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return "image/jpeg";
  return null;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function checkReceiptFile(input: {
  bytes: Uint8Array;
  fileName: string;
  declaredMime: string;
}): ReceiptCheck {
  const { bytes } = input;
  if (bytes.length === 0) return { ok: false, error: ERRORS.empty };
  if (bytes.length > RECEIPT_MAX_BYTES) return { ok: false, error: ERRORS.size };
  const ext = /\.([a-z0-9]{1,5})$/i.exec(input.fileName)?.[1]?.toLowerCase() ?? "";
  const byExtension = EXTENSIONS[ext];
  if (!byExtension) return { ok: false, error: ERRORS.extension };
  const detected = detect(bytes);
  if (!detected) return { ok: false, error: ERRORS.content };
  if (detected !== byExtension || detected !== input.declaredMime.toLowerCase())
    return { ok: false, error: ERRORS.mismatch };

  if (detected === "application/pdf") {
    const pdf = checkPdf(bytes);
    if (!pdf.ok)
      return { ok: false, error: pdf.reason === "active" ? ERRORS.pdfActive : ERRORS.content };
    return {
      ok: true,
      bytes,
      mime: detected,
      extension: "pdf",
      width: null,
      height: null,
      sha256: sha256Hex(bytes),
    };
  }

  const size = imageDimensions(bytes, detected);
  if (!size) return { ok: false, error: ERRORS.content };
  if (size.width < RECEIPT_MIN_SIDE || size.height < RECEIPT_MIN_SIDE)
    return { ok: false, error: ERRORS.small };
  if (
    size.width > RECEIPT_MAX_SIDE ||
    size.height > RECEIPT_MAX_SIDE ||
    size.width * size.height > RECEIPT_MAX_PIXELS
  )
    return { ok: false, error: ERRORS.large };
  const stripped = detected === "image/jpeg" ? stripJpegMetadata(bytes) : stripPngMetadata(bytes);
  if (!stripped.ok) return { ok: false, error: ERRORS.content };
  return {
    ok: true,
    bytes: stripped.bytes,
    mime: detected,
    extension: detected === "image/jpeg" ? "jpg" : "png",
    width: size.width,
    height: size.height,
    sha256: sha256Hex(stripped.bytes),
  };
}
