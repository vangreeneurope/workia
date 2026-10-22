"use client";

import { Camera, FileText, RotateCcw, Upload } from "lucide-react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SubmitButton } from "@/components/admin/submit-button";
import { Button } from "@/components/ui/button";
import { initialFormState } from "@/lib/forms";
import { networkSafe } from "@/lib/network";

import { uploadReceipt } from "../actions";
import { prepareReceipt, type PreparedReceipt } from "../compress";

function formatBytes(n: number): string {
  return n >= 1024 * 1024
    ? `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Captura del ticket: cámara trasera del móvil o archivo (JPEG, PNG o PDF). Las
 * fotos se reducen en el navegador sin perder legibilidad (lado mayor de hasta
 * 2400 px, JPEG de calidad alta) y se corrige su orientación. El servidor
 * vuelve a validar todo.
 */
export function CaptureForm() {
  const [state, formAction, pending] = useActionState(networkSafe(uploadReceipt), initialFormState);
  const [, startSubmit] = useTransition();
  const [prepared, setPrepared] = useState<PreparedReceipt | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  // Una clave por archivo elegido: reenviar el mismo archivo no duplica el gasto.
  const keyStore = useRef("");
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    setProcessing(true);
    try {
      const result = await prepareReceipt(file);
      if (!result.ok) {
        setError(result.error);
        setPrepared(null);
        setPreview(null);
        return;
      }
      keyStore.current = crypto.randomUUID();
      setPrepared(result);
      setPreview(result.file.type.startsWith("image/") ? URL.createObjectURL(result.file) : null);
    } finally {
      setProcessing(false);
    }
  }

  function reset() {
    setPrepared(null);
    setPreview(null);
    setError(null);
    keyStore.current = "";
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!prepared) {
          setError("Haz una foto del ticket o elige un archivo.");
          return;
        }
        const fd = new FormData();
        fd.set("receipt", prepared.file);
        fd.set("idempotency_key", keyStore.current);
        startSubmit(() => formAction(fd));
      }}
      className="grid gap-4"
      noValidate
    >
      <FormMessage state={state} />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={onPick}
        data-testid="camera-input"
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf,.heic,.heif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={onPick}
        data-testid="file-input"
      />

      {!prepared ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            type="button"
            size="lg"
            className="h-24 flex-col gap-2 text-base"
            onClick={() => cameraRef.current?.click()}
            disabled={processing}
          >
            <Camera className="size-7" aria-hidden />
            Hacer foto del ticket
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="h-24 flex-col gap-2 text-base"
            onClick={() => fileRef.current?.click()}
            disabled={processing}
          >
            <Upload className="size-7" aria-hidden />
            Subir foto o PDF
          </Button>
          <p className="text-muted-foreground text-xs sm:col-span-2">
            La cámara solo se abre al pulsar el botón y la foto no sale del dispositivo hasta que la
            envías. Si no permites la cámara o no está disponible, sube una foto o un PDF, o
            registra el gasto sin ticket más abajo.
          </p>
        </div>
      ) : (
        <figure className="grid gap-3">
          {preview ? (
            // URL local (blob:) de la propia foto: no pasa por el optimizador de imágenes.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="Vista previa del ticket"
              className="bg-muted mx-auto max-h-[60vh] w-auto rounded-xl border object-contain"
            />
          ) : (
            <div className="bg-muted flex items-center gap-3 rounded-xl border p-4">
              <FileText className="size-8 shrink-0" aria-hidden />
              <span>Documento PDF</span>
            </div>
          )}
          <figcaption className="text-muted-foreground text-sm">
            {prepared.compressed
              ? `Foto reducida de ${formatBytes(prepared.originalBytes)} a ${formatBytes(prepared.file.size)} (${prepared.width} × ${prepared.height} px).`
              : `${formatBytes(prepared.file.size)}${prepared.width ? ` · ${prepared.width} × ${prepared.height} px` : ""}.`}{" "}
            Comprueba que se leen el total, la fecha y el proveedor.
          </figcaption>
        </figure>
      )}

      <div aria-live="polite" className="text-sm">
        {processing ? <p>Preparando la imagen…</p> : null}
        {error ? <p className="text-destructive">{error}</p> : null}
        {pending ? <p>Subiendo y leyendo el ticket…</p> : null}
      </div>

      {prepared ? (
        <div className="flex flex-wrap gap-2">
          <SubmitButton pending={pending} className="min-h-11 flex-1 sm:flex-none">
            Usar este ticket
          </SubmitButton>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={reset}
            disabled={pending}
          >
            <RotateCcw aria-hidden /> Repetir
          </Button>
        </div>
      ) : null}
    </form>
  );
}
