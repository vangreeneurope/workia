"use client";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";
import type { FormState } from "@/lib/forms";

import { companyCreateSchema, companySchema, TIME_ZONES } from "../../schemas";

type Defaults = {
  name?: string;
  legal_name?: string | null;
  tax_id?: string | null;
  primary_color?: string;
  timezone?: string;
};

export function CompanyForm({
  action,
  defaults = {},
  groups,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: Defaults;
  /** Solo en alta: grupos que administra. */
  groups?: { id: string; name: string }[];
}) {
  const creating = Boolean(groups);
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    creating ? companyCreateSchema : companySchema,
    action,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      {groups ? (
        <SelectField
          name="group_id"
          label="Grupo"
          options={groups.map((g) => ({ value: g.id, label: g.name }))}
          defaultValue={groups.length === 1 ? groups[0]?.id : undefined}
          placeholder={groups.length === 1 ? undefined : "Elige un grupo"}
          errors={errors.group_id}
        />
      ) : null}
      <FormField
        name="name"
        label="Nombre comercial"
        defaultValue={defaults.name}
        required
        errors={errors.name}
      />
      <FormField
        name="legal_name"
        label="Razón social (opcional)"
        defaultValue={defaults.legal_name ?? ""}
        errors={errors.legal_name}
      />
      <FormField
        name="tax_id"
        label="CIF (opcional)"
        defaultValue={defaults.tax_id ?? ""}
        autoComplete="off"
        errors={errors.tax_id}
      />
      {creating ? (
        <FormField
          name="slug"
          label="Identificador corto (ej. alfa-servicios)"
          autoCapitalize="none"
          errors={errors.slug}
        />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          name="primary_color"
          label="Color corporativo"
          type="color"
          defaultValue={defaults.primary_color ?? "#1f2937"}
          className="h-11 p-1"
          errors={errors.primary_color}
        />
        <SelectField
          name="timezone"
          label="Zona horaria"
          options={TIME_ZONES.map((tz) => ({ value: tz, label: tz }))}
          defaultValue={defaults.timezone ?? "Europe/Madrid"}
          errors={errors.timezone}
        />
      </div>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        {creating ? "Crear empresa" : "Guardar cambios"}
      </SubmitButton>
    </form>
  );
}
