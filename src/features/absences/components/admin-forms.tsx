"use client";

import { useActionState, useState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";
import { initialFormState } from "@/lib/forms";
import { networkSafe } from "@/lib/network";

import {
  adjustBalance,
  createAssignment,
  createPolicy,
  createType,
  endAssignment,
  publishVersion,
  saveVersionDraft,
} from "../actions";
import {
  adjustmentSchema,
  assignmentSchema,
  policySchema,
  publishSchema,
  typeSchema,
  versionSchema,
} from "../schemas";

type Option = { id: string; label: string };

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4" />
      {label}
    </label>
  );
}

export function TypeForm() {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(typeSchema, createType);
  const [approval, setApproval] = useState(true);
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <FormField name="code" label="Código" placeholder="VAC" errors={errors.code} />
        <FormField
          name="name"
          label="Nombre (visible para quien aprueba)"
          placeholder="Vacaciones"
          errors={errors.name}
        />
      </div>
      <fieldset className="grid gap-1">
        <legend className="mb-1 text-sm font-medium">Se puede pedir por</legend>
        <div className="flex flex-wrap gap-x-4">
          <Check name="unit_day" label="Días" defaultChecked />
          <Check name="unit_half_day" label="Medios días" />
          <Check name="unit_hour" label="Horas" />
        </div>
        {errors.unit_day ? (
          <p className="text-destructive text-sm">{errors.unit_day.join(". ")}</p>
        ) : null}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="count_basis"
          label="Cómputo de días"
          defaultValue="working_days"
          options={[
            { value: "working_days", label: "Laborables (según turno y festivos)" },
            { value: "calendar_days", label: "Naturales" },
          ]}
        />
        <FormField
          name="max_past_days"
          label="Días hacia atrás admitidos"
          type="number"
          inputMode="numeric"
          min={0}
          max={90}
          defaultValue={0}
          errors={errors.max_past_days}
        />
      </div>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Check name="uses_balance" label="Consume saldo (necesita política)" />
        <Check name="requires_attachment" label="Pide justificante" />
        <Check
          name="attachment_sensitive"
          label="Justificante sensible (el manager no lo abre)"
          defaultChecked
        />
        <Check name="is_private" label="Tipo reservado (en calendarios y avisos: «Ausencia»)" />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="requires_approval"
          checked={approval}
          onChange={(e) => setApproval(e.target.checked)}
          className="size-4"
        />
        Requiere aprobación del manager
      </label>
      {!approval ? (
        <FormField
          name="approval_exemption_ref"
          label="Regla aprobada que exime de aprobación (acuerdo, convenio…)"
          errors={errors.approval_exemption_ref}
        />
      ) : null}
      <FormField
        name="legal_reference"
        label="Fuente que lo regula (opcional: artículo, convenio, acuerdo)"
        errors={errors.legal_reference}
      />
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Crear tipo
      </SubmitButton>
    </form>
  );
}

export function PolicyForm({ types }: { types: Option[] }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    policySchema,
    createPolicy,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="absence_type_id"
          label="Tipo de ausencia"
          placeholder="Elige un tipo con saldo"
          options={types.map((t) => ({ value: t.id, label: t.label }))}
          errors={errors.absence_type_id}
        />
        <SelectField
          name="period_start_month"
          label="Empieza el periodo en"
          defaultValue="1"
          options={[
            "enero",
            "febrero",
            "marzo",
            "abril",
            "mayo",
            "junio",
            "julio",
            "agosto",
            "septiembre",
            "octubre",
            "noviembre",
            "diciembre",
          ].map((m, i) => ({ value: String(i + 1), label: m }))}
        />
        <FormField name="code" label="Código" placeholder="VAC-GEN" errors={errors.code} />
        <FormField
          name="name"
          label="Nombre"
          placeholder="Vacaciones general"
          errors={errors.name}
        />
      </div>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Crear política
      </SubmitButton>
    </form>
  );
}

export type VersionDefaults = {
  unit: "half_days" | "minutes";
  entitlement: string;
  accrual_method: "upfront" | "monthly";
  proration: "none" | "by_employment";
  rounding_mode: "down" | "up" | "nearest";
  rounding_step: string;
  carryover_max: string;
  carryover_expiry_months: string;
  allow_negative: boolean;
  negative_limit: string;
  negative_reason: string;
};

