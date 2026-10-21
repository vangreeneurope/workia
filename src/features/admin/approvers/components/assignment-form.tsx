"use client";

import { useState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";

import { APPROVAL_TYPE_LABELS, APPROVAL_TYPES, assignmentSchema } from "../../schemas";
import { createAssignment } from "../actions";

export function AssignmentForm({
  employees,
  teams,
  today,
}: {
  employees: { id: string; label: string }[];
  teams: { id: string; name: string }[];
  today: string;
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    assignmentSchema,
    createAssignment,
  );
  const [scope, setScope] = useState<"employee" | "team">("employee");
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Aplicar a</legend>
        <div className="flex flex-wrap gap-4">
          {(["employee", "team"] as const).map((value) => (
            <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="radio"
                name="scope_type"
                value={value}
                checked={scope === value}
                onChange={() => setScope(value)}
                className="size-4"
              />
              {value === "employee" ? "Una persona" : "Un equipo completo"}
            </label>
          ))}
        </div>
        {errors.scope_type ? (
          <p className="text-destructive text-sm">{errors.scope_type.join(". ")}</p>
        ) : null}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        {scope === "employee" ? (
          <SelectField
            name="employee_id"
            label="Persona"
            options={employees.map((e) => ({ value: e.id, label: e.label }))}
            placeholder="Elige una persona"
            errors={errors.employee_id}
          />
        ) : (
          <SelectField
            name="team_id"
            label="Equipo"
            options={teams.map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Elige un equipo"
            errors={errors.team_id}
          />
        )}
        <SelectField
          name="request_type"
          label="Tipo de solicitud"
          options={APPROVAL_TYPES.map((t) => ({ value: t, label: APPROVAL_TYPE_LABELS[t] }))}
          defaultValue="all"
          errors={errors.request_type}
        />
        <FormField
          name="manager_email"
          label="Correo del manager (puede ser de otra empresa del grupo)"
          type="email"
          autoComplete="off"
          errors={errors.manager_email}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            name="valid_from"
            label="Desde"
            type="date"
            defaultValue={today}
            errors={errors.valid_from}
          />
          <FormField
            name="valid_to"
            label="Hasta (incluido)"
            type="date"
            errors={errors.valid_to}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-sm">
        Prioridad: persona y tipo concreto › persona y todas › equipo y tipo concreto › equipo y
        todas.
      </p>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Crear asignación
      </SubmitButton>
    </form>
  );
}
