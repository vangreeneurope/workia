import { describe, expect, it } from "vitest";

import {
  cycleIndex,
  resolvePlannedRange,
  resolvePlannedShift,
  type ScheduleSnapshot,
  type SnapshotAssignment,
  type SnapshotTemplate,
  type SnapshotVersion,
} from "@/features/schedules/resolver";
import type { TemplateSegment } from "@/features/schedules/template-rules";

const EMP = "e0000000-0000-0000-0000-000000000007";
const work = (startMinute: number, endMinute: number): TemplateSegment => ({
  startMinute,
  endMinute,
  kind: "work",
  paid: true,
});

function version(
  partial: Partial<SnapshotVersion> & Pick<SnapshotVersion, "segments">,
): SnapshotVersion {
  const minutes = partial.segments.reduce((s, x) => s + x.endMinute - x.startMinute, 0);
  return {
    id: `v-${partial.version ?? 1}`,
    version: 1,
    kind: "continuous",
    targetMinutes: minutes,
    toleranceEarlyMinutes: 5,
    toleranceLateMinutes: 10,
    flexWindowStart: null,
    flexWindowEnd: null,
    validFrom: "2025-01-01",
    validTo: null,
    ...partial,
  };
}

const MORNING: SnapshotTemplate = {
  id: "tpl-m",
  code: "M",
  name: "Mañana",
  versions: [
    version({ id: "m1", version: 1, segments: [work(480, 900)], validTo: "2026-11-02" }),
    version({ id: "m2", version: 2, segments: [work(540, 960)], validFrom: "2026-11-02" }),
  ],
};
const NIGHT: SnapshotTemplate = {
  id: "tpl-n",
  code: "N",
  name: "Noche",
  versions: [version({ id: "n1", kind: "night", segments: [work(1320, 1800)] })],
};
const AFTERNOON: SnapshotTemplate = {
  id: "tpl-t",
  code: "T",
  name: "Tarde",
  versions: [version({ id: "t1", segments: [work(900, 1320)] })],
};
const FLEX: SnapshotTemplate = {
  id: "tpl-f",
  code: "F",
  name: "Flexible",
  versions: [
    version({
      id: "f1",
      kind: "flexible",
      targetMinutes: 480,
      flexWindowStart: 420,
      flexWindowEnd: 1200,
      segments: [work(600, 840)],
    }),
  ],
};
const ORPHAN: SnapshotTemplate = { id: "tpl-x", code: "X", name: "Sin versión", versions: [] };

function assignment(
  partial: Partial<SnapshotAssignment> & Pick<SnapshotAssignment, "scope">,
): SnapshotAssignment {
  return {
    id: `a-${partial.scope}`,
    employmentTermsId: null,
    validFrom: "2026-01-01",
    validTo: null,
    cycleDays: 1,
    anchorDate: "2026-01-01",
    days: ["tpl-m"],
    ...partial,
  };
}

function snapshot(partial: Partial<ScheduleSnapshot> = {}): ScheduleSnapshot {
  return {
    employeeId: EMP,
    timeZone: "Europe/Madrid",
    endDate: null,
    terms: [{ id: "terms-1", validFrom: "2025-01-01", validTo: null }],
    assignments: [],
    templates: {
      "tpl-m": MORNING,
      "tpl-n": NIGHT,
      "tpl-t": AFTERNOON,
      "tpl-f": FLEX,
      "tpl-x": ORPHAN,
    },
    holidays: [],
    leaves: [],
    ...partial,
  };
}

