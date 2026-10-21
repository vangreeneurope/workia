"use client";

import { useEffect } from "react";

/**
 * Registra el service worker en producción. El SW no cachea datos personales
 * (ver public/sw.js y docs/DECISIONES.md, ADR-008).
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Sin SW la app sigue funcionando; solo se pierde la página sin conexión.
    });
  }, []);
  return null;
}
