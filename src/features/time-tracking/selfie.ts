/**
 * Validación y saneado de la selfie opcional. Solo JPEG de hasta 2 MB. Se
 * eliminan los segmentos de metadatos (APP1-APP15 y comentarios), donde los
 * móviles guardan EXIF con fecha, modelo y a veces coordenadas GPS. No se
 * analiza la imagen ni se extrae ningún rasgo: no hay reconocimiento facial.
 */

export const SELFIE_MAX_BYTES = 2 * 1024 * 1024;

export type SanitizeResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

export function sanitizeJpeg(input: Uint8Array): SanitizeResult {
  if (input.length === 0) return { ok: false, error: "La foto está vacía." };
  if (input.length > SELFIE_MAX_BYTES) return { ok: false, error: "La foto supera 2 MB." };
  if (input[0] !== 0xff || input[1] !== 0xd8) {
    return { ok: false, error: "La foto debe ser JPEG." };
  }
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i < input.length) {
    if (input[i] !== 0xff) return { ok: false, error: "La foto está dañada." };
    const marker = input[i + 1];
    if (marker === undefined) return { ok: false, error: "La foto está dañada." };
    if (marker === 0xff) {
      i += 1; // relleno
      continue;
    }
    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      return { ok: true, bytes: Uint8Array.from(out) };
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    const high = input[i + 2];
    const low = input[i + 3];
    if (high === undefined || low === undefined)
      return { ok: false, error: "La foto está dañada." };
    const length = (high << 8) + low;
    if (length < 2 || i + 2 + length > input.length)
      return { ok: false, error: "La foto está dañada." };
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (marker === 0xda) {
      // Inicio de los datos de imagen: se copia el resto tal cual.
      for (let j = i; j < input.length; j++) out.push(input[j] as number);
      return { ok: true, bytes: Uint8Array.from(out) };
    }
    if (!isMetadata) {
      for (let j = i; j < i + 2 + length; j++) out.push(input[j] as number);
    }
    i += 2 + length;
  }
  return { ok: false, error: "La foto está incompleta." };
}
