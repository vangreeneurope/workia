"use client";

import { FormMessage } from "@/components/admin/form-message";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";

import { createCategory, savePolicy } from "../actions";
import { categorySchema, policySchema } from "../schemas";

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  );
}

export function CategoryForm() {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    categorySchema,
    createCategory,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField name="code" label="Código" placeholder="VIAJE" errors={errors.code} />
        <FormField name="name" label="Nombre" placeholder="Viajes" errors={errors.name} />
        <FormField
          name="max_amount"
          label="Importe a partir del cual hay que justificarlo (opcional)"
          inputMode="decimal"
          placeholder="150,00"
          errors={errors.max_amount}
        />
      </div>
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium">Reglas</legend>
        <div className="flex flex-wrap gap-x-4">
          <Check name="is_mileage" label="Es kilometraje (sin ticket, por km)" />
          <Check name="requires_client" label="Exige cliente" />
          <Check name="requires_project" label="Exige proyecto" />
          <Check name="requires_cost_center" label="Exige centro de coste" />
          <Check name="requires_notes" label="Exige nota" />
        </div>
      </fieldset>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Crear categoría
      </SubmitButton>
    </form>
  );
}

export type PolicyDefaults = {
  max_days_past: number;
  default_currency: string;
  allowed_currencies: string[];
  receipt_required: boolean;
  mileage_rate_milli: number | null;
  ocr_total_tolerance_cents: number;
  legal_reference: string | null;
};

export function PolicyForm({ defaults }: { defaults: PolicyDefaults }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    policySchema,
    savePolicy,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          name="max_days_past"
          label="Antigüedad máxima de un gasto (días)"
          inputMode="numeric"
          defaultValue={String(defaults.max_days_past)}
          errors={errors.max_days_past}
        />
        <FormField
          name="mileage_rate"
          label="Precio por km (vacío = sin kilometraje)"
          inputMode="decimal"
          placeholder="0,26"
          defaultValue={
            defaults.mileage_rate_milli === null
              ? ""
              : (defaults.mileage_rate_milli / 1000).toFixed(3).replace(".", ",")
          }
          errors={errors.mileage_rate}
        />
        <FormField
          name="default_currency"
          label="Moneda por defecto"
          defaultValue={defaults.default_currency}
          errors={errors.default_currency}
        />
        <FormField
          name="allowed_currencies"
          label="Monedas admitidas (separadas por comas)"
          defaultValue={defaults.allowed_currencies.join(", ")}
          errors={errors.allowed_currencies}
        />
        <FormField
          name="ocr_total_tolerance"
          label="Diferencia admitida entre el total leído y el confirmado"
          inputMode="decimal"
          defaultValue={(defaults.ocr_total_tolerance_cents / 100).toFixed(2).replace(".", ",")}
          errors={errors.ocr_total_tolerance}
        />
        <FormField
          name="legal_reference"
          label="Fuente de estas reglas (convenio, acuerdo, criterio de la asesoría)"
          defaultValue={defaults.legal_reference ?? ""}
          errors={errors.legal_reference}
        />
      </div>
      <Check
        name="receipt_required"
        label="Exigir ticket en todos los gastos (salvo kilometraje)"
        defaultChecked={defaults.receipt_required}
      />
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Guardar política
      </SubmitButton>
    </form>
  );
}
