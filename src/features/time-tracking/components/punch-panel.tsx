"use client";

import { Camera, CloudOff, Loader2, MapPin } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { punchAction, type PunchResult } from "../actions";
import { formatClock } from "../format";
import { readLocationOnce, type LocationReading } from "../geolocation";
import {
  enqueue,
  flushQueue,
  loadQueue,
  QUEUE_STORAGE_KEY,
  saveQueue,
  type PendingPunch,
  type QueueStorage,
  type SendResult,
} from "../offline-queue";
import {
  allowedPunches,
  ENTRY_STATE_LABELS,
  PUNCH_LABELS,
  transition,
  type CurrentState,
  type PunchKind,
} from "../state-machine";

const DEVICE_KEY = "dispositivo-id";

/** localStorage puede no existir (modo privado): se trata como cola vacía. */
const storage: QueueStorage = {
  get() {
    try {
      return window.localStorage.getItem(QUEUE_STORAGE_KEY);
    } catch {
      return null;
    }
  },
  set(value) {
    try {
      window.localStorage.setItem(QUEUE_STORAGE_KEY, value);
    } catch {
      // Sin almacenamiento local no hay cola: se avisa al fallar el envío.
    }
  },
};

/** Identificador aleatorio del dispositivo (seudónimo): no deriva de ningún dato del equipo. */
function deviceId(): string | undefined {
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

function toFormData(
  fields: Record<string, string | number | undefined>,
  selfie?: File | null,
): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) fd.set(key, String(value));
  }
  if (selfie) fd.set("selfie", selfie);
  return fd;
}

async function sendPending(p: PendingPunch): Promise<SendResult> {
  try {
    const result = await punchAction(
      toFormData({
        kind: p.kind,
        idempotency_key: p.key,
        source: p.source,
        device_at: p.deviceAt,
        device_id: deviceId(),
        location_status: "not_requested",
      }),
    );
    return result.status === "success"
      ? { type: "ok" }
      : { type: "rejected", message: result.message ?? "Rechazado" };
  } catch {
    return { type: "network" };
  }
}

