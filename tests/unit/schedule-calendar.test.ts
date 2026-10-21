import { describe, expect, it } from "vitest";

import {
  longDayLabel,
  mondayOf,
  navigation,
  parseViewDate,
  viewRange,
  weekLabel,
} from "@/features/schedules/calendar";
import { describeScheduleEvent } from "@/features/schedules/events";
import { assignmentSchema, parseHolidayLines } from "@/features/schedules/schemas";

describe("rejilla del calendario", () => {
  it("las semanas van de lunes a domingo", () => {
    expect(mondayOf("2026-10-25")).toBe("2026-10-19"); // domingo
    expect(mondayOf("2026-10-26")).toBe("2026-10-26");
    expect(viewRange("semana", "2026-10-28")).toEqual({ from: "2026-10-26", to: "2026-11-01" });
  });

  it("el mes cubre semanas completas", () => {
    expect(viewRange("mes", "2026-10-15")).toEqual({ from: "2026-09-28", to: "2026-11-01" });
    expect(viewRange("mes", "2026-02-10")).toEqual({ from: "2026-01-26", to: "2026-03-01" });
  });

  it("navegación y fecha de la URL", () => {
    expect(navigation("mes", "2026-12-15")).toEqual({ prev: "2026-11-01", next: "2027-01-01" });
    expect(navigation("semana", "2026-10-28")).toEqual({ prev: "2026-10-19", next: "2026-11-02" });
    expect(parseViewDate("2026-02-30", "2026-10-21")).toBe("2026-10-21");
    expect(parseViewDate(undefined, "2026-10-21")).toBe("2026-10-21");
  });

  it("etiquetas en español", () => {
    expect(longDayLabel("2026-10-26")).toBe("lunes 26 de octubre");
    expect(weekLabel("2026-10-28")).toBe("26 de octubre – 1 de noviembre de 2026");
  });
});

describe("importación de festivos", () => {
  it("lee varios separadores y omite líneas vacías", () => {
    const r = parseHolidayLines(
      "2026-12-08;Festivo A\n\n2026-12-25, Festivo B\n2027-01-01\tFestivo C",
      "2026-10-21",
    );
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.date)).toEqual(["2026-12-08", "2026-12-25", "2027-01-01"]);
  });

  it("todo o nada: un error anula la importación", () => {
    const r = parseHolidayLines(
      "2026-12-08;Bien\n2026-02-30;Fecha imposible\n2026-01-01;Pasado\n2026-12-08;Repetido\nsin formato",
      "2026-10-21",
    );
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([
      "Línea 2: la fecha 2026-02-30 no existe",
      "Línea 3: 2026-01-01 ya ha pasado",
      "Línea 4: la fecha 2026-12-08 está repetida",
      "Línea 5: usa el formato AAAA-MM-DD;Nombre",
    ]);
  });
});

describe("validación de asignaciones", () => {
  const base = {
    scope_type: "employee",
    employee_id: "e0000000-0000-4000-8000-000000000007",
    valid_from: "2026-11-02",
    cycle_days: "7",
    days: JSON.stringify([null, null, null, null, null, null, null]),
  };

  it("acepta una asignación completa", () => {
    expect(assignmentSchema.safeParse(base).success).toBe(true);
  });

  it("exige tantos días como el ciclo, fin en excepciones y sujeto según el nivel", () => {
    expect(assignmentSchema.safeParse({ ...base, cycle_days: "14" }).success).toBe(false);
    expect(assignmentSchema.safeParse({ ...base, scope_type: "exception" }).success).toBe(false);
    expect(assignmentSchema.safeParse({ ...base, scope_type: "team" }).success).toBe(false);
    expect(assignmentSchema.safeParse({ ...base, last_day: "2026-11-01" }).success).toBe(false);
    expect(assignmentSchema.safeParse({ ...base, days: "no es json" }).success).toBe(false);
  });
});

describe("eventos de horario", () => {
  it("describe cada evento sin datos personales", () => {
    expect(
      describeScheduleEvent("shift_assignment_published", {
        valid_from: "2026-11-02",
        valid_to: "2026-12-01",
      }),
    ).toBe("Se ha publicado un horario desde el 02/11/2026 hasta el 30/11/2026.");
    expect(describeScheduleEvent("shift_assignment_changed", { last_day: "2026-11-15" })).toBe(
      "Un horario asignado termina el 15/11/2026 (incluido).",
    );
    expect(
      describeScheduleEvent("shift_template_published", { valid_from: "2026-11-09", version: 2 }),
    ).toMatch(/09\/11\/2026 \(versión 2\)/);
    expect(describeScheduleEvent("otro", null)).toBe("Cambio en tu horario.");
  });
});
