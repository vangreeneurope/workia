"use client";

import { Copy } from "lucide-react";
import { useActionState, useState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { initialFormState } from "@/lib/forms";
import { networkSafe } from "@/lib/network";

import { registerKiosk, resetPinForm, savePolicy, type KioskRegistration } from "../actions";
import { kioskDeviceSchema, LOCATION_MODE_LABELS, LOCATION_MODES, policySchema } from "../schemas";

type Option = { id: string; label: string };

export function PolicyForm({ centers }: { centers: Option[] }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    policySchema,
    savePolicy,
  );
  const [mode, setMode] = useState<(typeof LOCATION_MODES)[number]>("off");
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="work_center_id"
          label="Se aplica a"
          options={[
            { value: "", label: "Toda la empresa (por defecto)" },
            ...centers.map((c) => ({ value: c.id, label: c.label })),
          ]}
        />
        <SelectField
          name="location_mode"
          label="Ubicación al fichar"
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
          options={LOCATION_MODES.map((m) => ({ value: m, label: LOCATION_MODE_LABELS[m] }))}
          errors={errors.location_mode}
        />
      </div>
      {mode !== "off" ? (
        <div className="grid gap-2">
          <Label htmlFor="location_notice">
            Aviso previo a la plantilla (para qué se usa y quién la ve)
          </Label>
          <textarea
            id="location_notice"
            name="location_notice"
            rows={3}
            maxLength={1000}
            aria-invalid={errors.location_notice ? true : undefined}
            className="border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border bg-transparent p-3 text-base shadow-xs outline-none focus-visible:ring-[3px] md:text-sm"
          />
          {errors.location_notice ? (
            <p className="text-destructive text-sm">{errors.location_notice.join(". ")}</p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            Requisito del art. 90 LOPDGDD: informar antes. Se toma una lectura al fichar, nunca
            seguimiento continuo.
          </p>
        </div>
      ) : null}
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="selfie_enabled" className="size-4" />
        Permitir una selfie opcional como evidencia (sin reconocimiento facial; se conserva 30 días)
      </label>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Guardar política
      </SubmitButton>
    </form>
  );
}

export function KioskRegistrationForm({ centers }: { centers: Option[] }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    kioskDeviceSchema,
    registerKiosk,
  );
  const registration = state as KioskRegistration;
  const [copied, setCopied] = useState(false);
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      {registration.token ? (
        <div className="bg-muted grid gap-2 rounded-lg p-3">
          <p className="text-sm font-medium">Código del terminal (solo se muestra ahora)</p>
          <code className="text-xs break-all">{registration.token}</code>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={async () => {
              await navigator.clipboard.writeText(registration.token ?? "");
              setCopied(true);
            }}
          >
            <Copy aria-hidden /> {copied ? "Copiado" : "Copiar"}
          </Button>
          <p className="text-muted-foreground text-xs">
            Abre /terminal en el dispositivo y pega el código. Si se pierde, da de baja el terminal
            y crea otro.
          </p>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="work_center_id"
          label="Centro"
          placeholder="Elige un centro"
          options={centers.map((c) => ({ value: c.id, label: c.label }))}
          errors={errors.work_center_id}
        />
        <FormField
          name="name"
          label="Nombre del terminal"
          placeholder="Entrada principal"
          errors={errors.name}
        />
      </div>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Dar de alta terminal
      </SubmitButton>
    </form>
  );
}

export function PinResetForm({ employees }: { employees: Option[] }) {
  const [state, formAction, pending] = useActionState(networkSafe(resetPinForm), initialFormState);
  return (
    <form action={formAction} className="grid gap-3">
      <FormMessage state={state} />
      <SelectField
        name="employee_id"
        label="Persona"
        placeholder="Elige una persona"
        options={employees.map((e) => ({ value: e.id, label: e.label }))}
        errors={state.fieldErrors?.employee_id}
      />
      <SubmitButton pending={pending} variant="outline" className="w-full sm:w-auto">
        Anular su PIN
      </SubmitButton>
    </form>
  );
}
