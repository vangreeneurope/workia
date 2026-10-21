/**
 * Resolución determinista del horario planificado de una persona para un día.
 *
 * Función pura: recibe una foto de los datos (ScheduleSnapshot) y no consulta
 * nada ni depende del reloj, así que el mismo día con los mismos datos da
 * siempre el mismo resultado. La carga (con RLS) está en ./queries.ts.
 *
 * Precedencia (docs/HORARIOS.md, sección 3):
 *   1. Excepción individual
 *   2. Festivo del calendario del centro
 *   3. Asignación individual
 *   4. Asignación del equipo
 *   5. Patrón contractual (ligado a unas condiciones de empleo)
 * Sin condiciones vigentes o después de la baja no hay horario planificado.
 * Una ausencia aprobada no cambia el plan: se informa encima.
 *
 * No clasifica horas extra: solo da horas objetivo y planificadas.
 */

import { addDays } from "@/lib/dates";

import {
  plannedWorkMinutes,
  type SegmentKind,
  type ShiftKind,
  type TemplateSegment,
} from "./template-rules";
import { zonedWallTimeToUtc } from "./zoned-time";

export type AssignmentScope = "exception" | "employee" | "team" | "contract";

export type SnapshotVersion = {
  id: string;
  version: number;
  kind: ShiftKind;
  targetMinutes: number;
  toleranceEarlyMinutes: number;
  toleranceLateMinutes: number;
  flexWindowStart: number | null;
  flexWindowEnd: number | null;
  /** Vigencia [validFrom, validTo) en días de calendario. */
  validFrom: string;
  validTo: string | null;
  segments: TemplateSegment[];
};

export type SnapshotTemplate = {
  id: string;
  code: string;
  name: string;
  /** Solo versiones publicadas. */
  versions: SnapshotVersion[];
};

export type SnapshotAssignment = {
  id: string;
  scope: AssignmentScope;
  employmentTermsId: string | null;
  validFrom: string;
  validTo: string | null;
  cycleDays: number;
  anchorDate: string;
  /** Plantilla de cada día del ciclo; null = descanso. */
  days: (string | null)[];
};

export type SnapshotTerms = { id: string; validFrom: string; validTo: string | null };

export type ScheduleSnapshot = {
  employeeId: string;
  /** Zona del centro de trabajo o, si no tiene, la de la empresa. */
  timeZone: string;
  /** Último día de relación laboral (incluido), si hay baja. */
  endDate: string | null;
  terms: SnapshotTerms[];
  /** Solo asignaciones publicadas que afectan a la persona (propias, de su equipo, de su contrato). */
  assignments: SnapshotAssignment[];
  templates: Record<string, SnapshotTemplate>;
  /** Festivos que aplican a su centro en cada fecha (ya filtrados por vigencia del calendario). */
  holidays: { date: string; name: string }[];
  /** Ausencias aprobadas [startsOn, endsOn] incluidos. */
  leaves: { startsOn: string; endsOn: string }[];
};

export type PlannedSegment = {
  kind: SegmentKind;
  paid: boolean;
  /** Minutos locales desde la medianoche del día del turno (pueden pasar de 1440). */
  startMinute: number;
  endMinute: number;
  /** Instantes reales (ISO UTC). */
  startsAt: string;
  endsAt: string;
  /** Duración real: difiere de endMinute - startMinute si cruza un cambio de hora. */
  elapsedMinutes: number;
};

export type PlannedStatus = "work" | "rest" | "holiday" | "unassigned" | "no_contract";

