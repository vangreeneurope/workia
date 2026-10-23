"use client";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";
import { Label } from "@/components/ui/label";

import { APPROVAL_TYPE_LABELS, APPROVAL_TYPES, substitutionSchema } from "../../schemas";
import { createSubstitution } from "../actions";

export function SubstitutionForm({
  managers,
  today,
}: {
  managers: { id: string; label: string }[];
  today: string;
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    substitutionSchema,
    createSubstitution,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="absent_user_id"
          label="Aprobador ausente"
          options={managers.map((m) => ({ value: m.id, label: m.label }))}
          placeholder="Elige a quién sustituir"
          errors={errors.absent_user_id}
        />
        <FormField
          name="substitute_email"
          label="Correo de la persona suplente"
          type="email"
          autoComplete="off"
          errors={errors.substitute_email}
        />
        <SelectField
          name="request_type"
          label="Tipo de solicitud"
          options={APPROVAL_TYPES.map((t) => ({ value: t, label: APPROVAL_TYPE_LABELS[t] }))}
          defaultValue="all"
          errors={errors.request_type}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            name="valid_from"
            label="Desde"
            type="date"
            defaultValue={today}
            errors={errors.valid_from}
          />
          <FormField
            name="valid_to"
            label="Hasta (incluido)"
            type="date"
            errors={errors.valid_to}
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="reason">Motivo</Label>
        <textarea
          id="reason"
          name="reason"
          rows={2}
          maxLength={500}
          aria-describedby="reason-help"
          aria-invalid={errors.reason ? true : undefined}
          className="border-input dark:bg-input/30 aria-invalid:border-destructive focus-visible:border-ring focus-visible:ring-ring/50 rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-[3px] md:text-sm"
        />
        <p id="reason-help" className="text-muted-foreground text-xs">
          Ej.: «Vacaciones», «Viaje de trabajo». No incluyas datos de salud ni otros datos
          sensibles.
        </p>
        {errors.reason ? (
          <p className="text-destructive text-sm">{errors.reason.join(". ")}</p>
        ) : null}
      </div>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Registrar suplencia
      </SubmitButton>
    </form>
  );
}
