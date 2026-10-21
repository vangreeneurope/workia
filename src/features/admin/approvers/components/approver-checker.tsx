"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useActionState } from "react";

import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";

import { APPROVAL_TYPE_LABELS, APPROVAL_TYPES } from "../../schemas";
import { checkApprover, type ApproverCheck } from "../actions";

export function ApproverChecker({ employees }: { employees: { id: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState<ApproverCheck, FormData>(checkApprover, {
    status: "idle",
  });
  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-[2fr_1fr_auto] md:items-end">
      <SelectField
        name="employee_id"
        label="Persona"
        options={employees.map((e) => ({ value: e.id, label: e.label }))}
        placeholder="Elige una persona"
        errors={state.fieldErrors?.employee_id}
      />
      <SelectField
        name="request_type"
        label="Tipo"
        options={APPROVAL_TYPES.map((t) => ({ value: t, label: APPROVAL_TYPE_LABELS[t] }))}
        defaultValue="absences"
      />
      <SubmitButton pending={pending} variant="outline">
        Comprobar
      </SubmitButton>
      <div aria-live="polite" className="md:col-span-3">
        {state.status === "success" ? (
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-green-600" aria-hidden />
            Aprobaría: <strong>{state.approverName}</strong>
            {state.viaSubstitution ? " (por suplencia)" : ""}
          </p>
        ) : null}
        {state.status === "error" ? (
          <p className="text-destructive flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
