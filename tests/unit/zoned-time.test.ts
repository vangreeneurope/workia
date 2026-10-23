import { describe, expect, it } from "vitest";

import {
  formatDuration,
  formatMinute,
  isValidTimeZone,
  offsetMinutesAt,
  parseClock,
  todayIn,
  utcToZonedWallTime,
  zonedWallTimeToUtc,
} from "@/features/schedules/zoned-time";

const iso = (ms: number) => new Date(ms).toISOString();
const MADRID = "Europe/Madrid";
const CANARY = "Atlantic/Canary";

// Cambios de hora de 2026 en la UE: 29 de marzo y 25 de octubre a las 01:00 UTC.
describe("zonedWallTimeToUtc", () => {
  it("convierte una hora normal en invierno y en verano", () => {
    expect(iso(zonedWallTimeToUtc(MADRID, "2026-01-15", 480).epochMs)).toBe(
      "2026-01-15T07:00:00.000Z",
    );
    expect(iso(zonedWallTimeToUtc(MADRID, "2026-07-15", 480).epochMs)).toBe(
      "2026-07-15T06:00:00.000Z",
    );
    expect(zonedWallTimeToUtc(MADRID, "2026-07-15", 480).adjustment).toBe("none");
  });

  it("Canarias va una hora por detrás de la península", () => {
    expect(iso(zonedWallTimeToUtc(CANARY, "2026-01-15", 480).epochMs)).toBe(
      "2026-01-15T08:00:00.000Z",
    );
    expect(iso(zonedWallTimeToUtc(CANARY, "2026-07-15", 480).epochMs)).toBe(
      "2026-07-15T07:00:00.000Z",
    );
  });

  it("hora inexistente en primavera: se desplaza hacia delante (02:30 -> 03:30 CEST)", () => {
    const r = zonedWallTimeToUtc(MADRID, "2026-03-29", 150);
    expect(r.adjustment).toBe("gap");
    expect(iso(r.epochMs)).toBe("2026-03-29T01:30:00.000Z");
    expect(utcToZonedWallTime(MADRID, r.epochMs)).toEqual({ date: "2026-03-29", minute: 210 });
  });

  it("los límites del salto de primavera", () => {
    expect(iso(zonedWallTimeToUtc(MADRID, "2026-03-29", 119).epochMs)).toBe(
      "2026-03-29T00:59:00.000Z",
    );
    expect(zonedWallTimeToUtc(MADRID, "2026-03-29", 120).adjustment).toBe("gap");
    const three = zonedWallTimeToUtc(MADRID, "2026-03-29", 180);
    expect(three.adjustment).toBe("none");
    expect(iso(three.epochMs)).toBe("2026-03-29T01:00:00.000Z");
  });

  it("hora repetida en otoño: se toma la primera (horario de verano)", () => {
    const r = zonedWallTimeToUtc(MADRID, "2026-10-25", 150);
    expect(r.adjustment).toBe("overlap");
    expect(iso(r.epochMs)).toBe("2026-10-25T00:30:00.000Z");
    const after = zonedWallTimeToUtc(MADRID, "2026-10-25", 180);
    expect(after.adjustment).toBe("none");
    expect(iso(after.epochMs)).toBe("2026-10-25T02:00:00.000Z");
  });

  it("en Canarias el cambio ocurre a otra hora local (01:00 -> 02:00 y 02:00 -> 01:00)", () => {
    expect(zonedWallTimeToUtc(CANARY, "2026-03-29", 90).adjustment).toBe("gap");
    expect(zonedWallTimeToUtc(MADRID, "2026-03-29", 90).adjustment).toBe("none");
    expect(zonedWallTimeToUtc(CANARY, "2026-10-25", 90).adjustment).toBe("overlap");
    expect(iso(zonedWallTimeToUtc(CANARY, "2026-10-25", 90).epochMs)).toBe(
      "2026-10-25T00:30:00.000Z",
    );
  });

  it("minutos posteriores a 1440 son horas del día siguiente", () => {
    expect(iso(zonedWallTimeToUtc(MADRID, "2026-10-24", 1800).epochMs)).toBe(
      "2026-10-25T05:00:00.000Z",
    );
    expect(iso(zonedWallTimeToUtc(MADRID, "2026-12-31", 1440).epochMs)).toBe(
      "2026-12-31T23:00:00.000Z",
    );
  });

  it("zonas con desfase cero (GMT) y UTC", () => {
    expect(offsetMinutesAt("Europe/London", Date.UTC(2026, 0, 15))).toBe(0);
    expect(offsetMinutesAt("UTC", Date.UTC(2026, 6, 15))).toBe(0);
    expect(iso(zonedWallTimeToUtc("UTC", "2026-03-29", 150).epochMs)).toBe(
      "2026-03-29T02:30:00.000Z",
    );
  });

  it("rechaza minutos no enteros (sin coma flotante)", () => {
    expect(() => zonedWallTimeToUtc(MADRID, "2026-01-15", 480.5)).toThrow();
  });

  it("ida y vuelta coherente durante todo un día de cambio", () => {
    for (let minute = 0; minute < 1440; minute += 15) {
      const r = zonedWallTimeToUtc(MADRID, "2026-10-25", minute);
      expect(utcToZonedWallTime(MADRID, r.epochMs)).toEqual({ date: "2026-10-25", minute });
    }
  });
});

describe("utilidades", () => {
  it("valida zonas horarias", () => {
    expect(isValidTimeZone(MADRID)).toBe(true);
    expect(isValidTimeZone("Madrid/Centro")).toBe(false);
  });

  it("hoy depende de la zona", () => {
    const now = new Date("2026-10-24T23:30:00Z");
    expect(todayIn(MADRID, now)).toBe("2026-10-25");
    expect(todayIn(CANARY, now)).toBe("2026-10-25");
    expect(todayIn("America/New_York", now)).toBe("2026-10-24");
  });

  it("formatea y lee horas", () => {
    expect(formatMinute(510)).toBe("08:30");
    expect(formatMinute(1500)).toBe("01:00 (+1)");
    expect(formatMinute(1440)).toBe("00:00 (+1)");
    expect(parseClock("08:30")).toBe(510);
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("8:30")).toBeNull();
    expect(formatDuration(450)).toBe("7 h 30 min");
    expect(formatDuration(480)).toBe("8 h");
    expect(formatDuration(30)).toBe("30 min");
  });
});
