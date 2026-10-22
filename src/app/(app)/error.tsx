"use client";

import { AlertTriangle, WifiOff } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Error al cargar una sección privada. Nunca muestra detalles internos; da el
 * identificador técnico (digest) para soporte y un reintento real (`retry`
 * vuelve a pedir los datos al servidor).
 */
export default function PrivateError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center" role="alert">
      {online ? (
        <AlertTriangle className="text-destructive size-10" aria-hidden />
      ) : (
        <WifiOff className="text-destructive size-10" aria-hidden />
      )}
      <h1 className="text-xl font-semibold">
        {online ? "No se ha podido cargar esta sección" : "Sin conexión"}
      </h1>
      <p className="text-muted-foreground max-w-md">
        {online
          ? "Puede ser un fallo temporal. Vuelve a intentarlo; si continúa, avisa a soporte con el código de abajo."
          : "Comprueba la conexión del dispositivo y vuelve a intentarlo. Los fichajes hechos sin conexión se envían solos al recuperarla."}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()}>Reintentar</Button>
        <Button asChild variant="outline">
          <Link href="/panel">Ir al inicio</Link>
        </Button>
      </div>
      {error.digest ? (
        <p className="text-muted-foreground text-xs">Código para soporte: {error.digest}</p>
      ) : null}
    </div>
  );
}
