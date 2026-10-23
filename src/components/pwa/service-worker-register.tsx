"use client";

import { useEffect } from "react";

import { IS_DEMO } from "@/lib/demo";

import { listenForInstallPrompt } from "./install-store";

/**
 * Registra el service worker en producción. El SW no cachea datos personales
 * (ver public/sw.js y docs/DECISIONES.md, ADR-008).
 */
export function ServiceWorkerRegister() {
  useEffect(() => listenForInstallPrompt(), []);
  useEffect(() => {
    // La demostración estática (GitHub Pages) no instala el service worker.
    if (process.env.NODE_ENV !== "production" || IS_DEMO || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Sin SW la app sigue funcionando; solo se pierde la página sin conexión.
    });
  }, []);
  return null;
}
