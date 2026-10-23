"use client";

import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import { FormMessage } from "@/components/admin/form-message";
import { SelectField } from "@/components/admin/select-field";
import { SubmitButton } from "@/components/admin/submit-button";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { initialFormState } from "@/lib/forms";
import { networkSafe } from "@/lib/network";

import { saveTemplateDraft } from "../actions";
import { SHIFT_KINDS } from "../schemas";
import {
  plannedWorkMinutes,
  SHIFT_KIND_LABELS,
  templateProblems,
  type ShiftKind,
  type TemplateSegment,
} from "../template-rules";
import { formatDuration, formatMinute, parseClock } from "../zoned-time";

export type TemplateEditorValue = {
  kind: ShiftKind;
  targetMinutes: number;
  toleranceEarlyMinutes: number;
  toleranceLateMinutes: number;
  flexWindowStart: number | null;
  flexWindowEnd: number | null;
  segments: TemplateSegment[];
};

/** Fila editable: hora "HH:MM" y si cae en el día siguiente. */
type Row = {
  key: number;
  start: string;
  startNextDay: boolean;
  end: string;
  endNextDay: boolean;
  kind: "work" | "break";
  paid: boolean;
};

function toClock(minute: number): { clock: string; nextDay: boolean } {
  const nextDay = minute >= 1440;
  const inDay = nextDay ? minute - 1440 : minute;
  return { clock: formatMinute(inDay === 1440 ? 0 : inDay).slice(0, 5), nextDay };
}

function toMinute(clock: string, nextDay: boolean): number | null {
  const m = parseClock(clock);
  return m === null ? null : m + (nextDay ? 1440 : 0);
}

let nextKey = 1;

