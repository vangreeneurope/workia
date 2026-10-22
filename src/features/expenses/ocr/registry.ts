import "server-only";

import { FakeOcrProvider } from "./fake";
import type { OcrProvider } from "./types";

/**
 * Proveedor de OCR configurado. Mientras no haya un proveedor aprobado (ADR,
 * contrato de encargo de tratamiento y credenciales en el servidor), en
 * producción no hay OCR: los gastos se completan a mano y ningún ticket sale de
 * la plataforma. El proveedor falso solo se admite fuera de producción.
 *
 * Para añadir un proveedor real: implementar OcrProvider en ocr/<proveedor>.ts,
 * registrarlo aquí con su variable de entorno y documentarlo en docs/GASTOS.md.
 */
export function getOcrProvider(): OcrProvider | null {
  const configured = process.env.OCR_PROVIDER ?? "";
  if (configured === "fake" && process.env.NODE_ENV !== "production") return new FakeOcrProvider();
  return null;
}
