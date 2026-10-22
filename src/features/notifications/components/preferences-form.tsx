"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SubmitButton } from "@/components/admin/submit-button";
import { initialFormState } from "@/lib/forms";

import { savePreferences } from "../actions";

export function PreferencesForm({
  options,
}: {
  options: { event: string; label: string; enabled: boolean }[];
}) {
  const [state, formAction, pending] = useActionState(savePreferences, initialFormState);
  return (
    <form action={formAction} className="grid gap-3">
      <FormMessage state={state} />
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium">Recibir también por correo</legend>
        {options.map((o) => (
          <label key={o.event} className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name={`email_${o.event}`}
              defaultChecked={o.enabled}
              className="size-5"
            />
            {o.label}
          </label>
        ))}
      </fieldset>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Guardar preferencias
      </SubmitButton>
    </form>
  );
}
