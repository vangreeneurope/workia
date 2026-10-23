"use client";

import { useMemo, useState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { useValidatedForm } from "@/components/admin/use-validated-form";
import { FormField } from "@/components/form-field";
import { Label } from "@/components/ui/label";
import { addDays, formatDate } from "@/lib/dates";

import {
  closeAssignment,
  createCalendar,
  createTemplate,
  endCalendarLink,
  importHolidays,
  linkCalendar,
  publishAssignment,
  publishTemplateVersion,
  saveAssignment,
  addHoliday,
} from "../actions";
import { isoWeekday, longDayLabel } from "../calendar";
import {
  ASSIGNMENT_SCOPE_LABELS,
  ASSIGNMENT_SCOPES,
  assignmentCloseSchema,
  assignmentPublishSchema,
  assignmentSchema,
  CALENDAR_SCOPE_LABELS,
  CALENDAR_SCOPES,
  calendarLinkEndSchema,
  calendarLinkSchema,
  calendarSchema,
  holidayImportSchema,
  holidaySchema,
  parseHolidayLines,
  templateCreateSchema,
  templatePublishSchema,
  type AssignmentScopeValue,
} from "../schemas";

type Option = { id: string; label: string };

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

export function TemplateCreateForm() {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    templateCreateSchema,
    createTemplate,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <FormField
          name="code"
          label="Código"
          autoComplete="off"
          placeholder="M"
          errors={errors.code}
        />
        <FormField name="name" label="Nombre" placeholder="Mañana" errors={errors.name} />
      </div>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Crear plantilla
      </SubmitButton>
    </form>
  );
}

