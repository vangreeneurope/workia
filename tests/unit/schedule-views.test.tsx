import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DayCard, MonthView, PeriodSummary } from "@/features/schedules/components/schedule-views";
import { resolvePlannedRange, type ScheduleSnapshot } from "@/features/schedules/resolver";

const EMP = "e1";
const snapshot: ScheduleSnapshot = {
  employeeId: EMP,
  timeZone: "Europe/Madrid",
  endDate: null,
  terms: [{ id: "t", validFrom: "2025-01-01", validTo: null }],
  assignments: [
    {
      id: "a",
      scope: "employee",
      employmentTermsId: null,
      validFrom: "2026-01-01",
      validTo: null,
      cycleDays: 7,
      anchorDate: "2026-10-19",
      days: ["n", "n", "n", "n", "n", null, null],
    },
  ],
  templates: {
    n: {
      id: "n",
      code: "N",
      name: "Noche",
      versions: [
        {
          id: "v",
          version: 1,
          kind: "night",
          targetMinutes: 480,
          toleranceEarlyMinutes: 0,
          toleranceLateMinutes: 0,
          flexWindowStart: null,
          flexWindowEnd: null,
          validFrom: "2026-01-01",
          validTo: null,
          segments: [{ startMinute: 1320, endMinute: 1800, kind: "work", paid: true }],
        },
      ],
    },
  },
  holidays: [{ date: "2026-10-23", name: "Festivo sintético" }],
  leaves: [],
};

describe("vistas del horario", () => {
  const days = resolvePlannedRange(EMP, "2026-09-28", "2026-11-01", snapshot);

  it("el mes describe cada día para lectores de pantalla", () => {
    render(<MonthView days={days} month="2026-10" today="2026-10-21" />);
    expect(screen.getByRole("table", { name: "Calendario mensual" })).toBeInTheDocument();
    expect(screen.getAllByText(/viernes 23 de octubre\. Festivo/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/sábado 24 de octubre\. Descanso/).length).toBeGreaterThan(0);
  });

  it("la tarjeta del día muestra el turno de noche que cruza la medianoche", () => {
    const night = days.find((d) => d.date === "2026-10-22");
    const dst = resolvePlannedRange(EMP, "2026-10-24", "2026-10-24", {
      ...snapshot,
      assignments: [{ ...snapshot.assignments[0]!, days: Array(7).fill("n") }],
    })[0];
    render(
      <>
        <DayCard day={night!} today="2026-10-21" />
        <DayCard day={dst!} today="2026-10-21" />
      </>,
    );
    expect(screen.getByText(/540 min reales frente a 480/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /jueves 22 de octubre/ })).toBeInTheDocument();
    expect(screen.getAllByText(/22:00–06:00 \(\+1\) trabajo/)).toHaveLength(2);
  });

  it("el resumen suma horas objetivo sin hablar de horas extra", () => {
    render(<PeriodSummary days={days.filter((d) => d.date.startsWith("2026-10"))} />);
    expect(screen.getByText("Horas objetivo")).toBeInTheDocument();
    expect(screen.queryByText(/extra/i)).toBeNull();
  });
});