describe("precedencia", () => {
  const all = [
    assignment({ scope: "contract", employmentTermsId: "terms-1", days: ["tpl-t"] }),
    assignment({ scope: "team", days: ["tpl-f"] }),
    assignment({ scope: "employee", days: ["tpl-m"] }),
    assignment({
      scope: "exception",
      validFrom: "2026-06-10",
      validTo: "2026-06-12",
      days: ["tpl-n"],
    }),
  ];

  it("excepción > individual > equipo > contrato", () => {
    const s = snapshot({ assignments: all });
    expect(resolvePlannedShift(EMP, "2026-06-10", s).source?.level).toBe("exception");
    expect(resolvePlannedShift(EMP, "2026-06-12", s).source?.level).toBe("employee");
    const noEmployee = snapshot({ assignments: all.filter((a) => a.scope !== "employee") });
    expect(resolvePlannedShift(EMP, "2026-06-12", noEmployee).source?.level).toBe("team");
    const onlyContract = snapshot({ assignments: all.filter((a) => a.scope === "contract") });
    const r = resolvePlannedShift(EMP, "2026-06-12", onlyContract);
    expect(r.source?.level).toBe("contract");
    expect(r.template?.code).toBe("T");
  });

  it("el patrón contractual solo vale con sus condiciones vigentes", () => {
    const s = snapshot({
      terms: [
        { id: "terms-1", validFrom: "2025-01-01", validTo: "2026-07-01" },
        { id: "terms-2", validFrom: "2026-07-01", validTo: null },
      ],
      assignments: [
        assignment({ scope: "contract", employmentTermsId: "terms-1", days: ["tpl-t"] }),
      ],
    });
    expect(resolvePlannedShift(EMP, "2026-06-30", s).status).toBe("work");
    expect(resolvePlannedShift(EMP, "2026-07-01", s).status).toBe("unassigned");
  });

  it("un festivo anula las asignaciones ordinarias, pero no una excepción", () => {
    const s = snapshot({
      assignments: all,
      holidays: [{ date: "2026-06-11", name: "Festivo sintético" }],
    });
    const exc = resolvePlannedShift(EMP, "2026-06-11", s);
    expect(exc.status).toBe("work");
    expect(exc.holiday).toBe("Festivo sintético");
    const noExc = snapshot({
      assignments: all.filter((a) => a.scope !== "exception"),
      holidays: [{ date: "2026-06-11", name: "Festivo sintético" }],
    });
    const h = resolvePlannedShift(EMP, "2026-06-11", noExc);
    expect(h.status).toBe("holiday");
    expect(h.targetMinutes).toBe(0);
  });

  it("la vigencia es [inicio, fin): el día de fin ya no aplica", () => {
    const s = snapshot({
      assignments: [
        assignment({ scope: "employee", validFrom: "2026-03-01", validTo: "2026-03-10" }),
      ],
    });
    expect(resolvePlannedShift(EMP, "2026-02-28", s).status).toBe("unassigned");
    expect(resolvePlannedShift(EMP, "2026-03-01", s).status).toBe("work");
    expect(resolvePlannedShift(EMP, "2026-03-09", s).status).toBe("work");
    expect(resolvePlannedShift(EMP, "2026-03-10", s).status).toBe("unassigned");
  });

  it("es determinista ante solapes imposibles: gana la asignación más reciente", () => {
    const s = snapshot({
      assignments: [
        assignment({ scope: "employee", id: "a-old", validFrom: "2026-01-01", days: ["tpl-m"] }),
        assignment({ scope: "employee", id: "a-new", validFrom: "2026-05-01", days: ["tpl-t"] }),
      ],
    });
    expect(resolvePlannedShift(EMP, "2026-06-01", s).source?.assignmentId).toBe("a-new");
    const reversed = snapshot({ assignments: [...s.assignments].reverse() });
    expect(resolvePlannedShift(EMP, "2026-06-01", reversed)).toEqual(
      resolvePlannedShift(EMP, "2026-06-01", s),
    );
  });
});

