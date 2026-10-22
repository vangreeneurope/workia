"use client";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import {
  completeDataRequest,
  grantSupportAccess,
  placeLegalHold,
  releaseLegalHold,
  reviewDataRequest,
  revokeSupportAccess,
  submitDataRequest,
} from "../actions";
import {
  DATA_REQUEST_KINDS,
  DATA_REQUEST_LABELS,
  LEGAL_HOLD_CATEGORIES,
  LEGAL_HOLD_LABELS,
} from "../schemas";
import { useManualForm } from "./use-form";

type Option = { value: string; label: string };

function TextArea({
  id,
  name,
  label,
  errors,
  hint,
  maxLength,
}: {
  id: string;
  name: string;
  label: string;
  errors?: string[];
  hint?: string;
  maxLength: number;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        name={name}
        maxLength={maxLength}
        rows={3}
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-invalid={errors?.length ? true : undefined}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 rounded-md border bg-transparent px-3 py-2 text-base outline-none focus-visible:ring-[3px] md:text-sm"
      />
      {errors?.length ? <p className="text-destructive text-sm">{errors.join(". ")}</p> : null}
    </div>
  );
}

export function DataRequestForm() {
  const { state, pending, onSubmit, errors } = useManualForm(submitDataRequest, true);
  return (
    <form onSubmit={onSubmit} className="grid gap-3" noValidate>
      <FormMessage state={state} />
      <SelectField
        name="kind"
        id="dr-kind"
        label="Qué quieres solicitar"
        options={DATA_REQUEST_KINDS.map((k) => ({ value: k, label: DATA_REQUEST_LABELS[k] }))}
        errors={errors.kind}
      />
      <TextArea
        id="dr-details"
        name="details"
        label="Detalles (opcional)"
        hint="Por ejemplo, qué dato quieres rectificar. No incluyas datos de salud ni de otras personas."
        maxLength={1000}
        errors={errors.details}
      />
      <SubmitButton pending={pending} className="min-h-11 w-full sm:w-auto">
        Enviar solicitud
      </SubmitButton>
    </form>
  );
}

export function ReviewRequestForm({ requestId, erasure }: { requestId: string; erasure: boolean }) {
  const { state, pending, onSubmit, errors } = useManualForm(reviewDataRequest);
  return (
    <form onSubmit={onSubmit} className="grid gap-2" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="request_id" value={requestId} />
      <TextArea
        id={`note-${requestId}`}
        name="note"
        label="Decisión motivada"
        hint={
          erasure
            ? "Si hay obligaciones de conservación (fichajes 4 años, contabilidad…), solo cabe aprobar en parte."
            : "Indica cómo se ha verificado la identidad y qué se entrega o por qué se rechaza."
        }
        maxLength={1000}
        errors={errors.note}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name="status"
          value="in_review"
          variant="outline"
          disabled={pending}
          className="min-h-11"
        >
          Marcar en revisión
        </Button>
        <Button
          type="submit"
          name="status"
          value="approved"
          disabled={pending}
          className="min-h-11"
        >
          Aprobar
        </Button>
        <Button
          type="submit"
          name="status"
          value="partially_approved"
          variant="outline"
          disabled={pending}
          className="min-h-11"
        >
          Aprobar en parte
        </Button>
        <Button
          type="submit"
          name="status"
          value="rejected"
          variant="destructive"
          disabled={pending}
          className="min-h-11"
        >
          Rechazar
        </Button>
      </div>
    </form>
  );
}

export function CompleteRequestForm({ requestId }: { requestId: string }) {
  const { state, pending, onSubmit } = useManualForm(completeDataRequest);
  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="request_id" value={requestId} />
      <FormField
        id={`done-${requestId}`}
        name="note"
        label="Cómo se ha atendido (opcional)"
        maxLength={1000}
      />
      <SubmitButton pending={pending} variant="outline" className="min-h-11 w-full sm:w-auto">
        Marcar como completada
      </SubmitButton>
    </form>
  );
}

export function LegalHoldForm({ employees }: { employees: Option[] }) {
  const { state, pending, onSubmit, errors } = useManualForm(placeLegalHold);
  return (
    <form onSubmit={onSubmit} className="grid gap-3" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="category"
          id="lh-category"
          label="Datos retenidos"
          options={LEGAL_HOLD_CATEGORIES.map((c) => ({ value: c, label: LEGAL_HOLD_LABELS[c] }))}
          errors={errors.category}
        />
        <SelectField
          name="employee_id"
          id="lh-employee"
          label="Persona"
          options={[{ value: "", label: "Toda la empresa" }, ...employees]}
          errors={errors.employee_id}
        />
      </div>
      <FormField
        id="lh-reason"
        name="reason"
        label="Motivo (expediente, requerimiento…)"
        maxLength={500}
        required
        errors={errors.reason}
      />
      <SubmitButton pending={pending} className="min-h-11 w-full sm:w-auto">
        Activar retención legal
      </SubmitButton>
    </form>
  );
}

export function ReleaseHoldForm({ holdId }: { holdId: string }) {
  const { state, pending, onSubmit } = useManualForm(releaseLegalHold);
  return (
    <form onSubmit={onSubmit} className="grid gap-1">
      <input type="hidden" name="hold_id" value={holdId} />
      <SubmitButton pending={pending} variant="outline" className="min-h-11">
        Levantar
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function SupportGrantForm({ staff }: { staff: Option[] }) {
  const { state, pending, onSubmit, errors } = useManualForm(grantSupportAccess);
  return (
    <form onSubmit={onSubmit} className="grid gap-3" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="support_user_id"
          id="sg-user"
          label="Persona de soporte"
          options={staff}
          errors={errors.support_user_id}
        />
        <SelectField
          name="hours"
          id="sg-hours"
          label="Duración"
          defaultValue="4"
          options={[1, 2, 4, 8, 24].map((h) => ({
            value: String(h),
            label: `${h} ${h === 1 ? "hora" : "horas"}`,
          }))}
          errors={errors.hours}
        />
      </div>
      <FormField
        id="sg-reason"
        name="reason"
        label="Motivo (incidencia, ticket…)"
        maxLength={500}
        required
        errors={errors.reason}
      />
      <SubmitButton pending={pending} className="min-h-11 w-full sm:w-auto">
        Conceder acceso de solo lectura
      </SubmitButton>
    </form>
  );
}

export function RevokeSupportForm({ grantId }: { grantId: string }) {
  const { state, pending, onSubmit } = useManualForm(revokeSupportAccess);
  return (
    <form onSubmit={onSubmit} className="grid gap-1">
      <input type="hidden" name="grant_id" value={grantId} />
      <SubmitButton pending={pending} variant="outline" className="min-h-11">
        Revocar
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
