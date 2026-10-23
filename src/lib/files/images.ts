/**
 * Utilidades de imágenes sin dependencias: dimensiones leídas de la cabecera y
 * eliminación de metadatos (EXIF puede incluir ubicación, fecha y dispositivo).
 * No decodifican la imagen ni analizan su contenido.
 */

export type StripResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/** Quita los segmentos APP1-APP15 y comentarios de un JPEG, sin límite de tamaño. */
export function stripJpegMetadata(input: Uint8Array): StripResult {
  if (input[0] !== 0xff || input[1] !== 0xd8) return { ok: false, error: "La imagen está dañada." };
  let i = 2;
  const parts: Uint8Array[] = [input.slice(0, 2)];
  while (i < input.length) {
    if (input[i] !== 0xff) return { ok: false, error: "La imagen está dañada." };
    const marker = input[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1; // relleno
      continue;
    }
    if (marker === 0xd9) {
      parts.push(input.slice(i, i + 2));
      break;
    }
    if (marker === 0xda) {
      // Datos de imagen hasta el fin de imagen (FFD9). En los datos comprimidos un
      // 0xFF siempre va seguido de 00 o de un marcador de reinicio, así que el
      // primer FFD9 es el final real: lo que venga detrás (p. ej. un archivo
      // políglota) se descarta.
      let j = i + 2;
      while (j + 1 < input.length && !(input[j] === 0xff && input[j + 1] === 0xd9)) j += 1;
      parts.push(input.slice(i, Math.min(j + 2, input.length)));
      break;
    }
    const length = ((input[i + 2] ?? 0) << 8) + (input[i + 3] ?? 0);
    if (length < 2 || i + 2 + length > input.length)
      return { ok: false, error: "La imagen está dañada." };
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) parts.push(input.slice(i, i + 2 + length));
    i += 2 + length;
  }
  return { ok: true, bytes: concat(parts) };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Fragmentos de texto, EXIF y fecha: se descartan. El resto se copia entero (con su CRC).
const PNG_METADATA_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

/** Quita los fragmentos de texto y EXIF de un PNG. */
export function stripPngMetadata(input: Uint8Array): StripResult {
  if (!PNG_SIGNATURE.every((b, i) => input[i] === b))
    return { ok: false, error: "La imagen está dañada." };
  const parts: Uint8Array[] = [input.slice(0, 8)];
  let i = 8;
  let ended = false;
  while (i + 12 <= input.length) {
    const length = readUint32(input, i);
    const type = String.fromCharCode(...input.slice(i + 4, i + 8));
    const end = i + 12 + length;
    if (end > input.length || !/^[A-Za-z]{4}$/.test(type))
      return { ok: false, error: "La imagen está dañada." };
    if (!PNG_METADATA_CHUNKS.has(type)) parts.push(input.slice(i, end));
    i = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended) return { ok: false, error: "La imagen está dañada." };
  return { ok: true, bytes: concat(parts) };
}

/** Ancho y alto declarados en la cabecera (PNG: IHDR; JPEG: primer SOF). */
export function imageDimensions(
  input: Uint8Array,
  mime: "image/jpeg" | "image/png",
): { width: number; height: number } | null {
  if (mime === "image/png") {
    if (input.length < 24 || String.fromCharCode(...input.slice(12, 16)) !== "IHDR") return null;
    return { width: readUint32(input, 16), height: readUint32(input, 20) };
  }
  let i = 2;
  while (i + 9 < input.length) {
    if (input[i] !== 0xff) return null;
    const marker = input[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = ((input[i + 2] ?? 0) << 8) + (input[i + 3] ?? 0);
    // SOF0-SOF15, salvo DHT (C4), JPG (C8) y DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = ((input[i + 5] ?? 0) << 8) + (input[i + 6] ?? 0);
      const width = ((input[i + 7] ?? 0) << 8) + (input[i + 8] ?? 0);
      return { width, height };
    }
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

function readUint32(input: Uint8Array, offset: number): number {
  return (
    (((input[offset] ?? 0) << 24) >>> 0) +
    ((input[offset + 1] ?? 0) << 16) +
    ((input[offset + 2] ?? 0) << 8) +
    (input[offset + 3] ?? 0)
  );
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