export function TemplateEditor({
  templateId,
  initial,
}: {
  templateId: string;
  initial: TemplateEditorValue;
}) {
  const [state, formAction, pending] = useActionState(
    networkSafe(saveTemplateDraft),
    initialFormState,
  );
  const [kind, setKind] = useState<ShiftKind>(initial.kind);
  const [flexTarget, setFlexTarget] = useState(formatMinute(initial.targetMinutes).slice(0, 5));
  const [flexStart, setFlexStart] = useState(
    initial.flexWindowStart !== null ? toClock(initial.flexWindowStart).clock : "07:00",
  );
  const [flexEnd, setFlexEnd] = useState(
    initial.flexWindowEnd !== null ? toClock(initial.flexWindowEnd).clock : "20:00",
  );
  const [rows, setRows] = useState<Row[]>(() =>
    initial.segments.map((s) => {
      const start = toClock(s.startMinute);
      // Un fin exacto a medianoche (1440) se muestra como 00:00 del día siguiente.
      const end = toClock(s.endMinute);
      return {
        key: nextKey++,
        start: start.clock,
        startNextDay: start.nextDay,
        end: end.clock,
        endNextDay: end.nextDay,
        kind: s.kind,
        paid: s.paid,
      };
    }),
  );

  const segments = useMemo(
    () =>
      rows.flatMap((r) => {
        const startMinute = toMinute(r.start, r.startNextDay);
        const endMinute = toMinute(r.end, r.endNextDay);
        if (startMinute === null || endMinute === null) return [];
        return [{ startMinute, endMinute, kind: r.kind, paid: r.kind === "work" || r.paid }];
      }),
    [rows],
  );
  const incomplete = segments.length !== rows.length;
  const computed = plannedWorkMinutes(segments);
  const flexTargetMinutes = parseClock(flexTarget);
  const target = kind === "flexible" ? (flexTargetMinutes ?? 0) : computed;
  const windowStart = parseClock(flexStart);
  const windowEndRaw = parseClock(flexEnd);
  const windowEnd =
    windowStart !== null && windowEndRaw !== null && windowEndRaw <= windowStart
      ? windowEndRaw + 1440
      : windowEndRaw;

  const problems = templateProblems({
    kind,
    targetMinutes: target,
    toleranceEarlyMinutes: 0,
    toleranceLateMinutes: 0,
    flexWindowStart: kind === "flexible" ? windowStart : null,
    flexWindowEnd: kind === "flexible" ? windowEnd : null,
    segments,
  });
  if (incomplete) problems.unshift("Completa las horas de todos los tramos (formato HH:MM).");

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  return (
    <form action={formAction} className="grid gap-4">
      <FormMessage state={state} />
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="target_minutes" value={target} />
      <input
        type="hidden"
        name="segments"
        value={JSON.stringify(
          segments.map((s) => ({
            start_minute: s.startMinute,
            end_minute: s.endMinute,
            kind: s.kind,
            paid: s.paid,
          })),
        )}
      />
      {kind === "flexible" ? (
        <>
          <input type="hidden" name="flex_start" value={windowStart ?? ""} />
          <input type="hidden" name="flex_end" value={windowEnd ?? ""} />
        </>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          name="kind"
          label="Tipo de jornada"
          value={kind}
          onChange={(e) => setKind(e.target.value as ShiftKind)}
          options={SHIFT_KINDS.map((k) => ({ value: k, label: SHIFT_KIND_LABELS[k] }))}
          errors={state.fieldErrors?.kind}
        />
        <FormField
          name="tolerance_early"
          label="Tolerancia de entrada (min)"
          type="number"
          inputMode="numeric"
          min={0}
          max={240}
          defaultValue={initial.toleranceEarlyMinutes}
          errors={state.fieldErrors?.tolerance_early}
        />
        <FormField
          name="tolerance_late"
          label="Tolerancia de salida (min)"
          type="number"
          inputMode="numeric"
          min={0}
          max={240}
          defaultValue={initial.toleranceLateMinutes}
          errors={state.fieldErrors?.tolerance_late}
        />
      </div>

      {kind === "flexible" ? (
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-medium">Ventana flexible y horas objetivo</legend>
          <FormField
            name="flex_start_clock"
            label="Desde"
            type="time"
            value={flexStart}
            onChange={(e) => setFlexStart(e.target.value)}
          />
          <FormField
            name="flex_end_clock"
            label="Hasta (si es anterior, día siguiente)"
            type="time"
            value={flexEnd}
            onChange={(e) => setFlexEnd(e.target.value)}
          />
          <FormField
            name="flex_target"
            label="Horas objetivo (HH:MM)"
            type="time"
            value={flexTarget}
            onChange={(e) => setFlexTarget(e.target.value)}
          />
        </fieldset>
      ) : null}

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">
          {kind === "flexible" ? "Presencia obligatoria (opcional)" : "Tramos y pausas"}
        </legend>
        {rows.length === 0 ? <p className="text-muted-foreground text-sm">Sin tramos.</p> : null}
        <ol className="grid gap-3">
          {rows.map((r, index) => (
            <li key={r.key} className="grid gap-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Tramo {index + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Quitar tramo ${index + 1}`}
                  onClick={() => setRows((current) => current.filter((x) => x.key !== r.key))}
                >
                  <Trash2 aria-hidden /> Quitar
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SelectField
                  name={`kind_${r.key}`}
                  id={`kind_${r.key}`}
                  label="Tipo"
                  value={r.kind}
                  onChange={(e) => update(r.key, { kind: e.target.value as Row["kind"] })}
                  options={[
                    { value: "work", label: "Trabajo" },
                    { value: "break", label: "Pausa" },
                  ]}
                />
                <FormField
                  name={`start_${r.key}`}
                  label="Inicio"
                  type="time"
                  value={r.start}
                  onChange={(e) => update(r.key, { start: e.target.value })}
                />
                <FormField
                  name={`end_${r.key}`}
                  label="Fin"
                  type="time"
                  value={r.end}
                  onChange={(e) => update(r.key, { end: e.target.value })}
                />
                <div className="grid content-end gap-2">
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={r.endNextDay}
                      onChange={(e) => update(r.key, { endNextDay: e.target.checked })}
                    />
                    Fin al día siguiente
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={r.startNextDay}
                    onChange={(e) => update(r.key, { startNextDay: e.target.checked })}
                  />
                  Inicio al día siguiente
                </label>
                {r.kind === "break" ? (
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={r.paid}
                      onChange={(e) => update(r.key, { paid: e.target.checked })}
                    />
                    Pausa retribuida (cuenta como trabajo)
                  </label>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          disabled={rows.length >= 20}
          onClick={() => {
            const last = segments.at(-1);
            const start = last ? toClock(last.endMinute) : { clock: "08:00", nextDay: false };
            setRows((current) => [
              ...current,
              {
                key: nextKey++,
                start: start.clock,
                startNextDay: start.nextDay,
                end: start.clock,
                endNextDay: start.nextDay,
                kind: "work",
                paid: true,
              },
            ]);
          }}
        >
          <Plus aria-hidden /> Añadir tramo
        </Button>
      </fieldset>

      <div className="bg-muted/50 grid gap-2 rounded-lg p-3 text-sm" aria-live="polite">
        <p>
          <strong className="font-medium">Horas objetivo:</strong> {formatDuration(target)}
          {kind !== "flexible" ? " (suma de tramos de trabajo y pausas retribuidas)" : ""}
        </p>
        {problems.length === 0 ? (
          <p className="flex items-center gap-2">
            <CheckCircle2 className="size-4" aria-hidden /> La plantilla es válida y se puede
            publicar.
          </p>
        ) : (
          <ul className="grid gap-1">
            {problems.map((p) => (
              <li key={p} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {p}
              </li>
            ))}
          </ul>
        )}
      </div>

      <SubmitButton pending={pending} className="w-full sm:w-auto">
        Guardar borrador
      </SubmitButton>
    </form>
  );
}