describe("estado de la persona", () => {
  it("sin condiciones vigentes no hay plan", () => {
    const s = snapshot({ terms: [], assignments: [assignment({ scope: "employee" })] });
    const r = resolvePlannedShift(EMP, "2026-06-01", s);
    expect(r.status).toBe("no_contract");
    expect(r.segments).toEqual([]);
  });

  it("después de la baja no hay plan; el último día sí", () => {
    const s = snapshot({ endDate: "2026-06-15", assignments: [assignment({ scope: "employee" })] });
    expect(resolvePlannedShift(EMP, "2026-06-15", s).status).toBe("work");
    expect(resolvePlannedShift(EMP, "2026-06-16", s).status).toBe("no_contract");
  });

  it("una ausencia aprobada se informa sin borrar el plan", () => {
    const s = snapshot({
      assignments: [assignment({ scope: "employee" })],
      leaves: [{ startsOn: "2026-06-01", endsOn: "2026-06-03" }],
    });
    const r = resolvePlannedShift(EMP, "2026-06-03", s);
    expect(r.status).toBe("work");
    expect(r.absence).toBe(true);
    expect(resolvePlannedShift(EMP, "2026-06-04", s).absence).toBe(false);
  });

  it("plantilla sin versión vigente: sin plan y con explicación", () => {
    const s = snapshot({ assignments: [assignment({ scope: "employee", days: ["tpl-x"] })] });
    const r = resolvePlannedShift(EMP, "2026-06-01", s);
    expect(r.status).toBe("unassigned");
    expect(r.notes[0]).toMatch(/no tiene una versión vigente/);
  });

  it("rechaza una foto de otra persona", () => {
    expect(() => resolvePlannedShift("otra", "2026-06-01", snapshot())).toThrow();
  });
});

describe("recurrencia", () => {
  it("ciclo semanal anclado en lunes con fin de semana libre", () => {
    const s = snapshot({
      assignments: [
        assignment({
          scope: "employee",
          cycleDays: 7,
          anchorDate: "2026-06-01", // lunes
          days: ["tpl-m", "tpl-m", "tpl-m", "tpl-m", "tpl-m", null, null],
        }),
      ],
    });
    const week = resolvePlannedRange(EMP, "2026-06-01", "2026-06-07", s).map((d) => d.status);
    expect(week).toEqual(["work", "work", "work", "work", "work", "rest", "rest"]);
  });

  it("rotación de 14 días mañana/tarde y fechas anteriores al ancla", () => {
    expect(cycleIndex("2026-06-01", 14, "2026-06-15")).toBe(0);
    expect(cycleIndex("2026-06-01", 14, "2026-05-31")).toBe(13);
    expect(cycleIndex("2026-06-01", 7, "2026-05-25")).toBe(0);
    const days = [...Array(7).fill("tpl-m"), ...Array(7).fill("tpl-t")] as string[];
    const s = snapshot({
      assignments: [assignment({ scope: "team", cycleDays: 14, anchorDate: "2026-06-01", days })],
    });
    expect(resolvePlannedShift(EMP, "2026-06-08", s).template?.code).toBe("T");
    expect(resolvePlannedShift(EMP, "2026-06-15", s).template?.code).toBe("M");
  });
});

describe("versiones sin efecto retroactivo", () => {
  it("cada día usa la versión vigente ese día", () => {
    const s = snapshot({ assignments: [assignment({ scope: "employee" })] });
    const before = resolvePlannedShift(EMP, "2026-11-01", s);
    const after = resolvePlannedShift(EMP, "2026-11-02", s);
    expect(before.template?.version).toBe(1);
    expect(before.segments[0]?.startMinute).toBe(480);
    expect(after.template?.version).toBe(2);
    expect(after.segments[0]?.startMinute).toBe(540);
  });
});

