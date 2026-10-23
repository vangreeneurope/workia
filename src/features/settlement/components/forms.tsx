"use client";

import { Send } from "lucide-react";
import { useActionState, useRef, useState, useTransition } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { initialFormState, type FormState } from "@/lib/forms";
import { networkSafe } from "@/lib/network";

import {
  closePeriod,
  completeStep,
  createCorrectiveBatch,
  decideLine,
  submitReport,
} from "../actions";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/**
 * Formulario con envío manual: no se vacía si hay error (React restablece los
 * formularios con `action`), conserva la clave de idempotencia en los
 * reintentos y sabe qué botón se pulsó.
 */
function useManualForm(action: Action, withKey = false) {
  const [state, formAction, pending] = useActionState(networkSafe(action), initialFormState);
  const [, startTransition] = useTransition();
  const key = useRef("");
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) fd.set(submitter.name, submitter.value);
    if (withKey) {
      if (!key.current) key.current = crypto.randomUUID();
      fd.set("idempotency_key", key.current);
    }
    startTransition(() => formAction(fd));
  }
  return { state, pending, onSubmit, errors: state.fieldErrors ?? {} };
}

export function SubmitReportForm({ period, label }: { period: string; label: string }) {
  const { state, pending, onSubmit } = useManualForm(submitReport, true);
  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <FormMessage state={state} />
      <input type="hidden" name="period" value={period} />
      <SubmitButton pending={pending} className="min-h-11 w-full sm:w-auto">
        <Send aria-hidden /> Enviar informe de {label}
      </SubmitButton>
    </form>
  );
}

export function LineDecisionForm({ itemId }: { itemId: string }) {
  const { state, pending, onSubmit, errors } = useManualForm(decideLine);
  return (
    <form onSubmit={onSubmit} className="grid gap-2" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="item_id" value={itemId} />
      <FormField
        id={`comment-${itemId}`}
        name="comment"
        label="Comentario (obligatorio para rechazar o devolver)"
        maxLength={500}
        errors={errors.comment}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name="decision"
          value="approved"
          disabled={pending}
          className="min-h-11"
        >
          Aprobar
        </Button>
        <Button
          type="submit"
          name="decision"
          value="returned"
          variant="outline"
          disabled={pending}
          className="min-h-11"
        >
          Devolver para corregir
        </Button>
        <Button
          type="submit"
          name="decision"
          value="rejected"
          variant="outline"
          disabled={pending}
          className="min-h-11"
        >
          Rechazar
        </Button>
      </div>
    </form>
  );
}

export function CompleteStepForm({
  reportId,
  managerStep,
}: {
  reportId: string;
  managerStep: boolean;
}) {
  const { state, pending, onSubmit, errors } = useManualForm(completeStep);
  return (
    <form onSubmit={onSubmit} className="grid gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="report_id" value={reportId} />
      {managerStep ? (
        <>
          <p className="text-muted-foreground text-sm">
            Si has devuelto alguna línea, el informe vuelve a la persona; si no, queda aprobado o
            pasa al siguiente aprobador.
          </p>
          <SubmitButton pending={pending} className="min-h-11 w-full sm:w-auto">
            Terminar revisión
          </SubmitButton>
          <input type="hidden" name="action" value="approve" />
        </>
      ) : (
        <>
          <FormField
            name="comment"
            label="Comentario (obligatorio para devolver)"
            maxLength={500}
            errors={errors.comment}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              name="action"
              value="approve"
              disabled={pending}
              className="min-h-11"
            >
              Aprobar informe
            </Button>
            <Button
              type="submit"
              name="action"
              value="return"
              variant="outline"
              disabled={pending}
              className="min-h-11"
            >
              Devolver informe
            </Button>
          </div>
        </>
      )}
    </form>
  );
}

export function ClosePeriodForm({
  period,
  label,
  pending: pendingReports,
}: {
  period: string;
  label: string;
  pending: { id: string; label: string }[];
}) {
  const { state, pending, onSubmit, errors } = useManualForm(closePeriod, true);
  const [confirming, setConfirming] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        if (!confirming) {
          e.preventDefault();
          setConfirming(true);
          return;
        }
        onSubmit(e);
      }}
      className="grid gap-3"
      noValidate
    >
      <FormMessage state={state} />
      <input type="hidden" name="period" value={period} />
      {pendingReports.length > 0 ? (
        <fieldset className="grid gap-1 rounded-xl border border-amber-500 p-3">
          <legend className="px-1 text-sm font-medium">
            Informes pendientes: solo se cierra si los excluyes con un motivo
          </legend>
          {pendingReports.map((r) => (
            <label key={r.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="excluded" value={r.id} className="size-5" />
              Excluir {r.label}
            </label>
          ))}
          <FormField
            name="reason"
            label="Motivo de la exclusión (queda auditado)"
            maxLength={500}
            errors={errors.reason}
          />
        </fieldset>
      ) : null}
      {confirming ? (
        <p className="rounded-xl border p-3 text-sm" role="alert">
          El cierre de {label} es definitivo: los informes aprobados pasan a un lote numerado que no
          se puede modificar (los ajustes van en un lote corrector). Pulsa de nuevo para confirmar.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={pending} className="min-h-11 w-full sm:w-auto">
          {confirming ? `Confirmar el cierre de ${label}` : `Cerrar ${label}`}
        </SubmitButton>
        {confirming ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setConfirming(false)}
          >
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function CorrectiveBatchForm({
  batchId,
  employees,
  categories,
}: {
  batchId: string;
  employees: { id: string; label: string }[];
  categories: { id: string; label: string }[];
}) {
  const { state, pending, onSubmit, errors } = useManualForm(createCorrectiveBatch, true);
  return (
    <form onSubmit={onSubmit} className="grid gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="batch_id" value={batchId} />
      <FormField
        name="note"
        label="Motivo del lote corrector"
        maxLength={500}
        errors={errors.note}
      />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="include_late_reports" className="size-5" />
        Incluir los informes del periodo aprobados después del cierre
      </label>
      <fieldset className="grid gap-3 rounded-xl border p-3">
        <legend className="px-1 text-sm font-medium">Ajuste manual (opcional)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            name="employee_id"
            label="Persona"
            placeholder="Sin ajuste"
            options={employees.map((e) => ({ value: e.id, label: e.label }))}
            errors={errors.employee_id}
          />
          <SelectField
            name="category_id"
            label="Categoría"
            placeholder="Elige"
            options={categories.map((c) => ({ value: c.id, label: c.label }))}
            errors={errors.category_id}
          />
          <FormField
            name="amount"
            label="Importe (negativo con -)"
            inputMode="decimal"
            placeholder="-25,00"
            errors={errors.amount}
          />
          <FormField name="currency" label="Moneda" defaultValue="EUR" errors={errors.currency} />
        </div>
        <FormField name="reason" label="Motivo del ajuste" maxLength={300} errors={errors.reason} />
      </fieldset>
      <SubmitButton pending={pending} className="min-h-11 w-full sm:w-auto">
        Crear lote corrector
      </SubmitButton>
    </form>
  );
}
