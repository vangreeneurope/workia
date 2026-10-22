"use client";

import { Calculator, Paperclip } from "lucide-react";
import { useActionState, useRef, useState, useTransition } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { initialFormState, type FormState } from "@/lib/forms";
import { networkSafe, safeCall } from "@/lib/network";

import { quoteAbsence, submitAbsence, type QuoteResult } from "../actions";
import { formatAmount, UNIT_LABELS, type AbsenceUnit } from "../units";

export type TypeOption = {
  id: string;
  name: string;
  units: AbsenceUnit[];
  requiresAttachment: boolean;
  usesBalance: boolean;
  requiresApproval: boolean;
};

export function RequestForm({ types, today }: { types: TypeOption[]; today: string }) {
  const [formKey, setFormKey] = useState(0);
  // Clave de idempotencia en memoria (no en un campo oculto, que React
  // restablece al renderizar): se crea al enviar y se reutiliza en reintentos.
  const keyStore = useRef("");
  const [state, formAction, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await networkSafe(submitAbsence)(prev, fd);
    if (result.status === "success") {
      keyStore.current = "";
      setFormKey((k) => k + 1);
    }
    return result;
  }, initialFormState);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const type = types.find((t) => t.id === typeId);
  const [unit, setUnit] = useState<AbsenceUnit>(type?.units[0] ?? "day");
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoting, startQuote] = useTransition();
  const [, startSubmit] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function withKey(form: HTMLFormElement): FormData {
    if (!keyStore.current) keyStore.current = crypto.randomUUID();
    const fd = new FormData(form);
    fd.set("idempotency_key", keyStore.current);
    return fd;
  }

  function calculate() {
    if (!formRef.current) return;
    const fd = withKey(formRef.current);
    startQuote(async () => setQuote(await safeCall(() => quoteAbsence(fd))));
  }

  if (types.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Tu empresa aún no ha configurado tipos de ausencia.
      </p>
    );
  }

  return (
    <form
      key={formKey}
      ref={formRef}
      onSubmit={(event) => {
        // Envío manual (sin `action`): React no vacía el formulario tras enviarlo,
        // así un error no borra lo escrito y un reintento conserva la clave.
        event.preventDefault();
        const fd = withKey(event.currentTarget);
        startSubmit(() => formAction(fd));
      }}
      onChange={() => setQuote(null)}
      className="grid gap-4"
      noValidate
    >
      <FormMessage state={state} />
      <SelectField
        name="type_id"
        label="Tipo de ausencia"
        value={typeId}
        onChange={(e) => {
          const next = types.find((t) => t.id === e.target.value);
          setTypeId(e.target.value);
          setUnit(next?.units[0] ?? "day");
        }}
        options={types.map((t) => ({ value: t.id, label: t.name }))}
        errors={state.fieldErrors?.type_id}
      />
      {type && type.units.length > 1 ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Cómo la pides</legend>
          <div className="flex flex-wrap gap-4">
            {type.units.map((u) => (
              <label key={u} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="unit"
                  value={u}
                  checked={unit === u}
                  onChange={() => setUnit(u)}
                  className="size-4"
                />
                {UNIT_LABELS[u]}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="unit" value={unit} />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          name="start_date"
          label={unit === "day" ? "Desde" : "Día"}
          type="date"
          defaultValue={today}
          errors={state.fieldErrors?.start_date}
        />
        {unit === "day" ? (
          <FormField
            name="end_date"
            label="Hasta (incluido)"
            type="date"
            defaultValue={today}
            errors={state.fieldErrors?.end_date}
          />
        ) : null}
        {unit === "half_day" ? (
          <SelectField
            name="half"
            label="Parte del día"
            defaultValue="morning"
            options={[
              { value: "morning", label: "Mañana" },
              { value: "afternoon", label: "Tarde" },
            ]}
            errors={state.fieldErrors?.half}
          />
        ) : null}
        {unit === "hour" ? (
          <div className="grid grid-cols-2 gap-4">
            <FormField
              name="start_time"
              label="Desde"
              type="time"
              defaultValue="09:00"
              errors={state.fieldErrors?.start_time}
            />
            <FormField
              name="end_time"
              label="Hasta"
              type="time"
              defaultValue="11:00"
              errors={state.fieldErrors?.end_time}
            />
          </div>
        ) : null}
      </div>

      <FormField
        name="note"
        label="Comentario para quien aprueba (opcional)"
        maxLength={500}
        aria-describedby="note-help"
        errors={state.fieldErrors?.note}
      />
      <p id="note-help" className="text-muted-foreground -mt-2 text-xs">
        No incluyas diagnósticos ni datos de salud: si hace falta, adjunta el justificante.
      </p>

      {type?.requiresAttachment ? (
        <div className="grid gap-2">
          <Label htmlFor="attachment" className="flex items-center gap-2">
            <Paperclip className="size-4" aria-hidden /> Justificante (PDF, JPEG o PNG, hasta 5 MB)
          </Label>
          <input
            id="attachment"
            name="attachment"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="text-sm file:mr-3 file:min-h-11 file:rounded-md file:border file:px-3"
          />
          <p className="text-muted-foreground text-xs">
            Se guarda en privado. Tu manager solo ve que lo has aportado; lo abre RR. HH. con
            permiso específico.
          </p>
        </div>
      ) : null}

      <div aria-live="polite" className="text-sm">
        {quote?.status === "success" && quote.unit ? (
          <div className="bg-muted/50 grid gap-1 rounded-lg p-3">
            <p>
              Se descontará: <strong>{formatAmount(quote.amount ?? 0, quote.unit)}</strong>
              {type?.usesBalance && quote.available !== null && quote.available !== undefined
                ? ` · disponible ahora: ${formatAmount(quote.available, quote.unit)}`
                : ""}
            </p>
            {quote.warnings?.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        ) : null}
        {quote?.status === "error" ? <p className="text-destructive">{quote.message}</p> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={calculate}
          disabled={quoting}
        >
          <Calculator aria-hidden /> Calcular días y saldo
        </Button>
        <SubmitButton pending={pending} className="min-h-11">
          {type?.requiresApproval === false ? "Registrar ausencia" : "Enviar solicitud"}
        </SubmitButton>
      </div>
    </form>
  );
}
