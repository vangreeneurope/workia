"use client";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";

import { createRule, saveMapping } from "../actions";
import { mappingSchema, ruleSchema } from "../schemas";

export function MappingForm({ categories }: { categories: { id: string; label: string }[] }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    mappingSchema,
    saveMapping,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="category_id"
          label="Categoría"
          placeholder="Cuenta por defecto (todas las categorías)"
          options={categories.map((c) => ({ value: c.id, label: c.label }))}
          errors={errors.category_id}
        />
        <FormField
          name="account_code"
          label="Cuenta de gasto"
          placeholder="629"
          errors={errors.account_code}
        />
        <FormField
          name="tax_account_code"
          label="Cuenta de impuestos (opcional)"
          errors={errors.tax_account_code}
        />
        <FormField
          name="counterpart_account_code"
          label="Cuenta de contrapartida (opcional)"
          errors={errors.counterpart_account_code}
        />
      </div>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Guardar cuenta
      </SubmitButton>
    </form>
  );
}

export function RuleForm({ categories }: { categories: { id: string; label: string }[] }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(ruleSchema, createRule);
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField name="name" label="Nombre" placeholder="Importes altos" errors={errors.name} />
        <FormField
          name="min_total"
          label="A partir de (total del informe)"
          inputMode="decimal"
          placeholder="500,00"
          errors={errors.min_total}
        />
        <FormField name="currency" label="Moneda" defaultValue="EUR" errors={errors.currency} />
        <SelectField
          name="category_id"
          label="Solo para la categoría (opcional)"
          placeholder="Cualquier categoría"
          options={categories.map((c) => ({ value: c.id, label: c.label }))}
          errors={errors.category_id}
        />
        <SelectField
          name="approver_role"
          label="Aprueba además"
          options={[
            { value: "company_admin", label: "Administración de la empresa" },
            { value: "accounting", label: "Contabilidad" },
          ]}
          errors={errors.approver_role}
        />
        <FormField
          name="step_order"
          label="Orden del paso (2 a 9)"
          inputMode="numeric"
          defaultValue="2"
          errors={errors.step_order}
        />
      </div>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Crear regla
      </SubmitButton>
    </form>
  );
}
