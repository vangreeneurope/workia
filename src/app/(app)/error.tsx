"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function PrivateError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-16 text-center">
      <AlertTriangle className="text-destructive size-10" aria-hidden />
      <h1 className="text-xl font-semibold">Algo ha fallado</h1>
      <p className="text-muted-foreground max-w-md">
        No hemos podido cargar esta sección. Si el problema continúa, avisa al equipo de soporte.
      </p>
      <Button onClick={reset}>Reintentar</Button>
    </div>
  );
}