export function PunchPanel({
  state,
  startedAt,
  timeZone,
  locationMode,
  locationNotice,
  selfieEnabled,
}: {
  state: CurrentState;
  startedAt: string | null;
  timeZone: string;
  locationMode: "off" | "optional" | "required";
  locationNotice: string | null;
  selfieEnabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<PunchResult | null>(null);
  const [queued, setQueued] = useState<PendingPunch[]>([]);
  const [noticeFor, setNoticeFor] = useState<PunchKind | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLButtonElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);

  // Teclado y lector de pantalla: el foco va al aviso de ubicación cuando se
  // abre y vuelve a las acciones tras fichar (el resultado se anuncia aparte).
  useEffect(() => {
    if (noticeFor) noticeRef.current?.focus();
  }, [noticeFor]);
  useEffect(() => {
    if (!pending && !noticeFor && returnFocus.current) {
      returnFocus.current = false;
      actionsRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    }
  }, [pending, noticeFor, result]);

  const flush = useCallback(async () => {
    const queue = loadQueue(storage);
    if (queue.length === 0 || !navigator.onLine) {
      setQueued(queue);
      return;
    }
    const outcome = await flushQueue(queue, sendPending);
    saveQueue(storage, outcome.remaining);
    setQueued(outcome.remaining);
    if (outcome.rejected.length > 0) {
      setResult({
        status: "error",
        message: `Un fichaje guardado sin conexión no se pudo registrar: ${outcome.rejected[0]?.message}. Solicita una corrección si hace falta.`,
      });
    } else if (outcome.sent.length > 0) {
      setResult({ status: "success", message: "Fichajes pendientes enviados." });
    }
  }, []);

  useEffect(() => {
    // Al abrir la pantalla y al recuperar la conexión se envían los pendientes.
    const first = setTimeout(() => void flush(), 0);
    window.addEventListener("online", flush);
    return () => {
      clearTimeout(first);
      window.removeEventListener("online", flush);
    };
  }, [flush]);

  async function punch(kind: PunchKind, location: LocationReading) {
    returnFocus.current = true;
    setPending(true);
    setResult(null);
    const key = crypto.randomUUID();
    const deviceAt = new Date().toISOString();
    const source = window.matchMedia("(pointer: coarse)").matches ? "mobile" : "web";
    try {
      const response = await punchAction(
        toFormData(
          {
            kind,
            idempotency_key: key,
            source,
            device_at: deviceAt,
            device_id: deviceId(),
            location_status: location.status,
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
          },
          selfie,
        ),
      );
      setResult(response);
      if (response.status === "success") {
        setSelfie(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch {
      // Sin conexión: se guarda con la misma clave para reintentarlo sin duplicar.
      const queue = enqueue(loadQueue(storage), { key, kind, deviceAt, source, attempts: 0 });
      saveQueue(storage, queue);
      setQueued(queue);
      setResult({
        status: "error",
        message: "Sin conexión. El fichaje se enviará al recuperarla (sin ubicación ni foto).",
      });
    } finally {
      setPending(false);
    }
  }

  async function start(kind: PunchKind) {
    if (pending) return; // doble toque
    if (locationMode === "off") return punch(kind, { status: "not_requested" });
    setNoticeFor(kind); // primero se explica para qué se usa la ubicación
  }

  async function continueWithLocation(share: boolean) {
    const kind = noticeFor;
    setNoticeFor(null);
    if (!kind) return;
    if (!share) return punch(kind, { status: "denied" });
    setPending(true);
    const reading = await readLocationOnce();
    setPending(false);
    await punch(kind, reading);
  }

  // Con fichajes pendientes de enviar, se muestran las acciones que vendrían después.
  const shownState = queued.reduce<CurrentState>((current, p) => {
    const next = transition(current, p.kind);
    return next === "open" || next === "on_break" ? next : null;
  }, state);
  const actions = allowedPunches(shownState);

  return (
    <div className="grid gap-4">
      <div className="bg-muted/50 rounded-xl p-4" aria-live="polite">
        <p className="text-muted-foreground text-sm">Estado</p>
        <p className="text-2xl font-semibold">
          {shownState ? ENTRY_STATE_LABELS[shownState] : "Sin jornada abierta"}
        </p>
        {state && startedAt ? (
          <p className="text-muted-foreground text-sm">
            Desde las {formatClock(startedAt, timeZone)} (hora del servidor)
          </p>
        ) : null}
      </div>

      {noticeFor ? (
        <Alert>
          <MapPin />
          <AlertTitle>Antes de compartir tu ubicación</AlertTitle>
          <AlertDescription className="grid gap-3">
            <p>{locationNotice}</p>
            <p>
              Se toma una sola lectura al fichar; nunca se sigue tu posición.
              {locationMode === "required"
                ? " Si no la compartes, el fichaje se registra igual y queda una incidencia para revisión."
                : " Es opcional: puedes fichar sin ella."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                ref={noticeRef}
                type="button"
                className="min-h-11"
                onClick={() => continueWithLocation(true)}
              >
                Compartir ubicación y fichar
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => continueWithLocation(false)}
              >
                Fichar sin ubicación
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : (
        <div ref={actionsRef} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {actions.map((kind) => (
            <Button
              key={kind}
              type="button"
              size="lg"
              variant={kind === "end" ? "outline" : "default"}
              className="min-h-16 text-lg"
              disabled={pending}
              onClick={() => start(kind)}
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {PUNCH_LABELS[kind]}
            </Button>
          ))}
        </div>
      )}

      {selfieEnabled ? (
        <div className="grid gap-2">
          <label htmlFor="selfie" className="flex items-center gap-2 text-sm font-medium">
            <Camera className="size-4" aria-hidden /> Selfie opcional como evidencia
          </label>
          <input
            ref={fileRef}
            id="selfie"
            type="file"
            accept="image/jpeg"
            capture="user"
            className="text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:px-3"
            onChange={(e) => setSelfie(e.target.files?.[0] ?? null)}
            aria-describedby="selfie-help"
          />
          <p id="selfie-help" className="text-muted-foreground text-xs">
            Solo JPEG hasta 2 MB. Se guarda en privado 30 días, sin metadatos y sin reconocimiento
            facial. Si la cámara no está disponible, ficha sin foto.
          </p>
        </div>
      ) : null}

      {result?.message ? (
        <Alert variant={result.status === "error" ? "destructive" : "default"} aria-live="polite">
          <AlertDescription>
            {result.message}
            {result.punch ? ` Hora oficial: ${formatClock(result.punch.serverAt, timeZone)}.` : ""}
          </AlertDescription>
        </Alert>
      ) : null}

      {queued.length > 0 ? (
        <p className="flex items-center gap-2 text-sm" role="status">
          <CloudOff className="size-4" aria-hidden /> {queued.length} fichaje(s) pendiente(s) de
          enviar.
        </p>
      ) : null}
    </div>
  );
}
