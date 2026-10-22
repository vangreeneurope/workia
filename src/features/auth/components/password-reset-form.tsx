"use client";

import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useActionState } from "react";

import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { networkSafe } from "@/lib/network";

import { requestPasswordReset } from "../actions";
import { initialFormState } from "../schemas";

export function PasswordResetForm() {
  const [state, formAction, pending] = useActionState(
    networkSafe(requestPasswordReset),
    initialFormState,
  );

  if (state.status === "success") {
    return (
      <Alert>
        <CheckCircle2 />
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="grid gap-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <FormField
        name="email"
        label="Correo electrónico"
        type="email"
        autoComplete="username"
        inputMode="email"
        required
        errors={state.fieldErrors?.email}
      />
      <Button type="submit" variant="outline" disabled={pending} className="w-full">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Enviar enlace
      </Button>
    </form>
  );
}
