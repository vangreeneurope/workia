"use client";

import { FormMessage } from "@/components/admin/form-message";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";

import { memberInviteSchema } from "../../schemas";
import { inviteMember } from "../actions";

export function InviteForm() {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    memberInviteSchema,
    inviteMember,
  );
  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
      noValidate
    >
      <div className="md:col-span-3">
        <FormMessage state={state} />
      </div>
      <FormField
        name="email"
        label="Correo corporativo"
        type="email"
        autoComplete="off"
        errors={errors.email}
      />
      <FormField
        name="full_name"
        label="Nombre (opcional, solo para invitaciones)"
        errors={errors.full_name}
      />
      <SubmitButton pending={pending}>Añadir o invitar</SubmitButton>
    </form>
  );
}
