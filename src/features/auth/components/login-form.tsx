"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useActionState } from "react";

import { FormField } from "@/components/form-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { networkSafe } from "@/lib/network";

import { signIn } from "../actions";
import { initialFormState } from "../schemas";

export function LoginForm({ siguiente }: { siguiente?: string }) {
  const [state, formAction, pending] = useActionState(networkSafe(signIn), initialFormState);

  return (
    <form action={formAction} className="grid gap-4" noValidate>
      {state.status === "error" && state.message ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <input type="hidden" name="siguiente" value={siguiente ?? ""} />
      <FormField
        name="email"
        label="Correo electrónico"
        type="email"
        autoComplete="username"
        inputMode="email"
        required
        errors={state.fieldErrors?.email}
      />
      <FormField
        name="password"
        label="Contraseña"
        type="password"
        autoComplete="current-password"
        required
        errors={state.fieldErrors?.password}
      />
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {pending ? "Accediendo…" : "Acceder"}
      </Button>
    </form>
  );
}