export type PlannedShift = {
  employeeId: string;
  date: string;
  timeZone: string;
  status: PlannedStatus;
  /** De dónde sale el plan (null si no hay asignación aplicable). */
  source: { level: AssignmentScope | "holiday"; assignmentId: string | null } | null;
  template: {
    id: string;
    code: string;
    name: string;
    versionId: string;
    version: number;
    kind: ShiftKind;
  } | null;
  segments: PlannedSegment[];
  /** Horas objetivo del día (minutos). Cero si no se trabaja. */
  targetMinutes: number;
  /** Minutos de trabajo según el reloj de pared (tramos de trabajo y pausas retribuidas). */
  plannedMinutes: number;
  /** Minutos reales de trabajo (tienen en cuenta el cambio de hora). */
  elapsedWorkMinutes: number;
  toleranceEarlyMinutes: number;
  toleranceLateMinutes: number;
  flexWindow: { startMinute: number; endMinute: number; startsAt: string; endsAt: string } | null;
  holiday: string | null;
  /** Hay una ausencia aprobada ese día. */
  absence: boolean;
  /** Avisos explicables: cambio de hora, plantilla sin versión, baja... */
  notes: string[];
};

const LEVEL_ORDER: AssignmentScope[] = ["exception", "employee", "team", "contract"];

function covers(validFrom: string, validTo: string | null, date: string): boolean {
  return validFrom <= date && (validTo === null || date < validTo);
}

/** Días entre dos fechas ISO (b - a), en enteros. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Índice del día dentro del ciclo; correcto también para fechas anteriores al ancla. */
export function cycleIndex(anchorDate: string, cycleDays: number, date: string): number {
  const diff = daysBetween(anchorDate, date);
  return ((diff % cycleDays) + cycleDays) % cycleDays;
}

/** Asignación aplicable de un nivel. Si hubiera dos (la base de datos lo impide), gana la más reciente. */
function pickAssignment(
  assignments: SnapshotAssignment[],
  level: AssignmentScope,
  date: string,
  activeTermsId: string | null,
): SnapshotAssignment | undefined {
  return assignments
    .filter(
      (a) =>
        a.scope === level &&
        covers(a.validFrom, a.validTo, date) &&
        (level !== "contract" || a.employmentTermsId === activeTermsId),
    )
    .sort((a, b) =>
      a.validFrom === b.validFrom ? a.id.localeCompare(b.id) : a.validFrom < b.validFrom ? 1 : -1,
    )[0];
}

function emptyShift(snapshot: ScheduleSnapshot, date: string, status: PlannedStatus): PlannedShift {
  return {
    employeeId: snapshot.employeeId,
    date,
    timeZone: snapshot.timeZone,
    status,
    source: null,
    template: null,
    segments: [],
    targetMinutes: 0,
    plannedMinutes: 0,
    elapsedWorkMinutes: 0,
    toleranceEarlyMinutes: 0,
    toleranceLateMinutes: 0,
    flexWindow: null,
    holiday: null,
    absence: false,
    notes: [],
  };
}

