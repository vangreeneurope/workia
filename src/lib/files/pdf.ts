/**
 * Comprobaciones de PDF subidos por personas (tickets y justificantes): se
 * rechazan los que contienen contenido activo (JavaScript, acciones al abrir,
 * archivos incrustados, formularios XFA, multimedia) o están truncados.
 *
 * Los nombres PDF admiten escapes (#xx: "/J#61vaScript" es "/JavaScript") y
 * los diccionarios pueden ir dentro de flujos de objetos comprimidos (ObjStm):
 * ambos se revisan. Un flujo de objetos que no se puede revisar (filtro
 * desconocido, datos corruptos o demasiado grandes) se rechaza.
 */

import { inflateSync } from "node:zlib";

/** Nombres de PDF que indican contenido activo. */
const PDF_ACTIVE =
  /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA|SubmitForm|ImportData|GoToR)\b/;

/** Límite de datos descomprimidos de flujos de objetos (evita bombas de compresión). */
const MAX_INFLATED_BYTES = 8 * 1024 * 1024;

export type PdfCheck = { ok: true } | { ok: false; reason: "active" | "truncated" };

/** Deshace los escapes #xx de los nombres PDF. */
function decodeNames(text: string): string {
  return text.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

/**
 * Contenido de los flujos de objetos (/Type /ObjStm), ya descomprimido. Devuelve
 * null si alguno no se puede revisar.
 */
function objectStreams(bytes: Uint8Array, text: string): string[] | null {
  const out: string[] = [];
  let inflated = 0;
  // "stream" como palabra (no la cola de "endstream").
  const re = /(?<!end)stream\r?\n/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[0].length;
    const objStart = text.lastIndexOf(" obj", m.index);
    const dict = decodeNames(text.slice(Math.max(objStart, m.index - 4000), m.index));
    if (!/\/Type\s*\/ObjStm\b/.test(dict)) continue;
    const end = text.indexOf("endstream", start);
    if (end === -1) return null;
    const filter = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/
      .exec(dict)?.[1]
      ?.replace(/[[\]\s]/g, "");
    let data: Buffer = Buffer.from(bytes.subarray(start, end));
    if (filter === "/FlateDecode") {
      try {
        data = inflateSync(data, { maxOutputLength: MAX_INFLATED_BYTES - inflated });
      } catch {
        return null;
      }
    } else if (filter !== undefined) {
      return null; // filtro que no se revisa: no se acepta a ciegas
    }
    inflated += data.length;
    out.push(decodeNames(data.toString("latin1")));
    re.lastIndex = end + "endstream".length;
  }
  return out;
}

export function checkPdf(bytes: Uint8Array): PdfCheck {
  // latin1 conserva cada byte: sirve para buscar nombres del formato PDF.
  const text = Buffer.from(bytes).toString("latin1");
  if (PDF_ACTIVE.test(decodeNames(text))) return { ok: false, reason: "active" };
  const streams = objectStreams(bytes, text);
  if (!streams || streams.some((s) => PDF_ACTIVE.test(s))) return { ok: false, reason: "active" };
  if (!text.slice(-1024).includes("%%EOF")) return { ok: false, reason: "truncated" };
  return { ok: true };
}
