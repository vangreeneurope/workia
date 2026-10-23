import { normalizeOcrResult } from "./normalize";
import { OcrProviderError, type OcrErrorCode, type OcrProvider } from "./types";

/** Lo que el servicio necesita de la base de datos y de Storage. */
export type OcrQueue = {
  claim(
    jobId: string,
    providerId: string,
  ): Promise<{ runId: string; storagePath: string; mime: string } | null>;
  download(storagePath: string): Promise<Uint8Array | null>;
  finish(
    runId: string,
    status: "succeeded" | "failed",
    result: Record<string, unknown> | null,
    errorCode: OcrErrorCode | null,
  ): Promise<string | null>;
};

export type OcrJobOutcome =
  | { status: "skipped" }
  | { status: "succeeded" | "needs_review" | "failed"; errorCode?: OcrErrorCode };

const MIMES = new Set(["application/pdf", "image/jpeg", "image/png"]);

/**
 * Ejecuta un intento de OCR: reclama el trabajo (si nadie lo tiene y no está en
 * espera), descarga el ticket, llama al proveedor con un tiempo máximo,
 * normaliza y cierra la ejecución. Un fallo nunca rompe el flujo: queda
 * registrado con su código y el gasto se puede completar a mano. No se
 * registra el contenido del ticket en ningún log.
 */
export async function runOcrJob(
  jobId: string,
  provider: OcrProvider,
  queue: OcrQueue,
  timeoutMs = 15000,
): Promise<OcrJobOutcome> {
  const claim = await queue.claim(jobId, provider.id);
  if (!claim) return { status: "skipped" };

  let errorCode: OcrErrorCode = "internal_error";
  try {
    const bytes = await queue.download(claim.storagePath);
    if (!bytes) throw new OcrProviderError("download_failed");
    if (!MIMES.has(claim.mime)) throw new OcrProviderError("unsupported_file");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const raw = await Promise.race([
        provider.extract(
          { bytes, mime: claim.mime as "application/pdf" | "image/jpeg" | "image/png" },
          { signal: controller.signal },
        ),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener("abort", () =>
            reject(new OcrProviderError("timeout")),
          ),
        ),
      ]);
      if (!raw || typeof raw !== "object") throw new OcrProviderError("invalid_response");
      const status = await queue.finish(claim.runId, "succeeded", normalizeOcrResult(raw), null);
      return { status: status === "needs_review" ? "needs_review" : "succeeded" };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof OcrProviderError) errorCode = error.code;
  }
  await queue.finish(claim.runId, "failed", null, errorCode);
  return { status: "failed", errorCode };
}
