"use client";

import { Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { SESSION_EXPIRED_PATH, SESSION_WARNING_MS } from "@/lib/auth/session-limit";
import { BUSINESS_TIME_ZONE } from "@/lib/dates";

const CHECK_EVERY_MS = 5000;

const TIME = new Intl.DateTimeFormat("es-ES", {
  timeZone: BUSINESS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Cierre de la sesión a su hora límite (ADR-067): aviso 5 minutos antes y, al
 * llegar, salida al acceso, donde el proxy la cierra. Se comprueba al volver a
 * la pestaña (una pestaña abierta desde ayer se cierra en el acto) y cada pocos
 * segundos (los temporizadores se congelan con el equipo en reposo). La barrera
 * real es el servidor: aquí solo se avisa y se evita seguir en una pantalla muerta.
 */
export function SessionTimer({ deadline, serverNow }: { deadline: number; serverNow: number }) {
  const router = useRouter();
  // Hora límite en el reloj del navegador (corrige la diferencia con el servidor).
  const localDeadline = useRef<number | null>(null);
  const leaving = useRef(false);
  const [warning, setWarning] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [minutesLeft, setMinutesLeft] = useState(0);

  const check = useCallback(() => {
    if (localDeadline.current === null) return;
    const remaining = localDeadline.current - Date.now();
    if (remaining <= 0) {
      if (leaving.current) return;
      leaving.current = true;
      const back = `${window.location.pathname}${window.location.search}`;
      // La petición pasa por el proxy, que cierra la sesión y borra las cookies.
      router.replace(`${SESSION_EXPIRED_PATH}&siguiente=${encodeURIComponent(back)}`);
      return;
    }
    setMinutesLeft(Math.max(1, Math.ceil(remaining / 60000)));
    setWarning(remaining <= SESSION_WARNING_MS);
  }, [router]);

  useEffect(() => {
    localDeadline.current = Date.now() + (deadline - serverNow);
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
  }, [deadline, serverNow, check]);

  if (!warning || dismissed) return null;

  return (
    <div
      role="alert"
      className="pointer-events-none fixed inset-x-0 top-[calc(4.5rem+env(safe-area-inset-top))] z-50 flex justify-center px-4"
    >
      <div className="bg-card text-card-foreground pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-amber-300 p-4 text-sm shadow-lg dark:border-amber-700">
        <Clock className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
        <div className="grid flex-1 gap-2">
          <p className="font-medium">
            Tu sesión se cerrará a las {TIME.format(deadline)} (
            {minutesLeft === 1 ? "en 1 minuto" : `en ${minutesLeft} minutos`}).
          </p>
          <p className="text-muted-foreground">
            Por seguridad, la sesión dura un tiempo máximo desde que entras, aunque la estés usando.
            Termina o guarda lo que estés haciendo; lo que escribas se conserva en este dispositivo
            y podrás seguir al volver a entrar.
          </p>
          <div>
            <Button type="button" size="sm" onClick={() => setDismissed(true)}>
              Entendido
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
