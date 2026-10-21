/**
 * Reglas de validación de una versión de plantilla de turno. Son las mismas
 * que private.template_version_problems() en la base de datos (que es la que
 * decide al publicar); aquí sirven para avisar en el editor antes de guardar.
 * Mantener ambas sincronizadas: tests/unit/template-rules.test.ts.
 */

export type ShiftKind = "continuous" | "split" | "night" | "flexible";
export type SegmentKind = "work" | "break";

export type TemplateSegment = {
  startMinute: number;
  endMinute: number;
  kind: SegmentKind;
  /** Solo relevante en pausas: una pausa retribuida cuenta como tiempo de trabajo. */
  paid: boolean;
};

export type TemplateVersionDraft = {
  kind: ShiftKind;
  targetMinutes: number;
  toleranceEarlyMinutes: number;
  toleranceLateMinutes: number;
  flexWindowStart: number | null;
  flexWindowEnd: number | null;
  segments: TemplateSegment[];
};

export const SHIFT_KIND_LABELS: Record<ShiftKind, string> = {
  continuous: "Continua",
  split: "Partida",
  night: "Nocturna",
  flexible: "Flexible",
};

/** Minutos de trabajo planificados: tramos de trabajo y pausas retribuidas. */
export function plannedWorkMinutes(segments: TemplateSegment[]): number {
  return segments
    .filter((s) => s.kind === "work" || s.paid)
    .reduce((sum, s) => sum + (s.endMinute - s.startMinute), 0);
}

export function templateProblems(v: TemplateVersionDraft): string[] {
  const problems: string[] = [];
  const segments = [...v.segments].sort((a, b) => a.startMinute - b.startMinute);
  const work = segments.filter((s) => s.kind === "work");
  const firstStart = segments[0]?.startMinute;
  const lastEnd = segments.length ? Math.max(...segments.map((s) => s.endMinute)) : undefined;
  const firstWork = work.length ? Math.min(...work.map((s) => s.startMinute)) : undefined;
  const lastWork = work.length ? Math.max(...work.map((s) => s.endMinute)) : undefined;

  for (const s of segments) {
    if (
      !Number.isInteger(s.startMinute) ||
      !Number.isInteger(s.endMinute) ||
      s.startMinute < 0 ||
      s.endMinute > 2880 ||
      s.endMinute <= s.startMinute
    ) {
      problems.push(
        "Cada tramo debe terminar después de empezar (máximo hasta las 24:00 del día siguiente).",
      );
      return problems;
    }
  }

  if (v.kind !== "flexible" && work.length === 0) {
    problems.push("Añade al menos un tramo de trabajo.");
  }
  const overlaps = segments.some((a, i) =>
    segments.some((b, j) => i !== j && a.startMinute < b.endMinute && b.startMinute < a.endMinute),
  );
  if (overlaps) problems.push("Hay tramos que se solapan.");
  if (firstStart !== undefined && firstStart >= 1440) {
    problems.push("El turno debe empezar en su propio día (antes de las 24:00).");
  }
  if (firstStart !== undefined && lastEnd !== undefined && lastEnd - firstStart > 1440) {
    problems.push("Un turno no puede durar más de 24 horas.");
  }
  const breakOutside = segments.some(
    (s) =>
      s.kind === "break" &&
      (firstWork === undefined ||
        lastWork === undefined ||
        s.startMinute < firstWork ||
        s.endMinute > lastWork),
  );
  if (breakOutside) problems.push("Las pausas deben quedar dentro de la jornada.");

  const hasGap = segments.some((s, i) => {
    const next = segments[i + 1];
    return next !== undefined && next.startMinute > s.endMinute;
  });

  if (v.kind === "flexible") {
    const start = v.flexWindowStart;
    const end = v.flexWindowEnd;
    if (start === null || end === null || end <= start || end - start > 1440) {
      problems.push("Indica una ventana flexible válida (como mucho 24 horas).");
    } else {
      if (v.targetMinutes > end - start) {
        problems.push("Las horas objetivo no caben en la ventana flexible.");
      }
      if (segments.some((s) => s.startMinute < start || s.endMinute > end)) {
        problems.push("La presencia obligatoria debe estar dentro de la ventana flexible.");
      }
    }
  } else {
    const computed = plannedWorkMinutes(segments);
    if (v.targetMinutes !== computed) {
      problems.push(
        `Las horas objetivo (${v.targetMinutes} min) no coinciden con los tramos (${computed} min).`,
      );
    }
    if (v.kind === "continuous" && hasGap) {
      problems.push("Una jornada continua no puede tener huecos entre tramos.");
    }
    if (v.kind === "split" && (work.length < 2 || !hasGap)) {
      problems.push("Una jornada partida necesita dos tramos de trabajo con un hueco entre ellos.");
    }
    if (v.kind === "night" && !work.some((s) => s.startMinute < 360 || s.endMinute > 1320)) {
      problems.push("Una jornada nocturna debe incluir trabajo entre las 22:00 y las 06:00.");
    }
  }
  return problems;
}