export function resolvePlannedShift(
  employeeId: string,
  localDate: string,
  snapshot: ScheduleSnapshot,
): PlannedShift {
  if (snapshot.employeeId !== employeeId) {
    throw new Error("La foto de datos no corresponde a esta persona");
  }
  const date = localDate;
  const absence = snapshot.leaves.some((l) => l.startsOn <= date && date <= l.endsOn);
  const holiday = snapshot.holidays.find((h) => h.date === date)?.name ?? null;

  if (snapshot.endDate !== null && date > snapshot.endDate) {
    return {
      ...emptyShift(snapshot, date, "no_contract"),
      absence,
      notes: ["Posterior a la baja."],
    };
  }
  const activeTerms = snapshot.terms.find((t) => covers(t.validFrom, t.validTo, date)) ?? null;
  if (!activeTerms) {
    return {
      ...emptyShift(snapshot, date, "no_contract"),
      absence,
      notes: ["Sin condiciones de empleo vigentes."],
    };
  }

  const exception = pickAssignment(snapshot.assignments, "exception", date, activeTerms.id);
  if (!exception && holiday !== null) {
    return {
      ...emptyShift(snapshot, date, "holiday"),
      source: { level: "holiday", assignmentId: null },
      holiday,
      absence,
    };
  }

  let assignment = exception;
  for (const level of LEVEL_ORDER.slice(1)) {
    if (assignment) break;
    assignment = pickAssignment(snapshot.assignments, level, date, activeTerms.id);
  }
  if (!assignment) {
    return { ...emptyShift(snapshot, date, "unassigned"), holiday, absence };
  }

  const source = { level: assignment.scope, assignmentId: assignment.id };
  const templateId = assignment.days[cycleIndex(assignment.anchorDate, assignment.cycleDays, date)];
  if (templateId === null || templateId === undefined) {
    return { ...emptyShift(snapshot, date, "rest"), source, holiday, absence };
  }

  const template = snapshot.templates[templateId];
  const version = template?.versions.find((v) => covers(v.validFrom, v.validTo, date));
  if (!template || !version) {
    return {
      ...emptyShift(snapshot, date, "unassigned"),
      source,
      holiday,
      absence,
      notes: ["La plantilla asignada no tiene una versión vigente para este día."],
    };
  }

  const notes: string[] = [];
  const toInstant = (minute: number) => {
    const resolved = zonedWallTimeToUtc(snapshot.timeZone, date, minute);
    if (resolved.adjustment === "gap") {
      notes.push(
        "Una hora del turno no existe por el cambio de hora: se aplica la hora posterior al cambio.",
      );
    } else if (resolved.adjustment === "overlap") {
      notes.push("Una hora del turno se repite por el cambio de hora: se toma la primera.");
    }
    return resolved.epochMs;
  };

  const segments: PlannedSegment[] = [...version.segments]
    .sort((a, b) => a.startMinute - b.startMinute)
    .map((s) => {
      const start = toInstant(s.startMinute);
      const end = toInstant(s.endMinute);
      return {
        kind: s.kind,
        paid: s.kind === "work" || s.paid,
        startMinute: s.startMinute,
        endMinute: s.endMinute,
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(end).toISOString(),
        elapsedMinutes: Math.max(0, Math.round((end - start) / 60_000)),
      };
    });

  let flexWindow: PlannedShift["flexWindow"] = null;
  if (
    version.kind === "flexible" &&
    version.flexWindowStart !== null &&
    version.flexWindowEnd !== null
  ) {
    flexWindow = {
      startMinute: version.flexWindowStart,
      endMinute: version.flexWindowEnd,
      startsAt: new Date(toInstant(version.flexWindowStart)).toISOString(),
      endsAt: new Date(toInstant(version.flexWindowEnd)).toISOString(),
    };
  }

  const elapsedWork = segments
    .filter((s) => s.kind === "work" || s.paid)
    .reduce((sum, s) => sum + s.elapsedMinutes, 0);
  const planned = plannedWorkMinutes(version.segments);
  if (version.kind !== "flexible" && elapsedWork !== planned) {
    notes.push(
      `El cambio de hora hace que el turno dure ${elapsedWork} min reales frente a ${planned} min de reloj.`,
    );
  }

  return {
    employeeId: snapshot.employeeId,
    date,
    timeZone: snapshot.timeZone,
    status: "work",
    source,
    template: {
      id: template.id,
      code: template.code,
      name: template.name,
      versionId: version.id,
      version: version.version,
      kind: version.kind,
    },
    segments,
    targetMinutes: version.targetMinutes,
    plannedMinutes: planned,
    elapsedWorkMinutes: elapsedWork,
    toleranceEarlyMinutes: version.toleranceEarlyMinutes,
    toleranceLateMinutes: version.toleranceLateMinutes,
    flexWindow,
    holiday,
    absence,
    notes: [...new Set(notes)],
  };
}

/** Horario planificado de un rango de días [from, to] (incluidos). */
export function resolvePlannedRange(
  employeeId: string,
  from: string,
  to: string,
  snapshot: ScheduleSnapshot,
): PlannedShift[] {
  const result: PlannedShift[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    result.push(resolvePlannedShift(employeeId, day, snapshot));
  }
  return result;
}
