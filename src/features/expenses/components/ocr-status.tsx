"use client";

import { AlertCircle, CheckCircle2, Loader2, RefreshCw, ScanText } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { retryOcr } from "../actions";

export type OcrView =
  "disabled" | "pending" | "processing" | "succeeded" | "needs_review" | "failed";

const TEXT: Record<OcrView, string> = {
  disabled: "La lectura automática no está activada: escribe los datos del ticket.",
  pending: "Lectura automática en cola.",
  processing: "Leyendo el ticket…",
  succeeded: "Datos propuestos por la lectura automática: compruébalos con el ticket.",
  needs_review:
    "La lectura automática ha propuesto datos, pero algunos son dudosos: revisa los marcados.",
  failed: "No se ha podido leer el ticket. Completa los datos a mano; el ticket queda guardado.",
};

/** Estado del OCR con opción de reintentar (límites en la base de datos). */
export function OcrStatus({
  view,
  canRetry,
  expenseId,
}: {
  view: OcrView;
  canRetry: boolean;
  expenseId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const Icon =
    view === "failed"
      ? AlertCircle
      : view === "succeeded"
        ? CheckCircle2
        : view === "processing"
          ? Loader2
          : ScanText;
  return (
    <div
      role="status"
      className="bg-card/70 flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm"
    >
      <Icon
        className={view === "processing" ? "size-5 shrink-0 animate-spin" : "size-5 shrink-0"}
        aria-hidden
      />
      <p className="min-w-0 flex-1">{TEXT[view]}</p>
      {canRetry ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await retryOcr(expenseId);
              if (result.status === "error") setError(result.message ?? "No se pudo reintentar.");
            })
          }
        >
          <RefreshCw className={pending ? "animate-spin" : undefined} aria-hidden />
          Volver a leer
        </Button>
      ) : null}
      {error ? <p className="text-destructive w-full">{error}</p> : null}
    </div>
  );
}
