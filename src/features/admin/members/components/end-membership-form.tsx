"use client";

import { FormMessage } from "@/components/admin/form-message";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";

import { membershipEndSchema } from "../../schemas";
import { endMembership } from "../actions";

export function EndMembershipForm({
  membershipId,
  today,
}: {
  membershipId: string;
  today: string;
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    membershipEndSchema,
    endMembership,
  );
  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
      noValidate
    >
      <div className="sm:col-span-2">
        <FormMessage state={state} />
      </div>
      <input type="hidden" name="membership_id" value={membershipId} />
      <FormField
        name="end_date"
        label="Último día con acceso"
        type="date"
        defaultValue={today}
        errors={errors.end_date}
      />
      <SubmitButton pending={pending} variant="destructive">
        Retirar acceso
      </SubmitButton>
    </form>
  );
}
