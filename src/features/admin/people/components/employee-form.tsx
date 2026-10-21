"use client";

import { useState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";
import type { FormState } from "@/lib/forms";

import { employeeSchema } from "../../schemas";

type Option = { id: string; name: string; work_center_id?: string | null };

export function EmployeeForm({
  action,
  defaults = {},
  workCenters,
  teams,
  submitLabel,
  readOnly = false,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: Partial<{
    employee_code: string;
    first_name: string;
    last_name: string;
    work_email: string | null;
    work_center_id: string | null;
    team_id: string | null;
  }>;
  workCenters: Option[];
  teams: Option[];
  submitLabel: string;
  readOnly?: boolean;
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(employeeSchema, action);
  const [center, setCenter] = useState(defaults.work_center_id ?? "");
  // Si hay centro elegido, se proponen sus equipos y los que no tienen centro.
  const teamOptions = teams.filter(
    (t) => !center || !t.work_center_id || t.work_center_id === center,
  );

  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <fieldset disabled={readOnly} className="grid gap-4">
        <FormField
          name="employee_code"
          label="Código de empleado"
          defaultValue={defaults.employee_code}
          autoComplete="off"
          required
          errors={errors.employee_code}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            name="first_name"
            label="Nombre"
            defaultValue={defaults.first_name}
            required
            errors={errors.first_name}
          />
          <FormField
            name="last_name"
            label="Apellidos"
            defaultValue={defaults.last_name}
            required
            errors={errors.last_name}
          />
        </div>
        <FormField
          name="work_email"
          label="Correo corporativo (opcional)"
          type="email"
          defaultValue={defaults.work_email ?? ""}
          errors={errors.work_email}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            name="work_center_id"
            label="Centro de trabajo"
            options={workCenters.map((w) => ({ value: w.id, label: w.name }))}
            placeholder="Sin centro"
            value={center}
            onChange={(e) => setCenter(e.target.value)}
            errors={errors.work_center_id}
          />
          <SelectField
            name="team_id"
            label="Equipo"
            options={teamOptions.map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Sin equipo"
            defaultValue={defaults.team_id ?? ""}
            errors={errors.team_id}
          />
        </div>
      </fieldset>
      {readOnly ? null : (
        <SubmitButton pending={pending} className="w-full sm:w-auto">
          {submitLabel}
        </SubmitButton>
      )}
    </form>
  );
}
