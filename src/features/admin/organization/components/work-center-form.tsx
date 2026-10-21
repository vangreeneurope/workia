"use client";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";
import type { FormState } from "@/lib/forms";

import { TIME_ZONES, workCenterSchema } from "../../schemas";

type Defaults = Partial<{
  name: string;
  code: string;
  address_line: string | null;
  city: string | null;
  postal_code: string | null;
  province: string | null;
  timezone: string;
}>;

export function WorkCenterForm({
  action,
  defaults = {},
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: Defaults;
  submitLabel: string;
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    workCenterSchema,
    action,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <FormField
          name="name"
          label="Nombre"
          defaultValue={defaults.name}
          required
          errors={errors.name}
        />
        <FormField
          name="code"
          label="Código"
          defaultValue={defaults.code}
          autoCapitalize="characters"
          required
          errors={errors.code}
        />
      </div>
      <FormField
        name="address_line"
        label="Dirección (opcional)"
        defaultValue={defaults.address_line ?? ""}
        errors={errors.address_line}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField
          name="postal_code"
          label="Código postal"
          defaultValue={defaults.postal_code ?? ""}
          inputMode="numeric"
          errors={errors.postal_code}
        />
        <FormField
          name="city"
          label="Localidad"
          defaultValue={defaults.city ?? ""}
          errors={errors.city}
        />
        <FormField
          name="province"
          label="Provincia"
          defaultValue={defaults.province ?? ""}
          errors={errors.province}
        />
      </div>
      <SelectField
        name="timezone"
        label="Zona horaria"
        options={TIME_ZONES.map((tz) => ({ value: tz, label: tz }))}
        defaultValue={defaults.timezone ?? "Europe/Madrid"}
        errors={errors.timezone}
      />
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
