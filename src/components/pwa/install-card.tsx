"use client";

import { Download, Share } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { installMode, promptInstall, subscribeInstall } from "./install-store";

/** Instalación de la aplicación en el dispositivo (sin banners automáticos). */
export function InstallCard() {
  const mode = useSyncExternalStore(subscribeInstall, installMode, () => "unknown" as const);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Instalar la aplicación</CardTitle>
        <CardDescription>
          Ábrela desde la pantalla de inicio como una app. Sigue necesitando conexión: sin red solo
          muestra un aviso, y los fichajes hechos sin conexión se envían al volver.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {mode === "installed" ? <p>Ya estás usando la aplicación instalada.</p> : null}
        {mode === "prompt" ? (
          <div>
            <Button
              type="button"
              onClick={async () => {
                const accepted = await promptInstall();
                setMessage(accepted ? "Aplicación instalada." : "Instalación cancelada.");
              }}
            >
              <Download aria-hidden /> Instalar en este dispositivo
            </Button>
          </div>
        ) : null}
        {mode === "ios" ? (
          <p>
            En Safari, pulsa <Share className="inline size-4" aria-label="Compartir" /> y después
            «Añadir a pantalla de inicio».
          </p>
        ) : null}
        {mode === "manual" || mode === "unknown" ? (
          <p>
            Usa la opción «Instalar aplicación» o «Añadir a pantalla de inicio» del menú de tu
            navegador.
          </p>
        ) : null}
        <p role="status">{message}</p>
      </CardContent>
    </Card>
  );
}
