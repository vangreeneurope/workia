import { describe, expect, it } from "vitest";

import { addDays, businessDate, formatDate, isIsoDate, startOfBusinessDay } from "@/lib/dates";

describe("fechas de calendario laboral (Madrid)", () => {
  it("valida fechas ISO reales", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("01/02/2026")).toBe(false);
  });

  it("convierte el inicio del día de Madrid a UTC en invierno y en verano", () => {
    expect(startOfBusinessDay("2026-01-15")).toBe("2026-01-14T23:00:00.000Z");
    expect(startOfBusinessDay("2026-07-15")).toBe("2026-07-14T22:00:00.000Z");
  });

  it("acierta en los días de cambio de hora", () => {
    expect(startOfBusinessDay("2026-03-29")).toBe("2026-03-28T23:00:00.000Z");
    expect(startOfBusinessDay("2026-10-25")).toBe("2026-10-24T22:00:00.000Z");
  });

  it("obtiene la fecha de Madrid de un instante", () => {
    expect(businessDate(new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
  });

  it("suma días y formatea", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(formatDate("2026-11-01")).toBe("01/11/2026");
    expect(formatDate(null)).toBe("—");
  });
});
