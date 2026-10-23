import { describe, expect, it } from "vitest";

import {
  plannedWorkMinutes,
  templateProblems,
  type TemplateSegment,
  type TemplateVersionDraft,
} from "@/features/schedules/template-rules";

const work = (startMinute: number, endMinute: number): TemplateSegment => ({
  startMinute,
  endMinute,
  kind: "work",
  paid: true,
});
const pause = (startMinute: number, endMinute: number, paid = false): TemplateSegment => ({
  startMinute,
  endMinute,
  kind: "break",
  paid,
});

function draft(partial: Partial<TemplateVersionDraft>): TemplateVersionDraft {
  return {
    kind: "continuous",
    targetMinutes: 0,
    toleranceEarlyMinutes: 0,
    toleranceLateMinutes: 0,
    flexWindowStart: null,
    flexWindowEnd: null,
    segments: [],
    ...partial,
  };
}

// Mismos casos que supabase/tests/50_horarios.test.sql (las reglas deben coincidir).
describe("templateProblems", () => {
  it("continua de 08:00 a 15:00 con 7 h objetivo es válida", () => {
    expect(templateProblems(draft({ targetMinutes: 420, segments: [work(480, 900)] }))).toEqual([]);
  });

  it("las horas objetivo deben coincidir con los tramos", () => {
    expect(
      templateProblems(draft({ kind: "night", targetMinutes: 450, segments: [work(1320, 1800)] })),
    ).toEqual(["Las horas objetivo (450 min) no coinciden con los tramos (480 min)."]);
  });

  it("nocturna que cruza la medianoche con pausa no retribuida", () => {
    const segments = [work(1320, 1560), pause(1560, 1590), work(1590, 1800)];
    expect(plannedWorkMinutes(segments)).toBe(450);
    expect(templateProblems(draft({ kind: "night", targetMinutes: 450, segments }))).toEqual([]);
  });

  it("una pausa retribuida cuenta como trabajo", () => {
    const segments = [work(480, 720), pause(720, 750, true), work(750, 960)];
    expect(templateProblems(draft({ targetMinutes: 480, segments }))).toEqual([]);
  });

  it("nocturna sin horas de noche", () => {
    expect(
      templateProblems(draft({ kind: "night", targetMinutes: 420, segments: [work(480, 900)] })),
    ).toContain("Una jornada nocturna debe incluir trabajo entre las 22:00 y las 06:00.");
  });

  it("partida: dos tramos con hueco", () => {
    expect(
      templateProblems(draft({ kind: "split", targetMinutes: 480, segments: [work(540, 1020)] })),
    ).toContain("Una jornada partida necesita dos tramos de trabajo con un hueco entre ellos.");
    expect(
      templateProblems(
        draft({ kind: "split", targetMinutes: 480, segments: [work(540, 840), work(960, 1140)] }),
      ),
    ).toEqual([]);
  });

  it("continua sin huecos", () => {
    expect(
      templateProblems(draft({ targetMinutes: 480, segments: [work(540, 840), work(960, 1140)] })),
    ).toContain("Una jornada continua no puede tener huecos entre tramos.");
  });

  it("detecta solapes, inicio al día siguiente, más de 24 h y pausas fuera", () => {
    expect(
      templateProblems(draft({ targetMinutes: 480, segments: [work(540, 840), work(800, 1080)] })),
    ).toContain("Hay tramos que se solapan.");
    expect(templateProblems(draft({ targetMinutes: 60, segments: [work(1500, 1560)] }))).toContain(
      "El turno debe empezar en su propio día (antes de las 24:00).",
    );
    expect(templateProblems(draft({ targetMinutes: 1500, segments: [work(0, 1500)] }))).toContain(
      "Un turno no puede durar más de 24 horas.",
    );
    expect(
      templateProblems(draft({ targetMinutes: 420, segments: [pause(420, 480), work(480, 900)] })),
    ).toContain("Las pausas deben quedar dentro de la jornada.");
  });

  it("flexible: ventana y presencia obligatoria", () => {
    const base = {
      kind: "flexible" as const,
      targetMinutes: 480,
      flexWindowStart: 420,
      flexWindowEnd: 1200,
    };
    expect(templateProblems(draft({ ...base, segments: [work(600, 840)] }))).toEqual([]);
    expect(templateProblems(draft({ ...base, segments: [] }))).toEqual([]);
    expect(templateProblems(draft({ ...base, segments: [work(360, 840)] }))).toContain(
      "La presencia obligatoria debe estar dentro de la ventana flexible.",
    );
    expect(templateProblems(draft({ ...base, targetMinutes: 900 }))).toContain(
      "Las horas objetivo no caben en la ventana flexible.",
    );
    expect(templateProblems(draft({ ...base, flexWindowStart: null }))).toContain(
      "Indica una ventana flexible válida (como mucho 24 horas).",
    );
  });

  it("tramos imposibles", () => {
    expect(templateProblems(draft({ targetMinutes: 0, segments: [work(600, 600)] }))[0]).toMatch(
      /terminar después/,
    );
    expect(templateProblems(draft({ targetMinutes: 0, segments: [] }))).toContain(
      "Añade al menos un tramo de trabajo.",
    );
  });
});
