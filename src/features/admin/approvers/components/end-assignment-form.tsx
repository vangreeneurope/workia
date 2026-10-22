"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/admin/submit-button";
import { initialFormState } from "@/lib/forms";
import { networkSafe } from "@/lib/network";

import { endAssignment } from "../actions";

/** Finalizar una asignación en una fecha (último día incluido). */
export function EndAssignmentForm({
  id,
  today,
  label,
}: {
  id: string;
  today: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(networkSafe(endAssignment), initialFormState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`end-${id}`}>
        Último día de {label}
      </label>
      <input
        id={`end-${id}`}
        type="date"
        name="end_date"
        defaultValue={today}
        className="border-input h-11 rounded-md border bg-transparent px-2 text-base lg:h-9 lg:text-sm"
      />
      <SubmitButton pending={pending} variant="outline">
        Finalizar
      </SubmitButton>
      {state.status === "error" ? (
        <span role="alert" className="text-destructive w-full text-xs">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
