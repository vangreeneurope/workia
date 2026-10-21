"use client";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";
import type { FormState } from "@/lib/forms";

import { teamSchema } from "../../schemas";

export function TeamForm({
  action,
  defaults = {},
  workCenters,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: { name?: string; work_center_id?: string | null };
  workCenters: { id: string; name: string }[];
  submitLabel: string;
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(teamSchema, action);
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <FormField
        name="name"
        label="Nombre del equipo"
        defaultValue={defaults.name}
        required
        errors={errors.name}
      />
      <SelectField
        name="work_center_id"
        label="Centro (opcional)"
        options={workCenters.map((w) => ({ value: w.id, label: w.name }))}
        placeholder="Sin centro"
        defaultValue={defaults.work_center_id ?? ""}
        errors={errors.work_center_id}
      />
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
