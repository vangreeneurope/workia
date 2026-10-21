"use client";

import { useState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";
import { ROLE_LABELS } from "@/lib/auth/permissions";

import { ROLE_OPTIONS, roleGrantSchema } from "../../schemas";
import { grantRole } from "../actions";

export function RoleGrantForm({
  membershipId,
  workCenters,
  teams,
  today,
}: {
  membershipId: string;
  workCenters: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  today: string;
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    roleGrantSchema,
    grantRole,
  );
  const [scope, setScope] = useState("company");
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="membership_id" value={membershipId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="role"
          label="Rol"
          options={ROLE_OPTIONS.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          placeholder="Elige un rol"
          errors={errors.role}
        />
        <SelectField
          name="scope_type"
          label="Ámbito"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          options={[
            { value: "company", label: "Toda la empresa" },
            { value: "work_center", label: "Un centro" },
            { value: "team", label: "Un equipo" },
          ]}
          errors={errors.scope_type}
        />
        {scope === "work_center" ? (
          <SelectField
            name="work_center_id"
            label="Centro"
            options={workCenters.map((w) => ({ value: w.id, label: w.name }))}
            placeholder="Elige un centro"
            errors={errors.work_center_id}
          />
        ) : null}
        {scope === "team" ? (
          <SelectField
            name="team_id"
            label="Equipo"
            options={teams.map((t) => ({ value: t.id, label: t.name }))}
            placeholder="Elige un equipo"
            errors={errors.team_id}
          />
        ) : null}
        <FormField
          name="valid_from"
          label="Desde"
          type="date"
          defaultValue={today}
          errors={errors.valid_from}
        />
        <FormField
          name="valid_to"
          label="Hasta (opcional, no incluido)"
          type="date"
          errors={errors.valid_to}
        />
      </div>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Conceder rol
      </SubmitButton>
    </form>
  );
}
