"use client";

import { CheckCircle2, AlertCircle } from "lucide-react";
import { useActionState, useEffect, useEffectEvent, useRef, useState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SubmitButton } from "@/components/admin/submit-button";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { initialFormState } from "@/lib/forms";

import { activateKiosk, kioskPunchAction, type KioskResult } from "../actions";
import { formatClock } from "../format";
import { PUNCH_KINDS, PUNCH_LABELS, type PunchKind } from "../state-machine";

/** Segundos que se muestra el resultado y que se espera sin actividad antes de limpiar. */
const RESULT_SECONDS = 5;
const IDLE_SECONDS = 30;

export function KioskActivation({ notice }: { notice?: string }) {
  const [state, formAction, pending] = useActionState(activateKiosk, initialFormState);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Activar terminal de fichaje</h1>
      <p className="text-muted-foreground text-sm">
        {notice ??
          "RR. HH. obtiene el código al dar de alta el terminal en Administración › Control horario. Solo se usa una vez en este dispositivo."}
      </p>
      <form action={formAction} className="grid gap-3" autoComplete="off">
        <FormMessage state={state} />
        <FormField
          name="token"
          label="Código del terminal"
          autoComplete="off"
          spellCheck={false}
          errors={state.fieldErrors?.token}
        />
        <SubmitButton pending={pending} className="min-h-12">
          Activar
        </SubmitButton>
      </form>
      {state.status === "success" ? (
        <Button type="button" className="min-h-12" onClick={() => window.location.reload()}>
          Empezar a fichar
        </Button>
      ) : null}
    </div>
  );
}

const initialKiosk: KioskResult = { status: "idle" };

export function KioskScreen({
  deviceName,
  centerName,
}: {
  deviceName: string;
  centerName: string;
}) {
  const [kind, setKind] = useState<PunchKind | null>(null);
  // Clave de idempotencia del intento: se crea al elegir la acción (nunca al
  // renderizar) y se mantiene si el mismo envío se reintenta.
  const [attempt, setAttempt] = useState("");
  const [state, formAction, pending] = useActionState(kioskPunchAction, initialKiosk);
  const [dismissed, setDismissed] = useState<KioskResult | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = state.status !== "idle" && !state.fieldErrors && state !== dismissed ? state : null;

  // Nada de la persona anterior queda en pantalla: se vuelve al inicio y se
  // vacían los campos (el formulario se vuelve a montar con otra clave).
  function reset() {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    setKind(null);
    setDismissed(state);
    setAttempt("");
  }
  const onResultShown = useEffectEvent(() => reset());

  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => onResultShown(), RESULT_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [shown]);

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    [],
  );

  function touch() {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => reset(), IDLE_SECONDS * 1000);
  }

  function choose(k: PunchKind) {
    setAttempt(crypto.randomUUID());
    setKind(k);
    touch();
  }

  if (shown && shown.status !== "idle") {
    const ok = shown.status === "success";
    return (
      <div
        role="status"
        aria-live="assertive"
        className="grid justify-items-center gap-4 text-center"
      >
        {ok ? (
          <CheckCircle2 className="size-16 text-green-600" aria-hidden />
        ) : (
          <AlertCircle className="text-destructive size-16" aria-hidden />
        )}
        <h1 className="text-2xl font-semibold">
          {ok ? "Fichaje registrado" : "No se ha registrado"}
        </h1>
        <p className="text-lg">
          {shown.message}
          {ok && shown.serverAt && shown.timeZone
            ? ` Hora: ${formatClock(shown.serverAt, shown.timeZone)}.`
            : ""}
        </p>
        <Button type="button" variant="outline" className="min-h-12" onClick={() => reset()}>
          Volver
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <header className="grid gap-1 text-center">
        <h1 className="text-2xl font-semibold">Fichaje</h1>
        <p className="text-muted-foreground text-sm">
          {deviceName} · {centerName}
        </p>
      </header>

      {!kind ? (
        <div
          className="grid grid-cols-2 gap-3"
          role="group"
          aria-label="Elige qué quieres registrar"
        >
          {PUNCH_KINDS.map((k) => (
            <Button
              key={k}
              type="button"
              size="lg"
              className="min-h-20 text-lg"
              onClick={() => choose(k)}
            >
              {PUNCH_LABELS[k]}
            </Button>
          ))}
        </div>
      ) : (
        <form
          key={attempt}
          action={formAction}
          className="grid gap-4"
          autoComplete="off"
          onInput={touch}
        >
          <p className="text-center text-lg font-medium">{PUNCH_LABELS[kind]}</p>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="idempotency_key" value={attempt} />
          <input type="hidden" name="device_at" value={new Date().toISOString()} />
          <FormField
            name="employee_code"
            label="Código de empleado"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="h-12 text-lg"
            errors={state.fieldErrors?.employee_code}
          />
          <FormField
            name="pin"
            label="PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            className="h-12 text-lg tracking-widest"
            errors={state.fieldErrors?.pin}
          />
          <FormMessage state={state.fieldErrors ? state : initialFormState} />
          <div className="grid grid-cols-2 gap-3">
            <Button type="button" variant="outline" className="min-h-12" onClick={() => reset()}>
              Cancelar
            </Button>
            <SubmitButton pending={pending} className="min-h-12">
              Fichar
            </SubmitButton>
          </div>
        </form>
      )}
      <p className="text-muted-foreground text-center text-xs">
        La pantalla se limpia sola. No se guarda tu PIN ni se muestra ningún dato tuyo.
      </p>
    </div>
  );
}