describe("zonas horarias y cambio de hora", () => {
  const nightly = (timeZone = "Europe/Madrid") =>
    snapshot({ timeZone, assignments: [assignment({ scope: "employee", days: ["tpl-n"] })] });

  it("turno de noche normal: 22:00 a 06:00 son 8 h reales", () => {
    const r = resolvePlannedShift(EMP, "2026-06-10", nightly());
    expect(r.segments[0]?.startsAt).toBe("2026-06-10T20:00:00.000Z");
    expect(r.segments[0]?.endsAt).toBe("2026-06-11T04:00:00.000Z");
    expect(r.elapsedWorkMinutes).toBe(480);
    expect(r.plannedMinutes).toBe(480);
    expect(r.notes).toEqual([]);
  });

  it("noche del salto de primavera: 7 h reales para 8 h de reloj", () => {
    const r = resolvePlannedShift(EMP, "2026-03-28", nightly());
    expect(r.segments[0]?.startsAt).toBe("2026-03-28T21:00:00.000Z");
    expect(r.segments[0]?.endsAt).toBe("2026-03-29T04:00:00.000Z");
    expect(r.elapsedWorkMinutes).toBe(420);
    expect(r.plannedMinutes).toBe(480);
    expect(r.targetMinutes).toBe(480);
    expect(r.notes.join(" ")).toMatch(/420 min reales frente a 480/);
  });

  it("noche del retraso de otoño: 9 h reales para 8 h de reloj", () => {
    const r = resolvePlannedShift(EMP, "2026-10-24", nightly());
    expect(r.segments[0]?.startsAt).toBe("2026-10-24T20:00:00.000Z");
    expect(r.segments[0]?.endsAt).toBe("2026-10-25T05:00:00.000Z");
    expect(r.elapsedWorkMinutes).toBe(540);
  });

  it("el mismo turno en Canarias empieza una hora más tarde en UTC", () => {
    const r = resolvePlannedShift(EMP, "2026-10-24", nightly("Atlantic/Canary"));
    expect(r.segments[0]?.startsAt).toBe("2026-10-24T21:00:00.000Z");
    expect(r.segments[0]?.endsAt).toBe("2026-10-25T06:00:00.000Z");
    expect(r.elapsedWorkMinutes).toBe(540);
    expect(r.timeZone).toBe("Atlantic/Canary");
  });

  it("un tramo que empieza en la hora inexistente se desplaza y se explica", () => {
    const early: SnapshotTemplate = {
      id: "tpl-e",
      code: "E",
      name: "Madrugada",
      versions: [version({ id: "e1", kind: "night", segments: [work(150, 600)] })],
    };
    const s = snapshot({
      templates: { "tpl-e": early },
      assignments: [assignment({ scope: "employee", days: ["tpl-e"] })],
    });
    const r = resolvePlannedShift(EMP, "2026-03-29", s);
    expect(r.segments[0]?.startsAt).toBe("2026-03-29T01:30:00.000Z"); // 03:30 CEST
    expect(r.segments[0]?.endsAt).toBe("2026-03-29T08:00:00.000Z");
    expect(r.elapsedWorkMinutes).toBe(390);
    expect(r.notes.join(" ")).toMatch(/no existe por el cambio de hora/);
  });

  it("un tramo en la hora repetida usa la primera ocurrencia", () => {
    const early: SnapshotTemplate = {
      id: "tpl-e",
      code: "E",
      name: "Madrugada",
      versions: [version({ id: "e1", kind: "night", segments: [work(150, 600)] })],
    };
    const s = snapshot({
      templates: { "tpl-e": early },
      assignments: [assignment({ scope: "employee", days: ["tpl-e"] })],
    });
    const r = resolvePlannedShift(EMP, "2026-10-25", s);
    expect(r.segments[0]?.startsAt).toBe("2026-10-25T00:30:00.000Z"); // 02:30 CEST
    expect(r.elapsedWorkMinutes).toBe(510);
    expect(r.notes.join(" ")).toMatch(/se repite/);
  });

  it("un turno de día en la jornada del cambio no se ve afectado", () => {
    const s = snapshot({ assignments: [assignment({ scope: "employee" })] });
    const r = resolvePlannedShift(EMP, "2026-03-29", s);
    expect(r.segments[0]?.startsAt).toBe("2026-03-29T06:00:00.000Z");
    expect(r.elapsedWorkMinutes).toBe(420);
    expect(r.notes).toEqual([]);
  });

  it("jornada flexible: ventana con instantes reales y horas objetivo", () => {
    const s = snapshot({ assignments: [assignment({ scope: "employee", days: ["tpl-f"] })] });
    const r = resolvePlannedShift(EMP, "2026-06-10", s);
    expect(r.template?.kind).toBe("flexible");
    expect(r.targetMinutes).toBe(480);
    expect(r.flexWindow).toEqual({
      startMinute: 420,
      endMinute: 1200,
      startsAt: "2026-06-10T05:00:00.000Z",
      endsAt: "2026-06-10T18:00:00.000Z",
    });
  });

  it("devuelve tolerancias sin clasificar diferencias como horas extra", () => {
    const r = resolvePlannedShift(EMP, "2026-06-10", nightly());
    expect(r.toleranceEarlyMinutes).toBe(5);
    expect(r.toleranceLateMinutes).toBe(10);
    expect(Object.keys(r)).not.toContain("overtimeMinutes");
  });
});