export function PublishVersionForm({ versionId, today }: { versionId: string; today: string }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    templatePublishSchema,
    publishTemplateVersion,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="version_id" value={versionId} />
      <FormField
        name="valid_from"
        label="Con efecto desde"
        type="date"
        min={today}
        defaultValue={addDays(today, 1)}
        errors={errors.valid_from}
      />
      <p className="text-muted-foreground text-sm">
        La versión anterior se cierra el día antes de esta fecha. Los días anteriores conservan la
        versión que tenían: nada se recalcula hacia atrás.
      </p>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Publicar versión
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Asignaciones
// ---------------------------------------------------------------------------

export type AssignmentEditorValue = {
  id: string | null;
  scope: AssignmentScopeValue;
  employeeId: string | null;
  teamId: string | null;
  termsId: string | null;
  validFrom: string;
  lastDay: string | null;
  cycleDays: number;
  anchorDate: string;
  days: (string | null)[];
  note: string | null;
};

export function AssignmentEditor({
  initial,
  employees,
  teams,
  terms,
  templates,
  today,
}: {
  initial: AssignmentEditorValue | null;
  employees: Option[];
  teams: Option[];
  terms: Option[];
  templates: Option[];
  today: string;
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    assignmentSchema,
    saveAssignment,
  );
  const [scope, setScope] = useState<AssignmentScopeValue>(initial?.scope ?? "employee");
  const [validFrom, setValidFrom] = useState(initial?.validFrom ?? addDays(today, 1));
  const [anchor, setAnchor] = useState(initial?.anchorDate ?? "");
  const [cycleDays, setCycleDays] = useState(initial?.cycleDays ?? 7);
  const [days, setDays] = useState<(string | null)[]>(
    initial?.days ??
      Array.from({ length: 7 }, (_, i) => (i < 5 ? (templates[0]?.id ?? null) : null)),
  );
  const cycle = useMemo(
    () => Array.from({ length: cycleDays }, (_, i) => days[i] ?? null),
    [cycleDays, days],
  );
  const anchorDate = anchor || validFrom;

  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="days" value={JSON.stringify(cycle)} />

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Aplicar a</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {ASSIGNMENT_SCOPES.map((value) => (
            <label key={value} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="radio"
                name="scope_type"
                value={value}
                checked={scope === value}
                onChange={() => setScope(value)}
                className="size-4"
              />
              {ASSIGNMENT_SCOPE_LABELS[value]}
            </label>
          ))}
        </div>
        <p className="text-muted-foreground text-sm">
          Precedencia: excepción individual › festivo › persona › equipo › patrón del contrato.
        </p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        {scope === "employee" || scope === "exception" ? (
          <SelectField
            name="employee_id"
            label="Persona"
            defaultValue={initial?.employeeId ?? ""}
            placeholder="Elige una persona"
            options={employees.map((e) => ({ value: e.id, label: e.label }))}
            errors={errors.employee_id}
          />
        ) : null}
        {scope === "team" ? (
          <SelectField
            name="team_id"
            label="Equipo"
            defaultValue={initial?.teamId ?? ""}
            placeholder="Elige un equipo"
            options={teams.map((t) => ({ value: t.id, label: t.label }))}
            errors={errors.team_id}
          />
        ) : null}
        {scope === "contract" ? (
          <SelectField
            name="employment_terms_id"
            label="Condiciones de empleo"
            defaultValue={initial?.termsId ?? ""}
            placeholder="Elige unas condiciones vigentes"
            options={terms.map((t) => ({ value: t.id, label: t.label }))}
            errors={errors.employment_terms_id}
          />
        ) : null}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            name="valid_from"
            label="Desde"
            type="date"
            min={today}
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            errors={errors.valid_from}
          />
          <FormField
            name="last_day"
            label={scope === "exception" ? "Hasta (incluido)" : "Hasta (incluido, opcional)"}
            type="date"
            min={validFrom}
            defaultValue={initial?.lastDay ?? ""}
            errors={errors.last_day}
          />
        </div>
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">Recurrencia</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            name="cycle_days"
            label="Duración del ciclo (días; 7 = semanal, 14 = rotación quincenal)"
            type="number"
            inputMode="numeric"
            min={1}
            max={56}
            value={cycleDays}
            onChange={(e) => {
              const n = Math.min(56, Math.max(1, Number(e.target.value) || 1));
              setCycleDays(n);
            }}
            errors={errors.cycle_days}
          />
          <FormField
            name="anchor_date"
            label="El día 1 del ciclo es (por defecto, la fecha de inicio)"
            type="date"
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
            errors={errors.anchor_date}
          />
        </div>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cycle.map((value, i) => {
            const sample = addDays(anchorDate, i);
            const weekday = cycleDays % 7 === 0 ? longDayLabel(sample).split(" ")[0] : null;
            return (
              <li key={i}>
                <SelectField
                  name={`day_${i}`}
                  id={`day_${i}`}
                  label={`Día ${i + 1}${weekday ? ` (${weekday})` : ""}`}
                  value={value ?? ""}
                  onChange={(e) =>
                    setDays((current) => {
                      // Se conservan los días más allá del ciclo por si se vuelve a alargar.
                      const next = [...current];
                      while (next.length <= i) next.push(null);
                      next[i] = e.target.value || null;
                      return next;
                    })
                  }
                  options={[
                    { value: "", label: "Descanso" },
                    ...templates.map((t) => ({ value: t.id, label: t.label })),
                  ]}
                />
              </li>
            );
          })}
        </ol>
        {errors.days ? <p className="text-destructive text-sm">{errors.days.join(". ")}</p> : null}
        <p className="text-muted-foreground text-sm">
          Ejemplo: el día 1 del ciclo cae el {formatDate(anchorDate)} (
          {
            ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][
              isoWeekday(anchorDate) - 1
            ]
          }
          ); el ciclo se repite cada {cycleDays} día(s).
        </p>
      </fieldset>

      <FormField
        name="note"
        label="Nota interna (opcional, sin datos de salud)"
        defaultValue={initial?.note ?? ""}
        maxLength={300}
        errors={errors.note}
      />
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        {initial?.id ? "Guardar borrador" : "Crear borrador"}
      </SubmitButton>
    </form>
  );
}

export function PublishAssignmentForm({ id, warnings }: { id: string; warnings: number }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    assignmentPublishSchema,
    publishAssignment,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      {warnings > 0 ? (
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input type="checkbox" name="accept_warnings" className="mt-1 size-4" />
          He revisado los {warnings} aviso(s) y quiero publicar igualmente.
        </label>
      ) : null}
      {errors.accept_warnings ? (
        <p className="text-destructive text-sm">{errors.accept_warnings.join(". ")}</p>
      ) : null}
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Publicar y avisar a las personas afectadas
      </SubmitButton>
    </form>
  );
}

