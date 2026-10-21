import { AlertCircle, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import type { FormState } from "@/lib/forms";

/** Resultado de un formulario. Nunca incluye datos personales en el texto. */
export function FormMessage({ state }: { state: FormState }) {
  return (
    <div aria-live="polite">
      {state.message ? (
        <Alert variant={state.status === "error" ? "destructive" : "default"}>
          {state.status === "error" ? <AlertCircle /> : <CheckCircle2 />}
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
