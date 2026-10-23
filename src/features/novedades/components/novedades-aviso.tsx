"use client";

import { Gift } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { safeCall } from "@/lib/network";

import { markNovedadesSeen } from "../actions";

/**
 * Aviso al entrar tras una actualización con novedades sin ver (ADR-068).
 * Al pulsar cualquiera de sus botones queda visto en el perfil (en todos los
 * dispositivos) hasta la siguiente actualización.
 */
export function NovedadesAviso({ version, titulos }: { version: string; titulos: string[] }) {
  const [open, setOpen] = useState(true);
  const [, startTransition] = useTransition();
  if (!open) return null;

  const markSeen = () => {
    setOpen(false);
    startTransition(async () => {
      await safeCall(() => markNovedadesSeen(version));
    });
  };

  return (
    <section
      aria-labelledby="novedades-aviso-titulo"
      className="bg-card text-card-foreground mb-6 grid gap-3 rounded-xl border p-4 shadow-xs"
    >
      <div className="flex items-start gap-3">
        <Gift className="text-brand mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="grid gap-1">
          {/* Sin encabezado: va antes del <h1> de cada página (orden de encabezados). */}
          <p id="novedades-aviso-titulo" className="font-semibold">
            Workia se ha actualizado a la versión {version}
          </p>
          <p className="text-muted-foreground text-sm">Esto es lo nuevo desde tu última visita:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {titulos.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 sm:pl-8">
        <Button asChild>
          <Link href="/novedades" onClick={markSeen}>
            Ver novedades
          </Link>
        </Button>
        <Button type="button" variant="outline" onClick={markSeen}>
          Entendido
        </Button>
      </div>
    </section>
  );
}
