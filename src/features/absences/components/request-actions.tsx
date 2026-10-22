"use client";

import { useActionState, useRef } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";
import { Label } from "@/components/ui/label";
import { initialFormState } from "@/lib/forms";

import { attachToRequest, decideAbsence, respondInfo } from "../actions";
import { decisionSchema, infoResponseSchema } from "../schemas";

export function InfoResponseForm({ requestId }: { requestId: string }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    infoResponseSchema,
    respondInfo,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-2" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="request_id" value={requestId} />
      <FormField
        id={`resp-${requestId}`}
        name="message"
        label="Tu respuesta"
        maxLength={500}
        errors={errors.message}
      />
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Responder
      </SubmitButton>
    </form>
  );
}

export function AttachForm({ requestId }: { requestId: string }) {
  const [state, formAction, pending] = useActionState(attachToRequest, initialFormState);
  return (
    <form action={formAction} className="grid gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="request_id" value={requestId} />
      <Label htmlFor={`att-${requestId}`}>Añadir justificante</Label>
      <input
        id={`att-${requestId}`}
        name="attachment"
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:px-3"
      />
      <SubmitButton pending={pending} variant="outline" className="w-full sm:w-auto">
        Subir
      </SubmitButton>
    </form>
  );
}

export function AbsenceDecisionForm({ requestId }: { requestId: string }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    decisionSchema,
    decideAbsence,
  );
  const decision = useRef<HTMLInputElement>(null);
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-2" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="request_id" value={requestId} />
      <input ref={decision} type="hidden" name="decision" defaultValue="" />
      <FormField
        id={`msg-${requestId}`}
        name="message"
        label="Mensaje (obligatorio para rechazar o pedir información)"
        maxLength={500}
        errors={errors.message}
      />
      <div className="flex flex-wrap gap-2">
        <SubmitButton
          pending={pending}
          onClick={() => {
            if (decision.current) decision.current.value = "approve";
          }}
        >
          Aprobar
        </SubmitButton>
        <SubmitButton
          pending={pending}
          variant="outline"
          onClick={() => {
            if (decision.current) decision.current.value = "request_info";
          }}
        >
          Pedir información
        </SubmitButton>
        <SubmitButton
          pending={pending}
          variant="outline"
          onClick={() => {
            if (decision.current) decision.current.value = "reject";
          }}
        >
          Rechazar
        </SubmitButton>
      </div>
    </form>
  );
}
