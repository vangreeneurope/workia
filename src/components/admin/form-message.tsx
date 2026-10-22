"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { hasAnnouncer } from "@/lib/announcer";
import type { FormState } from "@/lib/forms";

/** Lleva el foco al campo con error (por `name`, dentro del mismo formulario). */
function focusField(from: HTMLElement, name: string) {
  const scope = from.closest("form") ?? document;
  const field = scope.querySelector<HTMLElement>(`[name="${CSS.escape(name)}"]`);
  field?.focus();
}

/**
 * Resultado de un formulario. Nunca incluye datos personales en el texto.
 * Con errores de campo muestra un resumen que recibe el foco tras el envío y
 * enlaza cada error con su campo (el error también aparece junto al campo).
 */
export function FormMessage({ state }: { state: FormState }) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const fieldErrors = Object.entries(state.fieldErrors ?? {}).filter(
    (entry): entry is [string, string[]] => Boolean(entry[1]?.length),
  );
  const hasSummary = state.status === "error" && fieldErrors.length > 0;
  // Los éxitos los anuncia `networkSafe` en el avisador global (siguen visibles
  // si el formulario se desmonta); sin avisador (terminal, páginas públicas) se
  // muestran aquí.
  const toAnnouncer = state.status === "success" && Boolean(state.message) && hasAnnouncer();

  const isError = state.status === "error" && Boolean(state.message || hasSummary);
  useEffect(() => {
    // Tras un envío con error, el foco va al mensaje (o al resumen de campos).
    if (isError) summaryRef.current?.focus();
  }, [state, isError]);

  return (
    <div aria-live="polite">
      {hasSummary ? (
        <div ref={summaryRef} tabIndex={-1} className="rounded-xl outline-none">
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>
              {fieldErrors.length === 1 ? "Revisa 1 campo" : `Revisa ${fieldErrors.length} campos`}
            </AlertTitle>
            <AlertDescription>
              {state.message ? <p>{state.message}</p> : null}
              <ul className="grid gap-1">
                {fieldErrors.map(([name, errors]) => (
                  <li key={name}>
                    <a
                      href={`#${name}`}
                      className="inline-flex min-h-11 items-center underline underline-offset-4 lg:min-h-0"
                      onClick={(event) => {
                        event.preventDefault();
                        focusField(event.currentTarget, name);
                      }}
                    >
                      {errors.join(". ")}
                    </a>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        </div>
      ) : state.message && !toAnnouncer ? (
        <div ref={summaryRef} tabIndex={-1} className="rounded-xl outline-none">
          <Alert variant={state.status === "error" ? "destructive" : "default"}>
            {state.status === "error" ? <AlertCircle /> : <CheckCircle2 />}
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        </div>
      ) : null}
    </div>
  );
}
