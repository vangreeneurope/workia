"use client";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";
import type { FormState } from "@/lib/forms";

import {
  CONTRACT_TYPE_LABELS,
  CONTRACT_TYPES,
  termsChangeSchema,
  WORKING_TIME_LABELS,
  WORKING_TIMES,
} from "../../schemas";

export function TermsChangeForm({
  action,
  defaultDate,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaultDate: string;
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    termsChangeSchema,
    action,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <p className="text-muted-foreground text-sm">
        Las condiciones vigentes se cierran el día anterior a la fecha de efecto. Nada se borra.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          name="effective_date"
          label="Fecha de efecto"
          type="date"
          defaultValue={defaultDate}
          errors={errors.effective_date}
        />
        <SelectField
          name="contract_type"
          label="Tipo de contrato"
          options={CONTRACT_TYPES.map((c) => ({ value: c, label: CONTRACT_TYPE_LABELS[c] }))}
          placeholder="Elige"
          errors={errors.contract_type}
        />
        <SelectField
          name="working_time"
          label="Jornada"
          options={WORKING_TIMES.map((w) => ({ value: w, label: WORKING_TIME_LABELS[w] }))}
          defaultValue="full_time"
          errors={errors.working_time}
        />
        <FormField
          name="weekly_hours"
          label="Horas semanales"
          type="number"
          inputMode="decimal"
          step="0.25"
          min="0.25"
          max="40"
          errors={errors.weekly_hours}
        />
      </div>
      <FormField name="job_title" label="Puesto (opcional)" errors={errors.job_title} />
      <SubmitButton pending={pending} variant="outline" className="w-full sm:w-auto">
        Registrar condiciones
      </SubmitButton>
    </form>
  );
}
