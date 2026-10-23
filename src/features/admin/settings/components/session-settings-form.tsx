"use client";

import { FormMessage } from "@/components/admin/form-message";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";
import { MAX_SESSION_MINUTES, MIN_SESSION_MINUTES } from "@/lib/auth/session-limit";

import { saveSessionSettings } from "../actions";
import { sessionSettingsSchema } from "../schemas";

export function SessionSettingsForm({ minutes }: { minutes: number }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    sessionSettingsSchema,
    saveSessionSettings,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <FormField
        name="session_max_minutes"
        label="Duración máxima de la sesión (minutos)"
        type="number"
        inputMode="numeric"
        min={MIN_SESSION_MINUTES}
        max={MAX_SESSION_MINUTES}
        step={1}
        defaultValue={minutes}
        required
        description={`Entre ${MIN_SESSION_MINUTES} y ${MAX_SESSION_MINUTES} minutos. Por defecto, 60.`}
        errors={errors.session_max_minutes}
      />
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Guardar
      </SubmitButton>
    </form>
  );
}
