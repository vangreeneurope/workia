"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useActionState } from "react";

import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { networkSafe } from "@/lib/network";

import { updatePassword } from "../actions";
import { initialFormState } from "../schemas";

export function NewPasswordForm() {
  const [state, formAction, pending] = useActionState(
    networkSafe(updatePassword),
    initialFormState,
  );

  return (
    <form action={formAction} className="grid gap-4" noValidate>
      {state.message ? (
        <Alert variant={state.status === "error" ? "destructive" : "default"}>
          {state.status === "error" ? <AlertCircle /> : <CheckCircle2 />}
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <FormField
        name="password"
        label="Nueva contraseña"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.password}
      />
      <FormField
        name="confirmacion"
        label="Repite la contraseña"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirmacion}
      />
      <p className="text-muted-foreground text-sm">
        Mínimo 12 caracteres, con mayúsculas, minúsculas y números.
      </p>
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Guardar contraseña
      </Button>
    </form>
  );
}
