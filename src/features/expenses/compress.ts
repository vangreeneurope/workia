/**
 * Preparación del ticket en el navegador antes de subirlo. Las fotos de móvil
 * pesan varios megas: se reducen a un lado mayor de 2400 px (suficiente para
 * leer un ticket) en JPEG de calidad alta, corrigiendo la orientación. Si la
 * imagen ya es ligera se envía tal cual. Los PDF no se tocan.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const TARGET_LONG_SIDE = 2400;
export const MIN_SIDE = 200;
const KEEP_IF_UNDER = 2 * 1024 * 1024;

export type PreparedReceipt = {
  ok: true;
  file: File;
  compressed: boolean;
  originalBytes: number;
  width: number | null;
  height: number | null;
};

export type PrepareResult = PreparedReceipt | { ok: false; error: string };

type Decoded = {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
};

async function decode(file: File): Promise<Decoded | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
    };
  } catch {
    return null;
  }
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export async function prepareReceipt(
  file: File,
  decoder: (file: File) => Promise<Decoded | null> = decode,
): Promise<PrepareResult> {
  if (file.size === 0) return { ok: false, error: "El archivo está vacío." };
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) {
    if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "El PDF supera 10 MB." };
    const named = new File([file], "ticket.pdf", { type: "application/pdf" });
    return {
      ok: true,
      file: named,
      compressed: false,
      originalBytes: file.size,
      width: null,
      height: null,
    };
  }
  const isImage = file.type.startsWith("image/") || /\.(heic|heif|jpe?g|png)$/i.test(file.name);
  if (!isImage) return { ok: false, error: "Solo se admiten fotos (JPEG, PNG) y PDF." };

  const image = await decoder(file);
  const plain = file.type === "image/jpeg" || file.type === "image/png";
  if (!image) {
    // Sin decodificador: se envía si ya es un formato admitido; el servidor valida el resto.
    if (plain && file.size <= MAX_UPLOAD_BYTES) {
      const ext = file.type === "image/png" ? "png" : "jpg";
      return {
        ok: true,
        file: new File([file], `ticket.${ext}`, { type: file.type }),
        compressed: false,
        originalBytes: file.size,
        width: null,
        height: null,
      };
    }
    return {
      ok: false,
      error: "No se puede abrir esta imagen. Haz la foto con la cámara o usa JPEG, PNG o PDF.",
    };
  }
  if (Math.min(image.width, image.height) < MIN_SIDE) {
    return {
      ok: false,
      error: "La imagen es demasiado pequeña para leer el ticket. Acércate más.",
    };
  }
  const long = Math.max(image.width, image.height);
  if (plain && long <= TARGET_LONG_SIDE && file.size <= KEEP_IF_UNDER) {
    const ext = file.type === "image/png" ? "png" : "jpg";
    return {
      ok: true,
      file: new File([file], `ticket.${ext}`, { type: file.type }),
      compressed: false,
      originalBytes: file.size,
      width: image.width,
      height: image.height,
    };
  }
  const scale = Math.min(1, TARGET_LONG_SIDE / long);
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, error: "No se pudo preparar la imagen." };
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  image.draw(ctx, width, height);
  let blob = await toJpeg(canvas, 0.85);
  if (blob && blob.size > 4 * 1024 * 1024) blob = await toJpeg(canvas, 0.75);
  if (!blob || blob.size > MAX_UPLOAD_BYTES)
    return { ok: false, error: "No se pudo reducir la imagen." };
  return {
    ok: true,
    file: new File([blob], "ticket.jpg", { type: "image/jpeg" }),
    compressed: true,
    originalBytes: file.size,
    width,
    height,
  };
}
