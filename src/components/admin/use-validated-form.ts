"use client";

import { useActionState, useState, type FormEvent } from "react";
import { z } from "zod";

import { initialFormState, type FormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

/**
 * Valida en el navegador con el mismo esquema zod que usa la Server Action y
 * solo envía si es válido. La Server Action vuelve a validar siempre.
 */
export function useValidatedForm<S extends z.ZodType>(schema: S, action: Action) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const [clientErrors, setClientErrors] = useState<FormState["fieldErrors"]>();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const data: Record<string, string> = {};
    for (const [key, value] of new FormData(event.currentTarget).entries()) {
      if (typeof value === "string") data[key] = value;
    }
    const result = schema.safeParse(data);
    if (result.success) {
      setClientErrors(undefined);
    } else {
      event.preventDefault();
      setClientErrors(z.flattenError(result.error).fieldErrors as FormState["fieldErrors"]);
    }
  }

  return {
    state,
    formAction,
    pending,
    onSubmit,
    errors: clientErrors ?? state.fieldErrors ?? {},
  };
}
