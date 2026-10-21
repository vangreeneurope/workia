"use client";

import { useActionState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";
import { initialFormState, type FormState } from "@/lib/forms";

import { terminationSchema } from "../../schemas";

export function TerminationForm({
  action,
  defaultDate,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaultDate: string;
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    terminationSchema,
    action,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <FormField
        name="last_day"
        label="Último día de relación laboral"
        type="date"
        defaultValue={defaultDate}
        errors={errors.last_day}
      />
      <div className="bg-muted/40 rounded-lg p-3 text-sm">
        <p className="mb-1 font-medium">Desde el día siguiente:</p>
        <ul className="text-muted-foreground list-disc pl-5">
          <li>se cierran sus condiciones, roles y su cuenta en esta empresa;</li>
          <li>terminan sus asignaciones de manager, como supervisada y como aprobadora;</li>
          <li>no se admiten nuevas condiciones, asignaciones ni solicitudes.</li>
        </ul>
        <p className="text-muted-foreground mt-2">La ficha y todo su historial se conservan.</p>
      </div>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="confirm"
          className="mt-1 size-4"
          aria-describedby="confirm-error"
        />
        <span>He revisado las consecuencias y quiero registrar la baja.</span>
      </label>
      {errors.confirm ? (
        <p id="confirm-error" className="text-destructive text-sm">
          {errors.confirm.join(". ")}
        </p>
      ) : null}
      <SubmitButton pending={pending} variant="destructive" className="w-full sm:w-auto">
        Registrar baja
      </SubmitButton>
    </form>
  );
}

export function ReactivateForm({
  action,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="grid gap-3">
      <FormMessage state={state} />
      <SubmitButton pending={pending} variant="outline" className="w-full sm:w-auto">
        Reactivar a la persona
      </SubmitButton>
    </form>
  );
}
