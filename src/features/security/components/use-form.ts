"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";

import { initialFormState, type FormState } from "@/lib/forms";

type Action<S extends FormState> = (prev: S, fd: FormData) => Promise<S>;
type StateAction<S> = (prev: Awaited<S>, fd: FormData) => Promise<S>;

/**
 * Envío manual (el formulario no se vacía si hay error) con clave de
 * idempotencia opcional que se conserva en los reintentos y se renueva tras un
 * envío correcto.
 */
export function useManualForm<S extends FormState>(action: Action<S>, withKey = false) {
  const [state, formAction, pending] = useActionState<S, FormData>(
    action as StateAction<S>,
    initialFormState as Awaited<S>,
  );
  const [, startTransition] = useTransition();
  const key = useRef("");
  useEffect(() => {
    if (state.status === "success") key.current = "";
  }, [state]);
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) fd.set(submitter.name, submitter.value);
    if (withKey) {
      if (!key.current) key.current = crypto.randomUUID();
      fd.set("idempotency_key", key.current);
    }
    startTransition(() => formAction(fd));
  }
  return { state, pending, onSubmit, errors: state.fieldErrors ?? {} };
}
