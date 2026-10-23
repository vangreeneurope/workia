"use client";

import { CheckCircle2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { subscribeAnnouncer } from "@/lib/announcer";

/**
 * Avisos de éxito de la app (región viva moderada). Los formularios anuncian
 * aquí su resultado para que siga visible aunque el formulario desaparezca
 * (por ejemplo, una solicitud aprobada que sale de la bandeja). Los errores
 * se quedan junto al formulario, que sigue montado. Ver src/lib/announcer.ts.
 */

const VISIBLE_MS = 8000;

export function Announcer() {
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(null);

  useEffect(() => {
    return subscribeAnnouncer((message) => setNotice({ id: Date.now(), message }));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-6"
    >
      {notice ? (
        <div
          key={notice.id}
          className="bg-foreground text-background pointer-events-auto flex max-w-md items-center gap-3 rounded-xl py-1 pr-1 pl-4 text-sm shadow-lg"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          <p className="flex-1 py-2">{notice.message}</p>
          <button
            type="button"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg"
            aria-label="Cerrar aviso"
            onClick={() => setNotice(null)}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