export function CloseAssignmentForm({ id, today }: { id: string; today: string }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    assignmentCloseSchema,
    closeAssignment,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <FormField
        name="last_day"
        label="Último día con este horario (incluido)"
        type="date"
        min={addDays(today, -1)}
        defaultValue={today}
        errors={errors.last_day}
      />
      <p className="text-muted-foreground text-sm">
        No se puede acortar hacia el pasado. Si aún no había empezado, se anula.
      </p>
      <SubmitButton pending={pending} variant="outline" className="w-full sm:w-auto">
        Finalizar asignación
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Calendarios
// ---------------------------------------------------------------------------

export function CalendarForm() {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    calendarSchema,
    createCalendar,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="name" label="Nombre" errors={errors.name} />
        <SelectField
          name="scope"
          label="Ámbito"
          options={CALENDAR_SCOPES.map((s) => ({ value: s, label: CALENDAR_SCOPE_LABELS[s] }))}
          defaultValue="company"
          errors={errors.scope}
        />
        <FormField
          name="region_code"
          label="Código ISO de la región (opcional, p. ej. ES-MD)"
          autoComplete="off"
          errors={errors.region_code}
        />
        <FormField name="locality" label="Localidad (opcional)" errors={errors.locality} />
      </div>
      <FormField
        name="source_reference"
        label="Fuente validada (boletín oficial, convenio o acuerdo de empresa)"
        placeholder="Referencia de la publicación o del acuerdo"
        errors={errors.source_reference}
      />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="applies_to_all_centers" className="size-4" />
        Se aplica a todos los centros de la empresa
      </label>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Crear calendario
      </SubmitButton>
    </form>
  );
}

export function HolidayForm({ calendarId, today }: { calendarId: string; today: string }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    holidaySchema,
    addHoliday,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="calendar_id" value={calendarId} />
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <FormField
          name="holiday_date"
          label="Fecha"
          type="date"
          min={today}
          errors={errors.holiday_date}
        />
        <FormField name="name" label="Nombre" errors={errors.name} />
      </div>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Añadir festivo
      </SubmitButton>
    </form>
  );
}

export function HolidayImportForm({ calendarId, today }: { calendarId: string; today: string }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    holidayImportSchema,
    importHolidays,
  );
  const [text, setText] = useState("");
  const preview = text.trim() ? parseHolidayLines(text, today) : null;
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="calendar_id" value={calendarId} />
      <div className="grid gap-2">
        <Label htmlFor="lines">Festivos, uno por línea: AAAA-MM-DD;Nombre</Label>
        <textarea
          id="lines"
          name="lines"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={errors.lines ? true : undefined}
          aria-describedby="lines-help"
          className="border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border bg-transparent p-3 font-mono text-sm shadow-xs outline-none focus-visible:ring-[3px]"
        />
        <p id="lines-help" className="text-muted-foreground text-sm">
          Copia solo datos de la fuente indicada en el calendario. Si una línea falla no se importa
          ninguna.
        </p>
      </div>
      <div aria-live="polite" className="text-sm">
        {preview && preview.errors.length > 0 ? (
          <ul className="text-destructive grid gap-1">
            {preview.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        {preview && preview.rows.length > 0 ? (
          <p>Se importarán {preview.rows.length} festivo(s).</p>
        ) : null}
        {errors.lines && !preview ? (
          <p className="text-destructive">{errors.lines.join(". ")}</p>
        ) : null}
      </div>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Importar festivos
      </SubmitButton>
    </form>
  );
}

export function CalendarLinkForm({
  calendarId,
  centers,
  today,
}: {
  calendarId: string;
  centers: Option[];
  today: string;
}) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    calendarLinkSchema,
    linkCalendar,
  );
  return (
    <form action={formAction} onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="calendar_id" value={calendarId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="work_center_id"
          label="Centro"
          placeholder="Elige un centro"
          options={centers.map((c) => ({ value: c.id, label: c.label }))}
          errors={errors.work_center_id}
        />
        <FormField
          name="valid_from"
          label="Desde"
          type="date"
          min={today}
          defaultValue={today}
          errors={errors.valid_from}
        />
      </div>
      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Aplicar al centro
      </SubmitButton>
    </form>
  );
}

export function EndLinkForm({ id, today }: { id: string; today: string }) {
  const { state, formAction, pending, onSubmit, errors } = useValidatedForm(
    calendarLinkEndSchema,
    endCalendarLink,
  );
  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-2"
      noValidate
    >
      <input type="hidden" name="id" value={id} />
      <FormField
        name="last_day"
        id={`last_day_${id}`}
        label="Último día"
        type="date"
        min={addDays(today, -1)}
        defaultValue={today}
        errors={errors.last_day}
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
