"use client";

import { useRef, useState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";

import { decideCorrection, requestCorrection, resolveIncident, setMyPin } from "../actions";
import {
  CORRECTION_ACTION_LABELS,
  CORRECTION_ACTIONS,
  correctionRequestSchema,
  decisionSchema,
  incidentResolutionSchema,
  pinSchema,
} from "../schemas";
import { PUNCH_KINDS, PUNCH_LABELS } from "../state-machine";

type PunchOption = { id: string; label: string; localValue: string };

/** Solicitud de corrección de una jornada (o de una jornada olvidada si no hay entryId). */
export function CorrectionRequestForm({
  employeeId,
  entryId,
  punches,
  defaultLocal,
}: {
  employeeId: string;
  entryId: string | null;
  punches: PunchOption[];
  defaultLocal: string;
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    correctionRequestSchema,
    requestCorrection,
  );
  const actions = entryId ? CORRECTION_ACTIONS : (["add"] as const);
  const [action, setAction] = useState<(typeof CORRECTION_ACTIONS)[number]>("add");
  const [punchId, setPunchId] = useState(punches[0]?.id ?? "");
  const selected = punches.find((p) => p.id === punchId);
  const idPrefix = entryId ?? "nueva";

  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="employee_id" value={employeeId} />
      {entryId ? <input type="hidden" name="entry_id" value={entryId} /> : null}
      <SelectField
        id={`action-${idPrefix}`}
        name="action"
        label="Qué hay que corregir"
        value={action}
        onChange={(e) => setAction(e.target.value as typeof action)}
        options={actions.map((a) => ({ value: a, label: CORRECTION_ACTION_LABELS[a] }))}
      />
      {action === "add" ? (
        <SelectField
          id={`kind-${idPrefix}`}
          name="kind"
          label="Fichaje que falta"
          defaultValue={entryId ? "end" : "start"}
          options={(entryId ? PUNCH_KINDS : (["start"] as const)).map((k) => ({
            value: k,
            label: PUNCH_LABELS[k],
          }))}
          errors={errors.kind}
        />
      ) : (
        <SelectField
          id={`punch-${idPrefix}`}
          name="punch_id"
          label="Fichaje"
          value={punchId}
          onChange={(e) => setPunchId(e.target.value)}
          options={punches.map((p) => ({ value: p.id, label: p.label }))}
          errors={errors.punch_id}
        />
      )}
      {action !== "void" ? (
        <FormField
          id={`proposed-${idPrefix}`}
          name="proposed_local"
          label="Fecha y hora correctas"
          type="datetime-local"
          defaultValue={action === "change" ? (selected?.localValue ?? defaultLocal) : defaultLocal}
          key={`${action}-${punchId}`}
          errors={errors.proposed_local}
        />
      ) : null}
      <FormField
        id={`reason-${idPrefix}`}
        name="reason"
        label="Motivo (sin datos de salud)"
        maxLength={500}
        errors={errors.reason}
      />
      <p className="text-muted-foreground text-xs">
        El fichaje original no se modifica: si se aprueba, se añade un ajuste con el valor anterior
        y el nuevo.
      </p>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Enviar solicitud
      </SubmitButton>
    </form>
  );
}

export function DecisionForm({ requestId }: { requestId: string }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    decisionSchema,
    decideCorrection,
  );
  // El botón pulsado fija la decisión antes de validar y enviar.
  const decision = useRef<HTMLInputElement>(null);
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-2" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="request_id" value={requestId} />
      <input ref={decision} type="hidden" name="decision" defaultValue="" />
      <FormField
        id={`note-${requestId}`}
        name="note"
        label="Nota (opcional)"
        maxLength={500}
        errors={errors.note}
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
            if (decision.current) decision.current.value = "reject";
          }}
        >
          Rechazar
        </SubmitButton>
      </div>
    </form>
  );
}

export function IncidentForm({ incidentId }: { incidentId: string }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    incidentResolutionSchema,
    resolveIncident,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-2" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="incident_id" value={incidentId} />
      <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
        <SelectField
          id={`status-${incidentId}`}
          name="status"
          label="Cierre"
          defaultValue="resolved"
          options={[
            { value: "resolved", label: "Resuelta" },
            { value: "dismissed", label: "Descartada (no procede)" },
          ]}
        />
        <FormField
          id={`inote-${incidentId}`}
          name="note"
          label="Nota"
          maxLength={500}
          errors={errors.note}
        />
      </div>
      <SubmitButton pending={pending} variant="outline" className="w-full sm:w-auto">
        Cerrar incidencia
      </SubmitButton>
    </form>
  );
}

export function PinForm() {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(pinSchema, setMyPin);
  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      className="grid gap-3"
      noValidate
      autoComplete="off"
    >
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          name="pin"
          label="Nuevo PIN (6 cifras)"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          errors={errors.pin}
        />
        <FormField
          name="pin_confirm"
          label="Repite el PIN"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={6}
          errors={errors.pin_confirm}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        Solo tú lo conoces: se guarda cifrado y nadie de la empresa puede verlo. Evita cifras
        repetidas o seguidas.
      </p>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Guardar PIN
      </SubmitButton>
    </form>
  );
}