export function VersionForm({
  policyId,
  defaults,
}: {
  policyId: string;
  defaults: VersionDefaults;
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    versionSchema,
    saveVersionDraft,
  );
  const [unit, setUnit] = useState(defaults.unit);
  const [negative, setNegative] = useState(defaults.allow_negative);
  const hint = unit === "half_days" ? "en días (admite ,5)" : "en horas HH:MM";
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="policy_id" value={policyId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="unit"
          label="Unidad del saldo"
          value={unit}
          onChange={(e) => setUnit(e.target.value as typeof unit)}
          options={[
            { value: "half_days", label: "Días (y medios días)" },
            { value: "minutes", label: "Horas" },
          ]}
        />
        <FormField
          name="entitlement"
          label={`Derecho por periodo completo, ${hint}`}
          defaultValue={defaults.entitlement}
          errors={errors.entitlement}
        />
        <SelectField
          name="accrual_method"
          label="Devengo"
          defaultValue={defaults.accrual_method}
          options={[
            { value: "upfront", label: "Todo al inicio del periodo" },
            { value: "monthly", label: "Mensual (al terminar cada mes)" },
          ]}
        />
        <SelectField
          name="proration"
          label="Prorrateo"
          defaultValue={defaults.proration}
          options={[
            { value: "by_employment", label: "Según días con contrato en el periodo" },
            { value: "none", label: "Sin prorrateo" },
          ]}
        />
        <SelectField
          name="rounding_mode"
          label="Redondeo"
          defaultValue={defaults.rounding_mode}
          options={[
            { value: "nearest", label: "Al más cercano" },
            { value: "up", label: "Hacia arriba" },
            { value: "down", label: "Hacia abajo" },
          ]}
        />
        <FormField
          name="rounding_step"
          label={`Redondear a múltiplos de, ${hint}`}
          defaultValue={defaults.rounding_step}
          errors={errors.rounding_step}
        />
        <FormField
          name="carryover_max"
          label={`Máximo que pasa al periodo siguiente, ${hint}`}
          defaultValue={defaults.carryover_max}
          errors={errors.carryover_max}
        />
        <FormField
          name="carryover_expiry_months"
          label="Lo arrastrado caduca a los (meses, vacío = no caduca)"
          type="number"
          inputMode="numeric"
          min={1}
          max={24}
          defaultValue={defaults.carryover_expiry_months}
          errors={errors.carryover_expiry_months}
        />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="allow_negative"
          checked={negative}
          onChange={(e) => setNegative(e.target.checked)}
          className="size-4"
        />
        Permitir saldo negativo (anticipo)
      </label>
      {negative ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            name="negative_limit"
            label={`Límite del negativo, ${hint}`}
            defaultValue={defaults.negative_limit}
            errors={errors.negative_limit}
          />
          <FormField
            name="negative_reason"
            label="Quién lo autoriza y por qué"
            defaultValue={defaults.negative_reason}
            errors={errors.negative_reason}
          />
        </div>
      ) : null}
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Guardar borrador
      </SubmitButton>
    </form>
  );
}

export function PublishVersionForm({ versionId, today }: { versionId: string; today: string }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    publishSchema,
    publishVersion,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-3" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="version_id" value={versionId} />
      <FormField
        name="valid_from"
        label="Con efecto desde"
        type="date"
        min={today}
        defaultValue={today}
        errors={errors.valid_from}
      />
      <p className="text-muted-foreground text-xs">
        Los periodos ya abiertos conservan las reglas con las que se abrieron; la nueva versión se
        aplica a los periodos que empiecen después y a los devengos mensuales futuros.
      </p>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Publicar versión
      </SubmitButton>
    </form>
  );
}

export function AssignmentForm({
  policies,
  employees,
  teams,
  centers,
  today,
}: {
  policies: Option[];
  employees: Option[];
  teams: Option[];
  centers: Option[];
  today: string;
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    assignmentSchema,
    createAssignment,
  );
  const [scope, setScope] = useState<"company" | "work_center" | "team" | "employee">("company");
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="policy_id"
          label="Política"
          placeholder="Elige una política"
          options={policies.map((p) => ({ value: p.id, label: p.label }))}
          errors={errors.policy_id}
        />
        <SelectField
          name="scope_type"
          label="Se aplica a"
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
          options={[
            { value: "company", label: "Toda la empresa" },
            { value: "work_center", label: "Un centro" },
            { value: "team", label: "Un equipo" },
            { value: "employee", label: "Una persona" },
          ]}
        />
        {scope === "work_center" ? (
          <SelectField
            name="work_center_id"
            label="Centro"
            placeholder="Elige un centro"
            options={centers.map((c) => ({ value: c.id, label: c.label }))}
            errors={errors.work_center_id}
          />
        ) : null}
        {scope === "team" ? (
          <SelectField
            name="team_id"
            label="Equipo"
            placeholder="Elige un equipo"
            options={teams.map((t) => ({ value: t.id, label: t.label }))}
            errors={errors.team_id}
          />
        ) : null}
        {scope === "employee" ? (
          <SelectField
            name="employee_id"
            label="Persona"
            placeholder="Elige una persona"
            options={employees.map((e) => ({ value: e.id, label: e.label }))}
            errors={errors.employee_id}
          />
        ) : null}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            name="valid_from"
            label="Desde"
            type="date"
            min={today}
            defaultValue={today}
            errors={errors.valid_from}
          />
          <FormField
            name="last_day"
            label="Hasta (incluido, opcional)"
            type="date"
            errors={errors.last_day}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Prioridad: persona › equipo › centro › empresa.
      </p>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Asignar política
      </SubmitButton>
    </form>
  );
}

export function EndAssignmentForm({ id, today }: { id: string; today: string }) {
  const [state, formAction, pending] = useActionState(networkSafe(endAssignment), initialFormState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <FormField
        id={`end-${id}`}
        name="last_day"
        label="Último día"
        type="date"
        min={today}
        defaultValue={today}
      />
      <SubmitButton pending={pending} variant="outline">
        Finalizar
      </SubmitButton>
      {state.status === "error" ? (
        <p role="alert" className="text-destructive w-full text-sm">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function AdjustmentForm({
  employees,
  policies,
}: {
  employees: Option[];
  policies: Option[];
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    adjustmentSchema,
    adjustBalance,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="employee_id"
          label="Persona"
          placeholder="Elige una persona"
          options={employees.map((e) => ({ value: e.id, label: e.label }))}
          errors={errors.employee_id}
        />
        <SelectField
          name="policy_id"
          label="Política"
          placeholder="Elige una política"
          options={policies.map((p) => ({ value: p.id, label: p.label }))}
          errors={errors.policy_id}
        />
        <FormField
          name="amount"
          label="Cantidad (días con ,5 o horas HH:MM; negativo con -)"
          errors={errors.amount}
        />
        <FormField
          name="reason"
          label="Motivo (queda auditado)"
          maxLength={300}
          errors={errors.reason}
        />
      </div>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Registrar ajuste
      </SubmitButton>
    </form>
  );
}
